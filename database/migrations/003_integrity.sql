-- Privileged triggers are foundations, not public membership/document/chat APIs.
CREATE FUNCTION app_private.guard_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE target_team uuid;
BEGIN
  target_team := CASE WHEN TG_OP = 'DELETE' THEN OLD.team_id ELSE NEW.team_id END;
  PERFORM 1 FROM app.teams WHERE id = target_team FOR UPDATE;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Membership history cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.team_id, NEW.user_id, NEW.joined_at) IS DISTINCT FROM
       (OLD.id, OLD.team_id, OLD.user_id, OLD.joined_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Membership identity is immutable';
    END IF;
    IF OLD.removed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Removed membership cannot be restored or changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER membership_guard BEFORE INSERT OR UPDATE OR DELETE ON app.memberships
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_membership();

CREATE FUNCTION app_private.check_team_foundation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE target_team uuid;
BEGIN
  IF TG_TABLE_NAME = 'teams' THEN target_team := NEW.id;
  ELSE target_team := NEW.team_id;
  END IF;
  PERFORM 1 FROM app.teams WHERE id = target_team FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM app.memberships WHERE team_id = target_team AND role = 'admin' AND removed_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM app.usage_budgets WHERE team_id = target_team) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'team_requires_admin_and_budget',
      MESSAGE = 'Team must retain an active administrator and a budget';
  END IF;
  RETURN NULL;
END;
$function$;
CREATE CONSTRAINT TRIGGER team_foundation AFTER INSERT ON app.teams
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.check_team_foundation();
CREATE CONSTRAINT TRIGGER membership_admin_invariant AFTER INSERT OR UPDATE ON app.memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.check_team_foundation();

CREATE FUNCTION app_private.guard_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Grant history must be revoked, not deleted';
  END IF;
  PERFORM 1 FROM app.teams WHERE id = NEW.team_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM app.memberships
      WHERE id = NEW.grantee_membership_id AND removed_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Grant requires a current membership';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['revoked_at', 'revoked_by_membership_id', 'revoked_by_system'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revoked_at', 'revoked_by_membership_id', 'revoked_by_system'])
      OR (OLD.revoked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Grant identity and revocation history are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER grant_guard BEFORE INSERT OR UPDATE OR DELETE ON app.document_grants
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_grant();

CREATE FUNCTION app_private.on_membership_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.removed_at IS DISTINCT FROM OLD.removed_at THEN
    UPDATE app.teams SET authz_epoch = authz_epoch + 1 WHERE id = NEW.team_id;
  END IF;
  IF OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL THEN
    UPDATE app.document_grants SET revoked_at = clock_timestamp(),
      revoked_by_system = 'membership-removal-trigger'
    WHERE grantee_membership_id = NEW.id AND team_id = NEW.team_id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER membership_effects AFTER UPDATE ON app.memberships
  FOR EACH ROW EXECUTE FUNCTION app_private.on_membership_change();

CREATE FUNCTION app_private.guard_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE new_revision integer; old_revision integer;
BEGIN
  PERFORM 1 FROM app.teams WHERE id = NEW.team_id FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.team_id, NEW.created_by_membership_id, NEW.created_at) IS DISTINCT FROM
       (OLD.id, OLD.team_id, OLD.created_by_membership_id, OLD.created_at)
       OR (OLD.deleted_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
       OR NEW.next_version_number < OLD.next_version_number THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Document identity and deletion are immutable';
    END IF;
    IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
      IF NEW.current_version_id IS NULL AND NEW.deleted_at IS NULL AND OLD.current_version_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Live ready content cannot be cleared';
      END IF;
      IF NEW.current_version_id IS NOT NULL THEN
        SELECT version_number INTO new_revision FROM app.document_versions
        WHERE id = NEW.current_version_id AND document_id = NEW.id AND team_id = NEW.team_id AND state = 'ready';
        IF new_revision IS NULL OR NOT EXISTS (
          SELECT 1 FROM app.document_chunks WHERE version_id = NEW.current_version_id
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Current content requires a ready nonempty same-document version';
        END IF;
        IF OLD.current_version_id IS NOT NULL THEN
          SELECT version_number INTO old_revision FROM app.document_versions WHERE id = OLD.current_version_id;
          IF new_revision < old_revision THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Current version cannot move backward';
          END IF;
        END IF;
      END IF;
    END IF;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      UPDATE app.messages m SET permanently_unavailable_at = clock_timestamp(), unavailable_reason = 'deleted_source'
      WHERE m.kind = 'assistant' AND m.permanently_unavailable_at IS NULL
        AND EXISTS (SELECT 1 FROM app.message_sources s WHERE s.message_id = m.id
          AND s.document_id = NEW.id AND s.team_id = NEW.team_id);
    END IF;
    IF NEW.visibility IS DISTINCT FROM OLD.visibility OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      UPDATE app.teams SET authz_epoch = authz_epoch + 1 WHERE id = NEW.team_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER document_guard BEFORE INSERT OR UPDATE ON app.documents
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_document();

CREATE FUNCTION app_private.check_uploader_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.document_grants g WHERE g.document_id = NEW.id AND g.team_id = NEW.team_id
    AND g.grantee_membership_id = NEW.created_by_membership_id AND g.revoked_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'New document requires an initial uploader read grant';
  END IF;
  RETURN NULL;
END;
$function$;
CREATE CONSTRAINT TRIGGER document_initial_grant AFTER INSERT ON app.documents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.check_uploader_grant();

CREATE FUNCTION app_private.guard_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  PERFORM 1 FROM app.teams WHERE id = NEW.team_id FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['state', 'embedding_profile_id', 'embedding_dimensions', 'ready_at', 'failure_code'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'embedding_profile_id', 'embedding_dimensions', 'ready_at', 'failure_code'])
      OR (OLD.embedding_profile_id IS NOT NULL AND (NEW.embedding_profile_id, NEW.embedding_dimensions)
        IS DISTINCT FROM (OLD.embedding_profile_id, OLD.embedding_dimensions))
      OR (OLD.state = 'ready' AND NEW.state NOT IN ('ready', 'purged'))
      OR (OLD.state = 'purged' AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Content revisions and ready content are immutable';
    END IF;
  END IF;
  IF NEW.state = 'ready' AND EXISTS (SELECT 1 FROM app.documents WHERE id = NEW.document_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Deleted content cannot become ready';
  END IF;
  IF NEW.state = 'purged' AND NOT EXISTS (SELECT 1 FROM app.documents WHERE id = NEW.document_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Individual live-version purge is unsupported';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER version_guard BEFORE INSERT OR UPDATE ON app.document_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_version();

CREATE FUNCTION app_private.check_ready_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM app.document_versions WHERE id = NEW.id AND state = 'ready')
    AND NOT EXISTS (SELECT 1 FROM app.document_chunks WHERE version_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Ready version must contain chunks';
  END IF;
  RETURN NULL;
END;
$function$;
CREATE CONSTRAINT TRIGGER ready_version_chunks AFTER INSERT OR UPDATE ON app.document_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.check_ready_version();

CREATE FUNCTION app_private.guard_chunk() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE target_version uuid; version_state text; deleted timestamptz;
BEGIN
  PERFORM 1 FROM app.teams
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.team_id ELSE NEW.team_id END FOR SHARE;
  target_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  SELECT v.state, d.deleted_at INTO version_state, deleted
    FROM app.document_versions v JOIN app.documents d ON d.id = v.document_id WHERE v.id = target_version;
  IF TG_OP = 'DELETE' THEN
    IF deleted IS NULL THEN
      IF version_state = 'ready' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Ready chunks cannot be removed from a live document';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM app.message_sources s JOIN app.messages m ON m.id = s.message_id
      WHERE s.chunk_id = OLD.id AND m.permanently_unavailable_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalidate dependent answers before purging chunks';
    END IF;
    RETURN OLD;
  END IF;
  IF version_state IN ('ready', 'purged') OR deleted IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Chunks may only be staged for live unfinished versions';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.team_id, NEW.document_id, NEW.version_id) IS DISTINCT FROM
    (OLD.id, OLD.team_id, OLD.document_id, OLD.version_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Chunk identity is immutable';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER chunk_guard BEFORE INSERT OR UPDATE OR DELETE ON app.document_chunks
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_chunk();

CREATE FUNCTION app_private.guard_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  IF (OLD.kind = 'user' AND NEW IS DISTINCT FROM OLD)
    OR ((to_jsonb(NEW) - ARRAY['body_text', 'finalized_at', 'permanently_unavailable_at', 'unavailable_reason'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['body_text', 'finalized_at', 'permanently_unavailable_at', 'unavailable_reason']))
    OR (OLD.finalized_at IS NOT NULL AND (NEW.body_text, NEW.finalized_at) IS DISTINCT FROM (OLD.body_text, OLD.finalized_at))
    OR (OLD.permanently_unavailable_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Message identity, finalized content and invalidation are immutable';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER message_guard BEFORE UPDATE ON app.messages FOR EACH ROW EXECUTE FUNCTION app_private.guard_message();

CREATE FUNCTION app_private.guard_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE target_message uuid; parent app.messages; chunk app.document_chunks;
BEGIN
  PERFORM 1 FROM app.teams
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.team_id ELSE NEW.team_id END FOR SHARE;
  target_message := CASE WHEN TG_OP = 'DELETE' THEN OLD.message_id ELSE NEW.message_id END;
  SELECT * INTO parent FROM app.messages WHERE id = target_message;
  IF TG_OP <> 'INSERT' THEN
    IF parent.permanently_unavailable_at IS NULL AND NOT EXISTS (
      SELECT 1 FROM app.conversations WHERE id = parent.conversation_id AND deleted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalidate dependent answer before changing provenance';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF (to_jsonb(NEW) - 'chunk_id') IS DISTINCT FROM (to_jsonb(OLD) - 'chunk_id') OR NEW.chunk_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Purged provenance may only clear its chunk pointer';
    END IF;
    RETURN NEW;
  END IF;
  IF parent.finalized_at IS NOT NULL OR NEW.chunk_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Attach real sources before finalizing an answer';
  END IF;
  SELECT * INTO chunk FROM app.document_chunks WHERE id = NEW.chunk_id;
  IF chunk.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM app.document_versions v JOIN app.documents d ON d.id = v.document_id AND d.team_id = v.team_id
    WHERE v.id = chunk.version_id AND v.state = 'ready' AND d.deleted_at IS NULL
  ) OR (NEW.location_kind, NEW.page_start, NEW.page_end, NEW.line_start, NEW.line_end)
    IS DISTINCT FROM (chunk.location_kind, chunk.page_start, chunk.page_end, chunk.line_start, chunk.line_end) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Source requires a ready live chunk and its recorded location';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER source_guard BEFORE INSERT OR UPDATE OR DELETE ON app.message_sources
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_source();

CREATE FUNCTION app_private.check_message_provenance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE target_message uuid; parent app.messages; source_count bigint; citation_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'messages' THEN target_message := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN target_message := OLD.message_id;
  ELSE target_message := NEW.message_id;
  END IF;
  SELECT * INTO parent FROM app.messages WHERE id = target_message;
  IF parent.id IS NULL OR parent.kind = 'user' OR parent.permanently_unavailable_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM app.conversations WHERE id = parent.conversation_id AND deleted_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  SELECT count(*), count(*) FILTER (WHERE is_cited) INTO source_count, citation_count
    FROM app.message_sources WHERE message_id = target_message;
  IF parent.finalized_at IS NULL OR source_count <> parent.expected_source_count
    OR (parent.answer_kind = 'grounded' AND (source_count = 0 OR citation_count = 0)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Assistant answer requires complete finalized provenance';
  END IF;
  RETURN NULL;
END;
$function$;
CREATE CONSTRAINT TRIGGER message_provenance_complete AFTER INSERT OR UPDATE ON app.messages
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.check_message_provenance();
CREATE CONSTRAINT TRIGGER source_provenance_complete AFTER INSERT OR UPDATE OR DELETE ON app.message_sources
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.check_message_provenance();

CREATE FUNCTION app_private.guard_scoped_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  IF NEW.team_id IS DISTINCT FROM OLD.team_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Team-scoped identity cannot be reassigned';
  END IF;
  RETURN NEW;
END;
$function$;
DO $identity_triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['storage_intents', 'processing_jobs', 'outbox_events', 'conversations',
    'usage_periods', 'usage_reservations', 'usage_attempts', 'feedback'] LOOP
    EXECUTE format('CREATE TRIGGER scoped_identity BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app_private.guard_scoped_identity()', table_name);
  END LOOP;
END;
$identity_triggers$;

CREATE FUNCTION app_private.check_audit_shape() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE detail record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Audit history is append-only';
  END IF;
  FOR detail IN SELECT key, value FROM jsonb_each(NEW.details) LOOP
    IF detail.key IN ('role_before', 'role_after') THEN
      IF detail.value #>> '{}' NOT IN ('viewer', 'editor', 'admin') THEN RAISE check_violation; END IF;
    ELSIF detail.key IN ('visibility_before', 'visibility_after') THEN
      IF detail.value #>> '{}' NOT IN ('team', 'restricted') THEN RAISE check_violation; END IF;
    ELSIF detail.key IN ('version_number', 'monthly_limit_before', 'monthly_limit_after') THEN
      IF jsonb_typeof(detail.value) <> 'number' OR detail.value::text !~ '^[0-9]+$' THEN RAISE check_violation; END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Audit details contain a non-allowlisted field';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER audit_append_only BEFORE INSERT OR UPDATE OR DELETE ON app.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app_private.check_audit_shape();

CREATE FUNCTION app_private.append_audit(target_team uuid, event_action text, event_target_type text,
  event_target uuid, event_details jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE actor_membership uuid; actor_user uuid;
BEGIN
  SELECT id, user_id INTO actor_membership, actor_user FROM app.memberships
    WHERE id = app_private.context_uuid('app.membership_id') AND team_id = target_team
      AND user_id = app_private.context_uuid('app.user_id');
  INSERT INTO app.audit_logs(team_id, actor_kind, actor_user_id, actor_membership_id, system_actor,
    action, target_type, target_id, request_id, details)
  VALUES (target_team, CASE WHEN actor_membership IS NULL THEN 'system' ELSE 'user' END,
    actor_user, actor_membership, CASE WHEN actor_membership IS NULL THEN 'database:' || session_user ELSE NULL END,
    event_action, event_target_type, event_target,
    coalesce(app_private.context_uuid('app.request_id'), gen_random_uuid()), event_details);
END;
$function$;

CREATE FUNCTION app_private.audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE event_action text; event_target_type text; event_target uuid; target_team uuid; details jsonb := '{}';
BEGIN
  IF TG_TABLE_NAME = 'teams' THEN
    target_team := NEW.id; event_target_type := 'team'; event_target := NEW.id;
    IF TG_OP = 'INSERT' THEN event_action := 'team.created'; END IF;
  ELSIF TG_TABLE_NAME = 'memberships' THEN
    target_team := NEW.team_id; event_target_type := 'membership'; event_target := NEW.id;
    IF TG_OP = 'INSERT' THEN event_action := 'membership.joined'; details := jsonb_build_object('role_after', NEW.role);
    ELSIF NEW.removed_at IS DISTINCT FROM OLD.removed_at THEN event_action := 'membership.removed';
    ELSIF NEW.role IS DISTINCT FROM OLD.role THEN event_action := 'membership.role_changed';
      details := jsonb_build_object('role_before', OLD.role, 'role_after', NEW.role);
    END IF;
  ELSIF TG_TABLE_NAME = 'documents' THEN
    target_team := NEW.team_id; event_target_type := 'document'; event_target := NEW.id;
    IF TG_OP = 'INSERT' THEN event_action := 'document.created';
    ELSIF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN event_action := 'document.deleted';
    ELSIF NEW.visibility IS DISTINCT FROM OLD.visibility THEN event_action := 'document.visibility_changed';
      details := jsonb_build_object('visibility_before', OLD.visibility, 'visibility_after', NEW.visibility);
    ELSIF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN event_action := 'document.version_activated';
    ELSIF NEW.title IS DISTINCT FROM OLD.title THEN event_action := 'document.metadata_changed';
    END IF;
  ELSIF TG_TABLE_NAME = 'document_grants' THEN
    target_team := NEW.team_id; event_target_type := 'document'; event_target := NEW.document_id;
    IF TG_OP = 'INSERT' THEN event_action := 'document.grant_created';
    ELSIF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN event_action := 'document.grant_revoked';
    END IF;
    IF event_action IS NOT NULL THEN UPDATE app.teams SET authz_epoch = authz_epoch + 1 WHERE id = target_team; END IF;
  ELSIF TG_TABLE_NAME = 'document_versions' THEN
    target_team := NEW.team_id; event_target_type := 'document'; event_target := NEW.document_id;
    IF TG_OP = 'INSERT' THEN event_action := 'document.version_recorded';
    ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state = 'ready' THEN event_action := 'document.version_ready';
    ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state = 'failed' THEN event_action := 'document.version_failed';
    END IF;
    details := jsonb_build_object('version_number', NEW.version_number);
  ELSIF TG_TABLE_NAME = 'usage_budgets' THEN
    target_team := NEW.team_id; event_target_type := 'usage_budget'; event_target := NEW.team_id;
    IF TG_OP = 'INSERT' THEN event_action := 'usage.budget_created';
      details := jsonb_build_object('monthly_limit_after', NEW.monthly_answer_limit);
    ELSIF NEW.monthly_answer_limit IS DISTINCT FROM OLD.monthly_answer_limit THEN event_action := 'usage.budget_changed';
      details := jsonb_build_object('monthly_limit_before', OLD.monthly_answer_limit, 'monthly_limit_after', NEW.monthly_answer_limit);
    END IF;
  END IF;
  IF event_action IS NOT NULL THEN
    PERFORM app_private.append_audit(target_team, event_action, event_target_type, event_target, details);
  END IF;
  RETURN NEW;
END;
$function$;
DO $audit_triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['teams', 'memberships', 'documents', 'document_grants', 'document_versions', 'usage_budgets'] LOOP
    EXECUTE format('CREATE TRIGGER z_audit_row AFTER INSERT OR UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app_private.audit_row_change()', table_name);
  END LOOP;
END;
$audit_triggers$;

CREATE FUNCTION app_private.guard_named_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE field_name text;
BEGIN
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) -> field_name) IS DISTINCT FROM (to_jsonb(OLD) -> field_name) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Structural identity is immutable';
    END IF;
  END LOOP;
  IF TG_TABLE_NAME = 'conversations' THEN
    IF OLD.deleted_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Deleted conversation cannot be restored';
    END IF;
  ELSIF TG_TABLE_NAME = 'usage_reservations' THEN
    IF OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Completed idempotency record cannot be reopened';
    END IF;
  ELSIF TG_TABLE_NAME = 'usage_attempts' THEN
    IF OLD.state <> 'held' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Terminal usage attempt is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER team_identity BEFORE UPDATE ON app.teams FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_named_identity('id', 'organization_id', 'created_at');
CREATE TRIGGER storage_identity BEFORE UPDATE ON app.storage_intents FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_named_identity('id', 'team_id', 'uploader_membership_id', 'target_document_id', 'bucket', 'object_key', 'created_at');
CREATE TRIGGER conversation_identity BEFORE UPDATE ON app.conversations FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_named_identity('id', 'team_id', 'owner_membership_id', 'created_at');
CREATE TRIGGER budget_identity BEFORE UPDATE ON app.usage_budgets FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_named_identity('team_id');
CREATE TRIGGER request_identity BEFORE UPDATE ON app.usage_reservations FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_named_identity('id', 'team_id', 'owner_membership_id', 'conversation_id', 'idempotency_key', 'request_fingerprint', 'created_at');
CREATE TRIGGER attempt_identity BEFORE UPDATE ON app.usage_attempts FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_named_identity('id', 'team_id', 'reservation_id', 'attempt_number', 'period_id', 'started_at');

CREATE FUNCTION app_private.guard_budget_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An existing team must retain its budget';
END;
$function$;
CREATE TRIGGER budget_retained BEFORE DELETE ON app.usage_budgets FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_budget_delete();

CREATE FUNCTION app_private.guard_embedding_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM app.document_versions WHERE embedding_profile_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An in-use embedding profile is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER profile_identity BEFORE UPDATE OR DELETE ON app.embedding_profiles FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_embedding_profile();

-- Only functions created in this migration transfer to the command role.
DO $command_owners$
DECLARE function_record record;
BEGIN
  FOR function_record IN
    SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private' AND p.proowner = 'app_owner'::regrole
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, app_api, app_worker', function_record.signature);
    EXECUTE format('ALTER FUNCTION %s OWNER TO app_commands', function_record.signature);
  END LOOP;
END;
$command_owners$;
REVOKE CREATE ON SCHEMA app_private FROM app_commands, app_policy_reader;
