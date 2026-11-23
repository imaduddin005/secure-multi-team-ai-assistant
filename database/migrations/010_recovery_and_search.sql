-- Forward-only hardening: preserve applied migration checksums.
GRANT CREATE ON SCHEMA app_private TO app_commands;
SET LOCAL ROLE app_commands;
CREATE OR REPLACE FUNCTION app_private.worker_command(operation text,payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE job app.processing_jobs; doc app.documents; version app.document_versions; intent app.storage_intents;
  item jsonb; result jsonb; selected_profile uuid; candidate record; target_team uuid;
BEGIN
  IF operation='profile' THEN
    INSERT INTO app.embedding_profiles(profile_key,provider_id,model_id,dimensions,chunker_version)
      VALUES(payload->>'key','openai-compatible',payload->>'model',(payload->>'dimensions')::int,payload->>'chunker')
      ON CONFLICT(profile_key) DO NOTHING;
    SELECT id INTO selected_profile FROM app.embedding_profiles WHERE profile_key=payload->>'key';
    IF EXISTS(SELECT 1 FROM app.documents d JOIN app.document_versions v ON v.id=d.current_version_id
      WHERE d.deleted_at IS NULL AND v.embedding_profile_id<>selected_profile) THEN RAISE EXCEPTION 'PROFILE_MISMATCH'; END IF;
    RETURN jsonb_build_object('id',selected_profile);
  ELSIF operation='dispatches' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',j.id)),'[]') INTO result FROM (
      SELECT id FROM app.processing_jobs WHERE
        ((state='pending' AND next_attempt_at<=clock_timestamp()) OR (state='leased' AND lease_expires_at<=clock_timestamp()))
      ORDER BY next_attempt_at LIMIT 25
    ) j;
    RETURN result;
  ELSIF operation='recover_intents' THEN
    FOR candidate IN SELECT id,team_id FROM app.storage_intents s
      WHERE ((state IN ('allocated','uploaded') AND coalesce(lease_expires_at,created_at)<clock_timestamp()-interval '2 minutes')
        OR state='cleanup_pending' OR (state='purged' AND updated_at<clock_timestamp()-interval '1 hour'))
      AND NOT EXISTS(SELECT 1 FROM app.document_versions v JOIN app.documents d ON d.id=v.document_id
        WHERE v.storage_intent_id=s.id AND d.deleted_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM app.processing_jobs j WHERE j.storage_intent_id=s.id AND j.kind='purge_storage_intent' AND j.state='failed')
      ORDER BY s.team_id,s.id LIMIT 25 LOOP
      PERFORM 1 FROM app.teams WHERE id=candidate.team_id FOR UPDATE;
      SELECT * INTO intent FROM app.storage_intents WHERE id=candidate.id FOR UPDATE;
      IF EXISTS(SELECT 1 FROM app.document_versions v JOIN app.documents d ON d.id=v.document_id
        WHERE v.storage_intent_id=intent.id AND d.deleted_at IS NULL) THEN CONTINUE; END IF;
      UPDATE app.storage_intents SET state='cleanup_pending',lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=intent.id;
      SELECT * INTO job FROM app.processing_jobs WHERE storage_intent_id=intent.id AND kind='purge_storage_intent';
      IF job.id IS NULL THEN PERFORM app_private.enqueue_job(intent.team_id,'purge_storage_intent',NULL,NULL,intent.id);
      ELSIF job.state='succeeded' THEN
        UPDATE app.processing_jobs SET state='pending',attempts=0,lease_expires_at=NULL,next_attempt_at=clock_timestamp(),lease_token=lease_token+1 WHERE id=job.id;
      END IF;
    END LOOP;
    RETURN jsonb_build_object('ok',true);
  END IF;
  SELECT team_id INTO target_team FROM app.processing_jobs WHERE id=(payload->>'jobId')::uuid;
  IF target_team IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM app.teams WHERE id=target_team FOR UPDATE;
  SELECT * INTO job FROM app.processing_jobs WHERE id=(payload->>'jobId')::uuid FOR UPDATE;
  IF operation='published' THEN
    UPDATE app.outbox_events SET state='published',published_at=clock_timestamp(),publish_attempts=publish_attempts+1 WHERE job_id=job.id;
    RETURN jsonb_build_object('ok',true);
  ELSIF operation='publish_failed' THEN
    UPDATE app.outbox_events SET state='pending',published_at=NULL,publish_attempts=publish_attempts+1,
      last_error_code='QUEUE_UNAVAILABLE',available_at=clock_timestamp()+interval '10 seconds' WHERE job_id=job.id;
    RETURN jsonb_build_object('ok',true);
  ELSIF operation='claim' THEN
    IF job.state IN ('succeeded','failed','cancelled') THEN RETURN NULL; END IF;
    IF job.state='leased' AND job.lease_expires_at>clock_timestamp() THEN RETURN NULL; END IF;
    IF job.next_attempt_at>clock_timestamp() THEN RETURN NULL; END IF;
    IF job.attempts>=job.max_attempts THEN
      UPDATE app.processing_jobs SET state='failed',lease_expires_at=NULL,last_error_code='LEASE_EXPIRED' WHERE id=job.id;
      IF job.kind='process_version' THEN
        UPDATE app.document_versions SET state='failed',failure_code='LEASE_EXPIRED' WHERE id=job.version_id AND state IN ('queued','processing','failed');
      END IF;
      RETURN NULL;
    END IF;
    IF job.kind='process_version' THEN
      SELECT * INTO doc FROM app.documents WHERE id=job.document_id;
      IF doc.deleted_at IS NOT NULL THEN
        UPDATE app.processing_jobs SET state='cancelled',lease_expires_at=NULL WHERE id=job.id;
        RETURN NULL;
      END IF;
      SELECT * INTO version FROM app.document_versions WHERE id=job.version_id;
      IF version.state IN ('ready','purged') THEN
        UPDATE app.processing_jobs SET state='cancelled',lease_expires_at=NULL WHERE id=job.id;
        RETURN NULL;
      END IF;
      UPDATE app.document_versions SET state='processing',failure_code=NULL WHERE id=version.id;
      SELECT * INTO intent FROM app.storage_intents WHERE id=version.storage_intent_id;
    ELSIF job.kind='purge_document' THEN
      IF NOT EXISTS(SELECT 1 FROM app.documents WHERE id=job.document_id AND deleted_at IS NOT NULL) THEN RETURN NULL; END IF;
    ELSE
      SELECT * INTO intent FROM app.storage_intents WHERE id=job.storage_intent_id;
      IF EXISTS(SELECT 1 FROM app.document_versions v JOIN app.documents d ON d.id=v.document_id
        WHERE v.storage_intent_id=intent.id AND d.deleted_at IS NULL) THEN RETURN NULL; END IF;
      UPDATE app.storage_intents SET state='cleanup_pending',lease_expires_at=NULL WHERE id=intent.id;
    END IF;
    UPDATE app.processing_jobs SET state='leased',attempts=attempts+1,lease_token=lease_token+1,
      lease_expires_at=clock_timestamp()+interval '15 minutes' WHERE id=job.id RETURNING * INTO job;
    SELECT coalesce(jsonb_agg(s.object_key),'[]') INTO result FROM app.storage_intents s JOIN app.document_versions v ON v.storage_intent_id=s.id
      WHERE v.document_id=job.document_id;
    RETURN jsonb_build_object('id',job.id,'kind',job.kind,'token',job.lease_token,'versionId',job.version_id,
      'documentId',job.document_id,'objectKey',intent.object_key,'mimeType',version.mime_type,
      'byteSize',version.byte_size,'sha256',version.content_sha256,'objectKeys',result);
  END IF;
  IF job.state<>'leased' OR job.lease_token<>(payload->>'token')::bigint OR job.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'STALE_ATTEMPT'; END IF;
  IF operation='heartbeat' THEN
    UPDATE app.processing_jobs SET lease_expires_at=clock_timestamp()+interval '15 minutes' WHERE id=job.id;
    RETURN jsonb_build_object('ok',true);
  ELSIF operation='fail' THEN
    UPDATE app.processing_jobs SET state=CASE WHEN attempts<max_attempts THEN 'pending' ELSE 'failed' END,
      lease_expires_at=NULL,next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,5*(2^attempts)::int)),
      last_error_code='PROCESSING_FAILED' WHERE id=job.id;
    UPDATE app.outbox_events SET state='pending',published_at=NULL,available_at=clock_timestamp()+interval '10 seconds' WHERE job_id=job.id;
    IF job.kind='process_version' AND job.attempts>=job.max_attempts THEN
      UPDATE app.document_versions SET state='failed',failure_code='PROCESSING_FAILED' WHERE id=job.version_id AND state<>'ready';
    END IF;
    RETURN jsonb_build_object('ok',true);
  ELSIF operation='complete' AND job.kind='process_version' THEN
    SELECT * INTO doc FROM app.documents WHERE id=job.document_id FOR UPDATE;
    IF doc.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'STALE_ATTEMPT'; END IF;
    SELECT * INTO version FROM app.document_versions WHERE id=job.version_id FOR UPDATE;
    SELECT id INTO selected_profile FROM app.embedding_profiles WHERE profile_key=payload->>'profileKey';
    IF selected_profile IS NULL OR jsonb_array_length(payload->'chunks') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    -- Serialize configuration cutover across different team gates as well.
    PERFORM pg_advisory_xact_lock(hashtext('secure-assistant:embedding-profile'));
    IF EXISTS(SELECT 1 FROM app.documents d JOIN app.document_versions v ON v.id=d.current_version_id
      WHERE d.deleted_at IS NULL AND v.embedding_profile_id<>selected_profile) THEN RAISE EXCEPTION 'PROFILE_MISMATCH'; END IF;
    UPDATE app.document_versions SET embedding_profile_id=selected_profile,
      embedding_dimensions=(SELECT dimensions FROM app.embedding_profiles WHERE id=selected_profile) WHERE id=version.id;
    DELETE FROM app.document_chunks WHERE version_id=version.id;
    FOR item IN SELECT value FROM jsonb_array_elements(payload->'chunks') LOOP
      INSERT INTO app.document_chunks(team_id,document_id,version_id,embedding_profile_id,embedding_dimensions,
        chunk_ordinal,location_kind,page_start,page_end,line_start,line_end,content_text,content_sha256,embedding)
      VALUES(job.team_id,doc.id,version.id,selected_profile,(SELECT dimensions FROM app.embedding_profiles WHERE id=selected_profile),
        (item->>'ordinal')::int,item->>'locationKind',(item->>'pageStart')::int,(item->>'pageEnd')::int,
        (item->>'lineStart')::int,(item->>'lineEnd')::int,item->>'text',item->>'sha256',(item->>'embedding')::extensions.vector);
    END LOOP;
    UPDATE app.document_versions SET state='ready',ready_at=clock_timestamp(),failure_code=NULL WHERE id=version.id;
    IF doc.current_version_id IS NULL OR version.version_number>(SELECT version_number FROM app.document_versions WHERE id=doc.current_version_id) THEN
      UPDATE app.documents SET current_version_id=version.id,updated_at=clock_timestamp() WHERE id=doc.id;
    END IF;
  ELSIF operation='complete' AND job.kind='purge_document' THEN
    IF NOT EXISTS(SELECT 1 FROM app.documents WHERE id=job.document_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'STALE_ATTEMPT'; END IF;
    UPDATE app.message_sources SET chunk_id=NULL WHERE document_id=job.document_id AND chunk_id IS NOT NULL;
    DELETE FROM app.document_chunks WHERE document_id=job.document_id;
    UPDATE app.document_versions SET state='purged' WHERE document_id=job.document_id;
    UPDATE app.storage_intents SET state='purged',updated_at=clock_timestamp() WHERE id IN (
      SELECT storage_intent_id FROM app.document_versions WHERE document_id=job.document_id);
  ELSIF operation='complete' AND job.kind='purge_storage_intent' THEN
    UPDATE app.storage_intents SET state='purged',updated_at=clock_timestamp() WHERE id=job.storage_intent_id;
  ELSE RAISE EXCEPTION 'INVALID_OPERATION';
  END IF;
  UPDATE app.processing_jobs SET state='succeeded',lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=job.id;
  RETURN jsonb_build_object('ok',true);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.document_command(operation text,payload jsonb DEFAULT '{}') RETURNS jsonb
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
        AND (coalesce(payload->>'query','')='' OR strpos(lower(d.title),lower(payload->>'query'))>0)
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
SET LOCAL ROLE app_owner;
REVOKE CREATE ON SCHEMA app_private FROM app_commands;
