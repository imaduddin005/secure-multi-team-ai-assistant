-- No application role owns tables or has BYPASSRLS. Internal roles are NOLOGIN.
GRANT USAGE ON SCHEMA app TO app_api, app_worker, app_commands, app_policy_reader;
GRANT USAGE ON SCHEMA app_private TO app_api, app_worker, app_commands, app_policy_reader;
GRANT CREATE ON SCHEMA app_private TO app_commands, app_policy_reader;

DO $policies$
DECLARE table_name text;
BEGIN
  FOR table_name IN SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY owner_access ON app.%I TO app_owner USING (true) WITH CHECK (true)', table_name);
    EXECUTE format('CREATE POLICY command_access ON app.%I TO app_commands USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END;
$policies$;

-- These columns support boolean policy checks. No answer/chunk text, titles,
-- filenames, feedback comments, object keys, or embedding values are granted.
GRANT SELECT (id, organization_id) ON app.teams TO app_policy_reader;
GRANT SELECT (id, team_id, user_id, role, removed_at) ON app.memberships TO app_policy_reader;
GRANT SELECT (id, team_id, visibility, deleted_at, current_version_id) ON app.documents TO app_policy_reader;
GRANT SELECT (document_id, team_id, grantee_membership_id, revoked_at) ON app.document_grants TO app_policy_reader;
GRANT SELECT (id, document_id, team_id, state) ON app.document_versions TO app_policy_reader;
GRANT SELECT (id, version_id, document_id, team_id, chunk_ordinal) ON app.document_chunks TO app_policy_reader;
GRANT SELECT (id, team_id, owner_membership_id, deleted_at) ON app.conversations TO app_policy_reader;
GRANT SELECT (id, team_id, owner_membership_id, conversation_id, kind, answer_kind,
  expected_source_count, finalized_at, permanently_unavailable_at) ON app.messages TO app_policy_reader;
GRANT SELECT (message_id, team_id, document_id, version_id, chunk_id, is_cited) ON app.message_sources TO app_policy_reader;
GRANT SELECT (id, team_id, owner_membership_id, conversation_id) ON app.usage_reservations TO app_policy_reader;

DO $helper_policies$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['teams', 'memberships', 'documents', 'document_grants',
    'document_versions', 'document_chunks', 'conversations', 'messages', 'message_sources', 'usage_reservations'] LOOP
    EXECUTE format('CREATE POLICY policy_metadata ON app.%I FOR SELECT TO app_policy_reader USING (true)', table_name);
  END LOOP;
END;
$helper_policies$;

CREATE FUNCTION app_private.context_uuid(setting_name text) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $function$
DECLARE value text;
BEGIN
  IF setting_name NOT IN ('app.user_id', 'app.team_id', 'app.membership_id', 'app.request_id') THEN
    RETURN NULL;
  END IF;
  value := nullif(pg_catalog.current_setting(setting_name, true), '');
  RETURN value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$function$;

CREATE FUNCTION app_private.active_membership_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT m.id FROM app.memberships m
  WHERE m.id = app_private.context_uuid('app.membership_id')
    AND m.user_id = app_private.context_uuid('app.user_id')
    AND m.team_id = app_private.context_uuid('app.team_id')
    AND m.removed_at IS NULL;
$function$;

CREATE FUNCTION app_private.current_membership_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT m.role FROM app.memberships m WHERE m.id = app_private.active_membership_id();
$function$;

CREATE FUNCTION app_private.can_access_team(target_team uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT target_team = app_private.context_uuid('app.team_id')
    AND app_private.active_membership_id() IS NOT NULL;
$function$;

CREATE FUNCTION app_private.is_team_admin(target_team uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT coalesce(app_private.can_access_team(target_team)
    AND app_private.current_membership_role() = 'admin', false);
$function$;

CREATE FUNCTION app_private.can_read_document(target_document uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app.documents d
    WHERE d.id = target_document AND d.deleted_at IS NULL
      AND app_private.can_access_team(d.team_id)
      AND (d.visibility = 'team' OR EXISTS (
        SELECT 1 FROM app.document_grants g
        WHERE g.document_id = d.id AND g.team_id = d.team_id
          AND g.grantee_membership_id = app_private.active_membership_id()
          AND g.revoked_at IS NULL
      ))
  );
$function$;

CREATE FUNCTION app_private.can_read_version(target_version uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT EXISTS (SELECT 1 FROM app.document_versions v
    WHERE v.id = target_version AND v.state <> 'purged'
      AND app_private.can_read_document(v.document_id));
$function$;

CREATE FUNCTION app_private.can_read_chunk(target_chunk uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT EXISTS (SELECT 1 FROM app.document_chunks c
    JOIN app.document_versions v ON v.id = c.version_id
      AND v.document_id = c.document_id AND v.team_id = c.team_id
    WHERE c.id = target_chunk AND v.state = 'ready'
      AND app_private.can_read_document(c.document_id));
$function$;

CREATE FUNCTION app_private.can_read_conversation(target_conversation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT EXISTS (SELECT 1 FROM app.conversations c
    WHERE c.id = target_conversation AND c.deleted_at IS NULL
      AND c.owner_membership_id = app_private.active_membership_id()
      AND app_private.can_access_team(c.team_id));
$function$;

CREATE FUNCTION app_private.can_read_message(target_message uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app.messages m
    WHERE m.id = target_message AND m.owner_membership_id = app_private.active_membership_id()
      AND app_private.can_read_conversation(m.conversation_id)
      AND (m.kind = 'user' OR (
        m.finalized_at IS NOT NULL AND m.permanently_unavailable_at IS NULL
        AND m.expected_source_count = (SELECT count(*) FROM app.message_sources s WHERE s.message_id = m.id)
        AND (m.answer_kind = 'insufficient_sources' OR EXISTS (
          SELECT 1 FROM app.message_sources s WHERE s.message_id = m.id AND s.is_cited
        ))
        AND NOT EXISTS (
          SELECT 1 FROM app.message_sources s
          WHERE s.message_id = m.id AND (
            s.chunk_id IS NULL OR NOT app_private.can_read_chunk(s.chunk_id)
          )
        )
      ))
  );
$function$;

CREATE FUNCTION app_private.can_read_reservation(target_request uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT EXISTS (SELECT 1 FROM app.usage_reservations r
    WHERE r.id = target_request AND r.owner_membership_id = app_private.active_membership_id()
      AND app_private.can_read_conversation(r.conversation_id));
$function$;

-- SECURITY DEFINER helpers use a non-owner metadata reader, avoiding recursive RLS.
DO $helper_owners$
DECLARE function_record record;
BEGIN
  FOR function_record IN
    SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_record.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_api, app_worker, app_commands', function_record.signature);
    EXECUTE format('ALTER FUNCTION %s OWNER TO app_policy_reader', function_record.signature);
  END LOOP;
END;
$helper_owners$;

GRANT SELECT ON app.organizations, app.users, app.teams, app.memberships,
  app.documents, app.document_grants, app.embedding_profiles, app.document_versions,
  app.document_chunks, app.conversations, app.messages, app.message_sources,
  app.feedback, app.usage_budgets, app.usage_periods, app.usage_reservations,
  app.usage_attempts, app.audit_logs TO app_api;

CREATE POLICY api_organizations ON app.organizations FOR SELECT TO app_api USING (
  EXISTS (SELECT 1 FROM app.teams t WHERE t.organization_id = organizations.id
    AND app_private.can_access_team(t.id))
);
CREATE POLICY api_users ON app.users FOR SELECT TO app_api USING (id = app_private.context_uuid('app.user_id'));
CREATE POLICY api_teams ON app.teams FOR SELECT TO app_api USING (app_private.can_access_team(id));
CREATE POLICY api_memberships ON app.memberships FOR SELECT TO app_api USING (
  (user_id = app_private.context_uuid('app.user_id') AND removed_at IS NULL)
  OR app_private.is_team_admin(team_id)
);
CREATE POLICY api_documents ON app.documents FOR SELECT TO app_api USING (app_private.can_read_document(id));
CREATE POLICY api_grants ON app.document_grants FOR SELECT TO app_api USING (
  app_private.can_read_document(document_id)
  AND (grantee_membership_id = app_private.active_membership_id() OR app_private.is_team_admin(team_id))
);
CREATE POLICY api_profiles ON app.embedding_profiles FOR SELECT TO app_api USING (app_private.active_membership_id() IS NOT NULL);
CREATE POLICY api_versions ON app.document_versions FOR SELECT TO app_api USING (app_private.can_read_version(id));
CREATE POLICY api_chunks ON app.document_chunks FOR SELECT TO app_api USING (app_private.can_read_chunk(id));
CREATE POLICY api_conversations ON app.conversations FOR SELECT TO app_api USING (app_private.can_read_conversation(id));
CREATE POLICY api_messages ON app.messages FOR SELECT TO app_api USING (app_private.can_read_message(id));
CREATE POLICY api_sources ON app.message_sources FOR SELECT TO app_api USING (app_private.can_read_message(message_id));
CREATE POLICY api_feedback ON app.feedback FOR SELECT TO app_api USING (
  user_id = app_private.context_uuid('app.user_id') AND app_private.can_read_message(message_id)
);
CREATE POLICY api_budgets ON app.usage_budgets FOR SELECT TO app_api USING (app_private.is_team_admin(team_id));
CREATE POLICY api_periods ON app.usage_periods FOR SELECT TO app_api USING (app_private.is_team_admin(team_id));
CREATE POLICY api_reservations ON app.usage_reservations FOR SELECT TO app_api USING (app_private.can_read_reservation(id));
CREATE POLICY api_attempts ON app.usage_attempts FOR SELECT TO app_api USING (app_private.can_read_reservation(reservation_id));
CREATE POLICY api_audit ON app.audit_logs FOR SELECT TO app_api USING (
  app_private.is_team_admin(team_id) AND (
    (target_type = 'document' AND app_private.can_read_document(target_id))
    OR target_type IN ('team', 'membership', 'usage_budget', 'security')
  )
);

-- Workers are trusted service processes. These intentionally broad read policies
-- are not end-user isolation and do not provide access to private chat bodies.
GRANT SELECT ON app.storage_intents, app.document_versions, app.document_chunks,
  app.embedding_profiles, app.processing_jobs, app.outbox_events TO app_worker;
GRANT SELECT (id, team_id, current_version_id, deleted_at, next_version_number) ON app.documents TO app_worker;
DO $worker_policies$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['storage_intents', 'document_versions', 'document_chunks',
    'embedding_profiles', 'processing_jobs', 'outbox_events', 'documents'] LOOP
    EXECUTE format('CREATE POLICY worker_service ON app.%I FOR SELECT TO app_worker USING (true)', table_name);
  END LOOP;
END;
$worker_policies$;

-- Mutation privileges belong only to non-login functions/trigger owners.
-- No API/worker write command is exposed in Module 1.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_commands;
REVOKE UPDATE, DELETE ON app.audit_logs FROM app_commands;

CREATE VIEW app.readable_current_chunks WITH (security_invoker = true, security_barrier = true) AS
  SELECT c.* FROM app.document_chunks c
  JOIN app.documents d ON d.id = c.document_id AND d.team_id = c.team_id
  JOIN app.document_versions v ON v.id = c.version_id AND v.document_id = c.document_id AND v.team_id = c.team_id
  WHERE d.deleted_at IS NULL AND d.current_version_id = v.id AND v.state = 'ready';
GRANT SELECT ON app.readable_current_chunks TO app_api;

-- Baseline private storage access is a later real-service policy migration.
-- Supabase anon/authenticated roles, if present, receive no app schema grants.
