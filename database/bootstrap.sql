-- Run only with a provisioning administrator against a dedicated database.
-- Local development only: managed/shared Supabase role setup needs separate review.
-- Passwords are assigned separately by the local bootstrap tool, never in SQL files.
DO $bootstrap$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'app_owner', 'app_migrator', 'app_api', 'app_worker',
    'app_commands', 'app_policy_reader'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE pg_catalog.format(
        'CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        role_name
      );
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = role_name
        AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit
          OR (role_name IN ('app_owner', 'app_commands', 'app_policy_reader') AND rolcanlogin))
    ) THEN
      RAISE EXCEPTION 'Existing application role has unsafe attributes: %', role_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid = m.member
    WHERE r.rolname IN ('app_api', 'app_worker')) THEN
    RAISE EXCEPTION 'Runtime application roles must not inherit any other roles';
  END IF;
END;
$bootstrap$;

GRANT app_owner TO app_migrator;
GRANT app_commands, app_policy_reader TO app_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION app_owner;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO app_owner, app_commands, app_policy_reader, app_api, app_worker;

DO $database_permissions$
BEGIN
  EXECUTE pg_catalog.format('ALTER DATABASE %I OWNER TO app_owner', pg_catalog.current_database());
  EXECUTE pg_catalog.format('REVOKE ALL ON DATABASE %I FROM PUBLIC', pg_catalog.current_database());
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO app_migrator, app_api, app_worker',
    pg_catalog.current_database()
  );
END;
$database_permissions$;
