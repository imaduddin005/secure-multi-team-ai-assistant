GRANT CREATE ON SCHEMA app_private TO app_commands;
CREATE FUNCTION app_private.admin_command(operation text,payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE actor app_private.actor; result jsonb;
BEGIN
  actor:=app_private.require_actor();
  IF actor.role<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF operation='budget' THEN
    UPDATE app.usage_budgets SET monthly_answer_limit=(payload->>'limit')::int,revision=revision+1,
      updated_by_membership_id=actor.membership_id,updated_at=clock_timestamp() WHERE team_id=actor.team_id;
    RETURN jsonb_build_object('ok',true);
  ELSIF operation='usage' THEN
    SELECT jsonb_build_object('limit',b.monthly_answer_limit,'periodStart',p.period_start,'used',coalesce(p.used_count,0),'held',coalesce(p.held_count,0))
      INTO result FROM app.usage_budgets b LEFT JOIN app.usage_periods p ON p.team_id=b.team_id
        AND p.period_start=(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') WHERE b.team_id=actor.team_id;
    RETURN result;
  ELSIF operation='audit' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(permitted) ORDER BY permitted.occurred_at DESC),'[]') INTO result FROM (
      SELECT id,actor_kind,actor_user_id,system_actor,action,target_type,target_id,occurred_at,request_id,details FROM app.audit_logs
      WHERE team_id=actor.team_id AND ((target_type='document' AND app_private.can_read_document(target_id))
        OR target_type IN ('team','membership','usage_budget','security'))
      ORDER BY occurred_at DESC,id LIMIT 100 OFFSET least(greatest(coalesce((payload->>'offset')::int,0),0),10000)
    ) permitted;
    RETURN result;
  END IF;
  RAISE EXCEPTION 'INVALID_OPERATION';
END;
$function$;
REVOKE ALL ON FUNCTION app_private.admin_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.admin_command(text,jsonb) TO app_api;
ALTER FUNCTION app_private.admin_command(text,jsonb) OWNER TO app_commands;

CREATE FUNCTION app_private.security_event(p_user uuid,p_team uuid,p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
  INSERT INTO app.audit_logs(team_id,actor_kind,actor_user_id,action,target_type,request_id)
    VALUES(CASE WHEN EXISTS(SELECT 1 FROM app.teams WHERE id=p_team) THEN p_team ELSE NULL END,
      CASE WHEN p_user IS NULL THEN 'anonymous' ELSE 'user' END,p_user,'security.denied','security',p_request);
END;
$function$;
REVOKE ALL ON FUNCTION app_private.security_event(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.security_event(uuid,uuid,uuid) TO app_api;
ALTER FUNCTION app_private.security_event(uuid,uuid,uuid) OWNER TO app_commands;
REVOKE CREATE ON SCHEMA app_private FROM app_commands;
