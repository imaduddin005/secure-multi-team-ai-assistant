GRANT CREATE ON SCHEMA app_private TO app_commands;
CREATE FUNCTION app_private.close_attempt(p_request uuid,p_fence int,p_state text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE attempt app.usage_attempts;
BEGIN
  IF p_state NOT IN ('charged','released','expired') THEN RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
  SELECT * INTO attempt FROM app.usage_attempts WHERE reservation_id=p_request AND attempt_number=p_fence FOR UPDATE;
  IF attempt.id IS NULL OR attempt.state<>'held' THEN RETURN false; END IF;
  UPDATE app.usage_periods SET held_count=held_count-1,used_count=used_count+CASE WHEN p_state='charged' THEN 1 ELSE 0 END
    WHERE id=attempt.period_id AND held_count>0;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNTING_ERROR'; END IF;
  UPDATE app.usage_attempts SET state=p_state,finalized_at=clock_timestamp() WHERE id=attempt.id;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.close_attempt(uuid,int,text) FROM PUBLIC,app_api,app_worker;
ALTER FUNCTION app_private.close_attempt(uuid,int,text) OWNER TO app_commands;

CREATE FUNCTION app_private.quota_command(operation text,payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE actor app_private.actor; reservation app.usage_reservations; attempt app.usage_attempts;
  period app.usage_periods; budget app.usage_budgets; start_at timestamptz; fence int;
BEGIN
  -- A removed owner may release only their own fenced in-flight hold, never read it.
  IF operation='cancel' THEN
    PERFORM 1 FROM app.teams WHERE id=app_private.context_uuid('app.team_id') FOR UPDATE;
    SELECT r.* INTO reservation FROM app.usage_reservations r JOIN app.memberships m ON m.id=r.owner_membership_id
      WHERE r.id=(payload->>'requestId')::uuid AND r.team_id=app_private.context_uuid('app.team_id')
        AND m.user_id=app_private.context_uuid('app.user_id') FOR UPDATE OF r;
    IF reservation.id IS NOT NULL AND reservation.status<>'completed'
      AND reservation.current_attempt_number=(payload->>'token')::int THEN
      IF app_private.close_attempt(reservation.id,reservation.current_attempt_number,'released') THEN
        UPDATE app.usage_reservations SET status=CASE WHEN coalesce((payload->>'blocked')::boolean,false) THEN 'blocked' ELSE 'retryable_failed' END
          WHERE id=reservation.id;
      END IF;
    END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;
  actor:=app_private.require_actor();
  IF operation='reserve' THEN
    IF NOT app_private.can_read_conversation((payload->>'conversationId')::uuid) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    SELECT * INTO reservation FROM app.usage_reservations WHERE team_id=actor.team_id
      AND owner_membership_id=actor.membership_id AND idempotency_key=payload->>'key' FOR UPDATE;
    IF reservation.id IS NOT NULL THEN
      IF reservation.request_fingerprint<>payload->>'fingerprint' THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
      IF reservation.status='completed' THEN RETURN jsonb_build_object('status','completed','requestId',reservation.id); END IF;
      IF reservation.status='blocked' THEN RAISE EXCEPTION 'SOURCE_UNAVAILABLE'; END IF;
      SELECT * INTO attempt FROM app.usage_attempts WHERE reservation_id=reservation.id AND attempt_number=reservation.current_attempt_number;
      IF attempt.state='held' THEN
        IF attempt.lease_expires_at>clock_timestamp() THEN RAISE EXCEPTION 'IN_PROGRESS'; END IF;
        PERFORM app_private.close_attempt(reservation.id,attempt.attempt_number,'expired');
      END IF;
    ELSE
      INSERT INTO app.usage_reservations(team_id,owner_membership_id,conversation_id,idempotency_key,request_fingerprint)
        VALUES(actor.team_id,actor.membership_id,(payload->>'conversationId')::uuid,payload->>'key',payload->>'fingerprint') RETURNING * INTO reservation;
      INSERT INTO app.messages(team_id,owner_membership_id,conversation_id,request_id,kind,body_text)
        VALUES(actor.team_id,actor.membership_id,reservation.conversation_id,reservation.id,'user',payload->>'question');
    END IF;
    start_at:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    INSERT INTO app.usage_periods(team_id,period_start,period_end) VALUES(actor.team_id,start_at,
      ((start_at AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC') ON CONFLICT(team_id,period_start) DO NOTHING;
    SELECT * INTO budget FROM app.usage_budgets WHERE team_id=actor.team_id FOR UPDATE;
    SELECT * INTO period FROM app.usage_periods WHERE team_id=actor.team_id AND period_start=start_at FOR UPDATE;
    IF period.used_count+period.held_count>=budget.monthly_answer_limit THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
    fence:=coalesce(reservation.current_attempt_number,0)+1;
    INSERT INTO app.usage_attempts(team_id,reservation_id,attempt_number,period_id,lease_expires_at)
      VALUES(actor.team_id,reservation.id,fence,period.id,clock_timestamp()+interval '2 minutes');
    UPDATE app.usage_reservations SET status='in_progress',current_attempt_number=fence WHERE id=reservation.id;
    UPDATE app.usage_periods SET held_count=held_count+1 WHERE id=period.id;
    RETURN jsonb_build_object('status','reserved','requestId',reservation.id,'token',fence);
  ELSIF operation='heartbeat' THEN
    SELECT * INTO reservation FROM app.usage_reservations WHERE id=(payload->>'requestId')::uuid
      AND owner_membership_id=actor.membership_id AND team_id=actor.team_id;
    IF reservation.id IS NULL OR reservation.current_attempt_number<>(payload->>'token')::int OR reservation.status<>'in_progress'
      THEN RAISE EXCEPTION 'STALE_ATTEMPT'; END IF;
    UPDATE app.usage_attempts SET lease_expires_at=clock_timestamp()+interval '2 minutes'
      WHERE reservation_id=reservation.id AND attempt_number=reservation.current_attempt_number
        AND state='held' AND lease_expires_at>clock_timestamp();
    IF NOT FOUND THEN RAISE EXCEPTION 'STALE_ATTEMPT'; END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;
  RAISE EXCEPTION 'INVALID_OPERATION';
END;
$function$;
REVOKE ALL ON FUNCTION app_private.quota_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.quota_command(text,jsonb) TO app_api;
ALTER FUNCTION app_private.quota_command(text,jsonb) OWNER TO app_commands;

CREATE FUNCTION app_private.recover_quota() RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE candidate record; n int:=0;
BEGIN
  FOR candidate IN SELECT a.reservation_id,a.attempt_number,a.team_id FROM app.usage_attempts a
    WHERE a.state='held' AND a.lease_expires_at<=clock_timestamp() ORDER BY a.team_id,a.id LIMIT 100 LOOP
    PERFORM 1 FROM app.teams WHERE id=candidate.team_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM app.usage_attempts WHERE reservation_id=candidate.reservation_id
      AND attempt_number=candidate.attempt_number AND state='held' AND lease_expires_at<=clock_timestamp()) THEN
      IF app_private.close_attempt(candidate.reservation_id,candidate.attempt_number,'expired') THEN
        UPDATE app.usage_reservations SET status='retryable_failed' WHERE id=candidate.reservation_id
          AND current_attempt_number=candidate.attempt_number AND status<>'completed';
        n:=n+1;
      END IF;
    END IF;
  END LOOP;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.recover_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.recover_quota() TO app_worker;
ALTER FUNCTION app_private.recover_quota() OWNER TO app_commands;
REVOKE CREATE ON SCHEMA app_private FROM app_commands;
