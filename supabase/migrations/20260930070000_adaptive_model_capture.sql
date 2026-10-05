-- Preserve the existing hourly broad-discovery job; add bounded near-game work.
create or replace function public.trigger_adaptive_model_audit()
returns bigint language plpgsql security invoker set search_path = pg_catalog, public
as $function$
declare
  v_start timestamptz;
  v_last timestamptz;
  v_seconds integer;
begin
  if not pg_try_advisory_xact_lock(74821930) then return null; end if;
  -- Leave room for the existing :20 full-slate request, including clock jitter.
  if extract(minute from now())::integer in (19,20) then return null; end if;
  select min(starts_at) into v_start from public.model_audit_observations
    where sport='MLB' and starts_at > now() and starts_at <= now()+interval '2 hours'
      and captured_at > now()-interval '24 hours';
  if v_start is null then return null; end if;
  select max(enqueued_at) into v_last from public.pipeline_http_request_log where component_key='model_audit';
  -- Bound enqueue frequency. HTTP work has its own 60-second transport deadline.
  v_seconds := case when v_start <= now()+interval '30 minutes' then 60 else 300 end;
  if v_last is null or v_last <= now()-make_interval(secs=>v_seconds) then
    return public.enqueue_pipeline_http_v1('model_audit','{"lookaheadMinutes":120}'::jsonb);
  end if;
  return null;
end;
$function$;
revoke all on function public.trigger_adaptive_model_audit() from public, anon, authenticated;
grant execute on function public.trigger_adaptive_model_audit() to service_role;
select cron.schedule('mlb-model-audit-adaptive','* * * * *','select public.trigger_adaptive_model_audit();');
