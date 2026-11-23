GRANT CREATE ON SCHEMA app_private TO app_commands;
CREATE FUNCTION app_private.enqueue_job(target_team uuid, job_kind text, target_document uuid DEFAULT NULL,
  target_version uuid DEFAULT NULL, target_intent uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE job_id uuid;
BEGIN
  INSERT INTO app.processing_jobs(team_id,kind,document_id,version_id,storage_intent_id)
    VALUES(target_team,job_kind,target_document,target_version,target_intent) RETURNING id INTO job_id;
  INSERT INTO app.outbox_events(team_id,job_id,dedupe_key) VALUES(target_team,job_id,job_id::text);
  RETURN job_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.enqueue_job(uuid,text,uuid,uuid,uuid) FROM PUBLIC,app_api,app_worker;
ALTER FUNCTION app_private.enqueue_job(uuid,text,uuid,uuid,uuid) OWNER TO app_commands;

CREATE FUNCTION app_private.document_command(operation text,payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE actor app_private.actor; doc app.documents; intent app.storage_intents; version app.document_versions;
  result jsonb; target uuid; reader uuid; reader_text text; number integer; job_id uuid;
BEGIN
  actor := app_private.require_actor();
  target := nullif(payload->>'documentId','')::uuid;
  IF operation='list' THEN
    SELECT coalesce(jsonb_agg(item ORDER BY item->>'title'),'[]') INTO result FROM (
      SELECT jsonb_build_object('id',d.id,'title',d.title,'visibility',d.visibility,'currentVersionId',d.current_version_id,
        'status',coalesce((SELECT v.state FROM app.document_versions v WHERE v.document_id=d.id ORDER BY v.version_number DESC LIMIT 1),'not_uploaded')) AS item
      FROM app.documents d WHERE d.team_id=actor.team_id AND app_private.can_read_document(d.id)
      ORDER BY d.created_at,d.id LIMIT 100 OFFSET least(greatest(coalesce((payload->>'offset')::int,0),0),10000)
    ) permitted;
    RETURN result;
  ELSIF operation='intent' THEN
    IF actor.role NOT IN ('editor','admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF target IS NOT NULL AND NOT app_private.can_read_document(target) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    INSERT INTO app.storage_intents(team_id,uploader_membership_id,target_document_id,bucket,object_key,lease_token,lease_expires_at)
      VALUES(actor.team_id,actor.membership_id,target,payload->>'bucket',actor.team_id::text||'/'||gen_random_uuid()::text,1,
        clock_timestamp()+interval '10 minutes') RETURNING * INTO intent;
    RETURN jsonb_build_object('intentId',intent.id,'objectKey',intent.object_key,'token',intent.lease_token);
  ELSIF operation='finalize' THEN
    IF actor.role NOT IN ('editor','admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO intent FROM app.storage_intents WHERE id=(payload->>'intentId')::uuid
      AND team_id=actor.team_id AND uploader_membership_id=actor.membership_id FOR UPDATE;
    IF intent.id IS NULL OR intent.state<>'allocated' OR intent.lease_token<>(payload->>'token')::bigint
      OR intent.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED'; END IF;
    target := intent.target_document_id;
    IF target IS NULL THEN
      INSERT INTO app.documents(team_id,created_by_membership_id,title) VALUES(actor.team_id,actor.membership_id,payload->>'title') RETURNING * INTO doc;
      INSERT INTO app.document_grants(team_id,document_id,grantee_membership_id,granted_by_membership_id)
        VALUES(actor.team_id,doc.id,actor.membership_id,actor.membership_id);
    ELSE
      IF NOT app_private.can_read_document(target) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      SELECT * INTO doc FROM app.documents WHERE id=target AND team_id=actor.team_id FOR UPDATE;
    END IF;
    number := doc.next_version_number;
    UPDATE app.documents SET next_version_number=number+1,updated_at=clock_timestamp() WHERE id=doc.id;
    INSERT INTO app.document_versions(document_id,team_id,version_number,created_by_membership_id,storage_intent_id,
      original_filename,mime_type,byte_size,content_sha256)
      VALUES(doc.id,actor.team_id,number,actor.membership_id,intent.id,payload->>'filename',payload->>'mimeType',
        (payload->>'byteSize')::bigint,payload->>'sha256') RETURNING * INTO version;
    UPDATE app.storage_intents SET state='attached',actual_byte_size=version.byte_size,content_sha256=version.content_sha256,
      lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=intent.id;
    job_id := app_private.enqueue_job(actor.team_id,'process_version',doc.id,version.id,NULL);
    RETURN jsonb_build_object('id',doc.id,'versionId',version.id,'versionNumber',number,'status','queued');
  ELSIF operation='abandon' THEN
    SELECT * INTO intent FROM app.storage_intents WHERE id=(payload->>'intentId')::uuid AND team_id=actor.team_id
      AND uploader_membership_id=actor.membership_id FOR UPDATE;
    IF intent.id IS NOT NULL AND intent.state='allocated' THEN
      UPDATE app.storage_intents SET state='cleanup_pending',lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=intent.id;
      PERFORM app_private.enqueue_job(actor.team_id,'purge_storage_intent',NULL,NULL,intent.id);
    END IF;
    RETURN jsonb_build_object('ok',true);
  ELSIF operation IN ('grant_add','grant_revoke','visibility') THEN
    IF actor.role<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    -- Validate reader input before inspecting a hidden target, preserving neutral outcomes.
    FOR reader_text IN SELECT jsonb_array_elements_text(coalesce(payload->'readers','[]')) LOOP
      IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE id=reader_text::uuid AND team_id=actor.team_id AND removed_at IS NULL)
        THEN RAISE EXCEPTION 'INVALID_READER'; END IF;
    END LOOP;
    reader := nullif(payload->>'membershipId','')::uuid;
    IF reader IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.memberships WHERE id=reader AND team_id=actor.team_id AND removed_at IS NULL)
      THEN RAISE EXCEPTION 'INVALID_READER'; END IF;
    SELECT * INTO doc FROM app.documents WHERE id=target AND team_id=actor.team_id AND deleted_at IS NULL;
    IF doc.id IS NULL THEN RETURN jsonb_build_object('accepted',true); END IF;
    IF operation='visibility' THEN
      UPDATE app.document_grants SET revoked_at=clock_timestamp(),revoked_by_membership_id=actor.membership_id
        WHERE document_id=doc.id AND revoked_at IS NULL;
      UPDATE app.documents SET visibility=payload->>'visibility',updated_at=clock_timestamp() WHERE id=doc.id;
      IF payload->>'visibility'='restricted' THEN
        FOR reader_text IN SELECT jsonb_array_elements_text(coalesce(payload->'readers','[]')) LOOP
          INSERT INTO app.document_grants(team_id,document_id,grantee_membership_id,granted_by_membership_id)
            VALUES(actor.team_id,doc.id,reader_text::uuid,actor.membership_id)
            ON CONFLICT(document_id,grantee_membership_id) WHERE revoked_at IS NULL DO NOTHING;
        END LOOP;
      END IF;
    ELSIF operation='grant_add' THEN
      INSERT INTO app.document_grants(team_id,document_id,grantee_membership_id,granted_by_membership_id)
        VALUES(actor.team_id,doc.id,reader,actor.membership_id)
        ON CONFLICT(document_id,grantee_membership_id) WHERE revoked_at IS NULL DO NOTHING;
    ELSE
      UPDATE app.document_grants SET revoked_at=clock_timestamp(),revoked_by_membership_id=actor.membership_id
        WHERE document_id=doc.id AND grantee_membership_id=reader AND revoked_at IS NULL;
    END IF;
    RETURN jsonb_build_object('accepted',true);
  END IF;
  IF NOT app_private.can_read_document(target) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO doc FROM app.documents WHERE id=target AND team_id=actor.team_id;
  IF operation='versions' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'versionNumber',version_number,'status',state,'filename',original_filename,
      'byteSize',byte_size,'createdAt',created_at,'failureCode',failure_code) ORDER BY version_number DESC),'[]') INTO result
      FROM app.document_versions WHERE document_id=doc.id AND state<>'purged';
    RETURN result;
  ELSIF operation='download' THEN
    SELECT * INTO version FROM app.document_versions WHERE id=(payload->>'versionId')::uuid
      AND document_id=doc.id AND team_id=actor.team_id AND state<>'purged';
    IF version.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    SELECT * INTO intent FROM app.storage_intents WHERE id=version.storage_intent_id AND state='attached';
    IF intent.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN jsonb_build_object('objectKey',intent.object_key,'bucket',intent.bucket,'filename',version.original_filename,'mimeType',version.mime_type);
  ELSIF operation='readers' THEN
    IF actor.role<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('membershipId',grantee_membership_id)),'[]') INTO result
      FROM app.document_grants WHERE document_id=doc.id AND revoked_at IS NULL;
    RETURN result;
  ELSIF operation='delete' THEN
    IF actor.role NOT IN ('editor','admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    UPDATE app.documents SET deleted_at=clock_timestamp(),current_version_id=NULL,updated_at=clock_timestamp() WHERE id=doc.id;
    UPDATE app.processing_jobs SET state='cancelled',lease_expires_at=NULL,lease_token=lease_token+1
      WHERE document_id=doc.id AND kind='process_version' AND state IN ('pending','leased');
    PERFORM app_private.enqueue_job(actor.team_id,'purge_document',doc.id,NULL,NULL);
    RETURN jsonb_build_object('ok',true);
  END IF;
  RAISE EXCEPTION 'INVALID_OPERATION';
END;
$function$;
REVOKE ALL ON FUNCTION app_private.document_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.document_command(text,jsonb) TO app_api;
ALTER FUNCTION app_private.document_command(text,jsonb) OWNER TO app_commands;
REVOKE CREATE ON SCHEMA app_private FROM app_commands;
