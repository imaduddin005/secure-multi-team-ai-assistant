-- Trusted backend passes a user ID only after verifying the external identity.
-- No client-supplied acting-user or membership ID is accepted by HTTP endpoints.
GRANT CREATE ON SCHEMA app_private TO app_commands;
CREATE TYPE app_private.actor AS (user_id uuid, team_id uuid, membership_id uuid, role text);

CREATE FUNCTION app_private.require_actor() RETURNS app_private.actor
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE actor app_private.actor;
BEGIN
  actor.user_id := app_private.context_uuid('app.user_id');
  actor.team_id := app_private.context_uuid('app.team_id');
  IF actor.user_id IS NULL OR actor.team_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM 1 FROM app.teams WHERE id = actor.team_id FOR UPDATE;
  SELECT id, role INTO actor.membership_id, actor.role FROM app.memberships
    WHERE team_id = actor.team_id AND user_id = actor.user_id AND removed_at IS NULL;
  IF actor.membership_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM set_config('app.membership_id', actor.membership_id::text, true);
  RETURN actor;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.require_actor() FROM PUBLIC, app_api, app_worker;
ALTER FUNCTION app_private.require_actor() OWNER TO app_commands;

CREATE FUNCTION app_private.resolve_identity(subject uuid, label text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE identity_id uuid;
BEGIN
  INSERT INTO app.users(auth_subject, display_name) VALUES(subject, left(coalesce(nullif(btrim(label),''),'Member'),120))
    ON CONFLICT (auth_subject) DO UPDATE SET auth_subject = EXCLUDED.auth_subject RETURNING id INTO identity_id;
  RETURN identity_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.resolve_identity(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.resolve_identity(uuid,text) TO app_api;
ALTER FUNCTION app_private.resolve_identity(uuid,text) OWNER TO app_commands;

CREATE FUNCTION app_private.membership_command(operation text, payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE actor app_private.actor; result jsonb; target app.memberships; target_user uuid;
BEGIN
  IF operation = 'me' THEN
    SELECT jsonb_build_object('id',id,'displayName',display_name) INTO result FROM app.users
      WHERE id = app_private.context_uuid('app.user_id');
    IF result IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN result;
  ELSIF operation = 'teams' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'membershipId',m.id,'role',m.role) ORDER BY t.name),'[]')
      INTO result FROM app.memberships m JOIN app.teams t ON t.id=m.team_id
      WHERE m.user_id=app_private.context_uuid('app.user_id') AND m.removed_at IS NULL;
    RETURN result;
  END IF;
  actor := app_private.require_actor();
  IF operation = 'select_team' THEN RETURN to_jsonb(actor); END IF;
  IF actor.role <> 'admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF operation = 'members' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'userId',m.user_id,'displayName',u.display_name,
      'role',m.role,'removedAt',m.removed_at) ORDER BY u.display_name,m.joined_at),'[]') INTO result
      FROM app.memberships m JOIN app.users u ON u.id=m.user_id WHERE m.team_id=actor.team_id;
    RETURN result;
  ELSIF operation = 'add' THEN
    target_user := (payload->>'userId')::uuid;
    IF NOT EXISTS(SELECT 1 FROM app.users WHERE id=target_user) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF EXISTS(SELECT 1 FROM app.memberships WHERE team_id=actor.team_id AND user_id=target_user AND removed_at IS NULL)
      THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;
    INSERT INTO app.memberships(team_id,user_id,role) VALUES(actor.team_id,target_user,payload->>'role') RETURNING * INTO target;
    RETURN jsonb_build_object('id',target.id,'userId',target.user_id,'role',target.role);
  ELSIF operation IN ('role','remove') THEN
    SELECT * INTO target FROM app.memberships WHERE id=(payload->>'membershipId')::uuid
      AND team_id=actor.team_id AND removed_at IS NULL;
    IF target.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF target.role='admin' AND (operation='remove' OR payload->>'role'<>'admin') AND NOT EXISTS(
      SELECT 1 FROM app.memberships WHERE team_id=actor.team_id AND id<>target.id AND role='admin' AND removed_at IS NULL
    ) THEN RAISE EXCEPTION 'LAST_ADMIN'; END IF;
    IF operation='remove' THEN UPDATE app.memberships SET removed_at=clock_timestamp() WHERE id=target.id;
    ELSE UPDATE app.memberships SET role=payload->>'role' WHERE id=target.id;
    END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;
  RAISE EXCEPTION 'INVALID_OPERATION';
END;
$function$;
REVOKE ALL ON FUNCTION app_private.membership_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.membership_command(text,jsonb) TO app_api;
ALTER FUNCTION app_private.membership_command(text,jsonb) OWNER TO app_commands;
REVOKE CREATE ON SCHEMA app_private FROM app_commands;
