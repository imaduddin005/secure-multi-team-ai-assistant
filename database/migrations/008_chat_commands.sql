GRANT CREATE ON SCHEMA app_private TO app_commands;
CREATE FUNCTION app_private.chat_command(operation text,payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE actor app_private.actor; result jsonb; conversation app.conversations; reservation app.usage_reservations;
  message app.messages; attempt app.usage_attempts; item jsonb; chunk app.document_chunks;
  v_message_id uuid; n int; ordinal int:=0; selected_profile uuid;
BEGIN
  actor:=app_private.require_actor();
  IF operation='create' THEN
    INSERT INTO app.conversations(team_id,owner_membership_id) VALUES(actor.team_id,actor.membership_id) RETURNING * INTO conversation;
    RETURN jsonb_build_object('id',conversation.id,'title',conversation.title);
  ELSIF operation='conversations' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'createdAt',created_at) ORDER BY created_at DESC),'[]')
      INTO result FROM app.conversations WHERE team_id=actor.team_id AND owner_membership_id=actor.membership_id AND deleted_at IS NULL;
    RETURN result;
  ELSIF operation IN ('has_sources','retrieve') THEN
    SELECT id INTO selected_profile FROM app.embedding_profiles WHERE profile_key=payload->>'profileKey';
    IF operation='has_sources' THEN
      IF EXISTS(SELECT 1 FROM app.documents d JOIN app.document_versions v ON v.id=d.current_version_id
        WHERE app_private.can_read_document(d.id) AND v.state='ready' AND v.embedding_profile_id IS DISTINCT FROM selected_profile)
        THEN RAISE EXCEPTION 'PROFILE_MISMATCH'; END IF;
      RETURN jsonb_build_object('available',EXISTS(SELECT 1 FROM app.documents d JOIN app.document_versions v ON v.id=d.current_version_id
        WHERE app_private.can_read_document(d.id) AND v.state='ready' AND v.embedding_profile_id=selected_profile));
    END IF;
    WITH permitted AS MATERIALIZED (
      SELECT c.*,d.title FROM app.document_chunks c JOIN app.documents d ON d.id=c.document_id AND d.team_id=c.team_id
        JOIN app.document_versions v ON v.id=c.version_id AND v.document_id=c.document_id
      WHERE app_private.can_read_document(d.id) AND d.current_version_id=v.id AND v.state='ready'
        AND v.embedding_profile_id=selected_profile
    ), ranked AS (
      SELECT * FROM permitted ORDER BY embedding OPERATOR(extensions.<=>) (payload->>'vector')::extensions.vector,id LIMIT 8
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('chunkId',id,'documentId',document_id,'versionId',version_id,'title',title,'text',content_text,
      'locationKind',location_kind,'pageStart',page_start,'pageEnd',page_end,'lineStart',line_start,'lineEnd',line_end)), '[]') INTO result FROM ranked;
    RETURN result;
  ELSIF operation='validate' THEN
    n:=jsonb_array_length(payload->'sources');
    IF n>20 OR n<>(SELECT count(DISTINCT value->>'chunkId') FROM jsonb_array_elements(payload->'sources')) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(payload->'sources') LOOP
      IF NOT EXISTS(SELECT 1 FROM app.document_chunks c JOIN app.documents d ON d.id=c.document_id
        JOIN app.document_versions v ON v.id=c.version_id WHERE c.id=(item->>'chunkId')::uuid
          AND app_private.can_read_document(d.id) AND d.current_version_id=v.id AND v.state='ready') THEN RAISE EXCEPTION 'SOURCE_UNAVAILABLE'; END IF;
    END LOOP;
    RETURN jsonb_build_object('ok',true);
  ELSIF operation='complete' THEN
    SELECT * INTO reservation FROM app.usage_reservations WHERE id=(payload->>'requestId')::uuid
      AND team_id=actor.team_id AND owner_membership_id=actor.membership_id FOR UPDATE;
    IF reservation.id IS NULL OR NOT app_private.can_read_conversation(reservation.conversation_id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF reservation.status<>'in_progress' OR reservation.current_attempt_number<>(payload->>'token')::int THEN RAISE EXCEPTION 'STALE_ATTEMPT'; END IF;
    SELECT * INTO attempt FROM app.usage_attempts WHERE reservation_id=reservation.id AND attempt_number=reservation.current_attempt_number FOR UPDATE;
    IF attempt.state<>'held' OR attempt.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'STALE_ATTEMPT'; END IF;
    PERFORM app_private.chat_command('validate',jsonb_build_object('sources',payload->'sources'));
    n:=jsonb_array_length(payload->'sources');
    INSERT INTO app.messages(team_id,owner_membership_id,conversation_id,request_id,kind,answer_kind,body_text,expected_source_count)
      VALUES(actor.team_id,actor.membership_id,reservation.conversation_id,reservation.id,'assistant',payload->>'kind',
        CASE WHEN payload->>'kind'='insufficient_sources' THEN 'I could not find enough authorized sources to answer this question.' ELSE payload->>'answer' END,n)
      RETURNING id INTO v_message_id;
    FOR item IN SELECT value FROM jsonb_array_elements(payload->'sources') LOOP
      SELECT * INTO chunk FROM app.document_chunks WHERE id=(item->>'chunkId')::uuid;
      INSERT INTO app.message_sources(team_id,owner_membership_id,message_id,document_id,version_id,chunk_id,chunk_ordinal,
        context_ordinal,source_label,is_cited,location_kind,page_start,page_end,line_start,line_end)
      VALUES(actor.team_id,actor.membership_id,v_message_id,chunk.document_id,chunk.version_id,chunk.id,chunk.chunk_ordinal,
        ordinal,'S'||(ordinal+1)::text,coalesce((item->>'isCited')::boolean,false),chunk.location_kind,chunk.page_start,chunk.page_end,chunk.line_start,chunk.line_end);
      ordinal:=ordinal+1;
    END LOOP;
    UPDATE app.messages SET finalized_at=clock_timestamp() WHERE id=v_message_id;
    IF NOT app_private.close_attempt(reservation.id,reservation.current_attempt_number,
      CASE WHEN payload->>'kind'='grounded' THEN 'charged' ELSE 'released' END) THEN RAISE EXCEPTION 'STALE_ATTEMPT'; END IF;
    UPDATE app.usage_reservations SET status='completed',completed_at=clock_timestamp() WHERE id=reservation.id;
    RETURN app_private.chat_command('result',jsonb_build_object('requestId',reservation.id));
  ELSIF operation='result' THEN
    SELECT * INTO reservation FROM app.usage_reservations WHERE id=(payload->>'requestId')::uuid AND owner_membership_id=actor.membership_id AND team_id=actor.team_id;
    IF reservation.id IS NULL OR NOT app_private.can_read_conversation(reservation.conversation_id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    SELECT * INTO message FROM app.messages WHERE request_id=reservation.id AND kind='assistant';
    IF message.id IS NULL OR NOT app_private.can_read_message(message.id) THEN RETURN jsonb_build_object('available',false); END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('label',s.source_label,'documentId',s.document_id,'versionId',s.version_id,
      'title',d.title,'locationKind',s.location_kind,'pageStart',s.page_start,'lineStart',s.line_start,
      'historical',d.current_version_id IS DISTINCT FROM s.version_id) ORDER BY s.context_ordinal),'[]') INTO result
      FROM app.message_sources s JOIN app.documents d ON d.id=s.document_id WHERE s.message_id=message.id AND s.is_cited;
    RETURN jsonb_build_object('id',message.id,'available',true,'kind',message.answer_kind,'answer',message.body_text,'citations',result);
  END IF;
  IF operation IN ('history','delete_conversation') THEN
    SELECT * INTO conversation FROM app.conversations WHERE id=(payload->>'conversationId')::uuid
      AND team_id=actor.team_id AND owner_membership_id=actor.membership_id AND deleted_at IS NULL;
    IF conversation.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF operation='history' THEN
      SELECT coalesce(jsonb_agg(CASE WHEN m.kind='user' THEN jsonb_build_object('id',m.id,'role','user','text',m.body_text)
        ELSE jsonb_build_object('id',m.id,'role','assistant') || app_private.chat_command('result',jsonb_build_object('requestId',m.request_id)) END
        ORDER BY m.created_at,m.kind DESC),'[]') INTO result FROM app.messages m WHERE m.conversation_id=conversation.id;
      RETURN result;
    END IF;
    UPDATE app.conversations SET deleted_at=clock_timestamp() WHERE id=conversation.id;
    FOR reservation IN SELECT * FROM app.usage_reservations WHERE conversation_id=conversation.id AND status<>'completed' LOOP
      PERFORM app_private.close_attempt(reservation.id,reservation.current_attempt_number,'released');
      UPDATE app.usage_reservations SET status='blocked' WHERE id=reservation.id;
    END LOOP;
    DELETE FROM app.feedback WHERE message_id IN(SELECT id FROM app.messages WHERE conversation_id=conversation.id);
    DELETE FROM app.message_sources WHERE message_id IN(SELECT id FROM app.messages WHERE conversation_id=conversation.id);
    DELETE FROM app.messages WHERE conversation_id=conversation.id;
    RETURN jsonb_build_object('ok',true);
  ELSIF operation IN ('feedback','citation') THEN
    v_message_id:=(payload->>'messageId')::uuid;
    IF NOT app_private.can_read_message(v_message_id) OR NOT EXISTS(SELECT 1 FROM app.messages WHERE id=v_message_id AND kind='assistant')
      THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF operation='feedback' THEN
      INSERT INTO app.feedback(team_id,owner_membership_id,user_id,message_id,rating,comment)
        VALUES(actor.team_id,actor.membership_id,actor.user_id,v_message_id,payload->>'rating',payload->>'comment')
        ON CONFLICT(user_id,message_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,updated_at=clock_timestamp();
      RETURN jsonb_build_object('ok',true);
    END IF;
    SELECT jsonb_build_object('text',c.content_text,'title',d.title,'versionId',s.version_id,'historical',d.current_version_id IS DISTINCT FROM s.version_id,
      'locationKind',c.location_kind,'pageStart',c.page_start,'pageEnd',c.page_end,'lineStart',c.line_start,'lineEnd',c.line_end) INTO result
      FROM app.message_sources s JOIN app.document_chunks c ON c.id=s.chunk_id JOIN app.documents d ON d.id=s.document_id
      WHERE s.message_id=v_message_id AND s.source_label=payload->>'label' AND s.is_cited;
    IF result IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN result;
  END IF;
  RAISE EXCEPTION 'INVALID_OPERATION';
END;
$function$;
REVOKE ALL ON FUNCTION app_private.chat_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.chat_command(text,jsonb) TO app_api;
ALTER FUNCTION app_private.chat_command(text,jsonb) OWNER TO app_commands;
REVOKE CREATE ON SCHEMA app_private FROM app_commands;
