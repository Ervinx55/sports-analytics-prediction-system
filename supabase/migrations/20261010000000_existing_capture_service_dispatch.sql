-- Apply after provisioning performance_service_role_key, BEFORE changed capture handlers.
-- Only the two existing capture components change credentials; all their triggers keep working.
CREATE OR REPLACE FUNCTION public.enqueue_pipeline_http_v1(p_component_key text, p_body jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'net', 'vault'
AS $function$
declare
  v_endpoint text;
  v_url text;
  v_key text;
  v_request_id bigint;
begin
  select endpoint_path
  into v_endpoint
  from public.pipeline_component_registry
  where component_key=p_component_key
    and enabled=true
    and runner_type='HTTP';

  if v_endpoint is null then
    raise exception 'Unknown or disabled HTTP pipeline component: %',p_component_key;
  end if;

  if (p_component_key='model_audit' and v_endpoint <> '/functions/v1/capture-model-audit') or (p_component_key='player_prop_capture' and v_endpoint <> '/functions/v1/capture-player-props') then
    raise exception 'Capture dispatch endpoint mismatch';
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name='snapshot_project_url'
  limit 1;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name=case when p_component_key in ('model_audit','player_prop_capture') then 'performance_service_role_key' else 'snapshot_publishable_key' end
  limit 1;

  if v_url is null or v_key is null then
    raise exception 'Pipeline HTTP credentials are unavailable';
  end if;

  v_request_id := net.http_post(
    url := v_url || v_endpoint,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',v_key,
      'Authorization','Bearer ' || v_key
    ),
    body := coalesce(p_body,'{}'::jsonb),
    timeout_milliseconds := 60000
  );

  insert into public.pipeline_http_request_log(request_id,component_key,enqueued_at)
  values(v_request_id,p_component_key,now())
  on conflict (request_id) do nothing;

  return v_request_id;
end;
$function$;
revoke execute on function public.enqueue_pipeline_http_v1(p_component_key text, p_body jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_pipeline_http_v1(p_component_key text, p_body jsonb) to service_role;

