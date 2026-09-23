-- Reconstructed from production catalog on 2026-09-23.\n-- Catch-up source for fresh environments; do not replay blindly on current production.\n\ncreate table if not exists public.pipeline_component_registry (
  component_key text not null,
  display_name text not null,
  subsystem text not null,
  sport text default 'MLB'::text not null,
  job_name text not null,
  runner_type text not null,
  endpoint_path text,
  expected_interval_minutes integer not null,
  stale_after_minutes integer not null,
  critical boolean default true not null,
  enabled boolean default true not null,
  registered_at timestamp with time zone default now() not null,
  notes text,
  constraint pipeline_component_registry_check CHECK (stale_after_minutes >= expected_interval_minutes),
  constraint pipeline_component_registry_expected_interval_minutes_check CHECK (expected_interval_minutes > 0),
  constraint pipeline_component_registry_runner_type_check CHECK (runner_type = ANY (ARRAY['DATABASE'::text, 'HTTP'::text])),
  constraint pipeline_component_registry_pkey PRIMARY KEY (component_key),
  constraint pipeline_component_registry_job_name_key UNIQUE (job_name)
);\nalter table public.pipeline_component_registry enable row level security;\nrevoke all on table public.pipeline_component_registry from public, anon, authenticated;\ngrant select, insert, update, delete on table public.pipeline_component_registry to service_role;\n\ncreate table if not exists public.pipeline_http_request_log (
  request_id bigint not null,
  component_key text not null,
  enqueued_at timestamp with time zone default now() not null,
  reconciled_at timestamp with time zone,
  responded_at timestamp with time zone,
  status_code integer,
  timed_out boolean,
  error_msg text,
  response_ok boolean,
  response_preview text,
  constraint pipeline_http_request_log_component_key_fkey FOREIGN KEY (component_key) REFERENCES pipeline_component_registry(component_key) ON DELETE CASCADE,
  constraint pipeline_http_request_log_pkey PRIMARY KEY (request_id)
);\nalter table public.pipeline_http_request_log enable row level security;\nrevoke all on table public.pipeline_http_request_log from public, anon, authenticated;\ngrant select, insert, update, delete on table public.pipeline_http_request_log to service_role;\n\nCREATE INDEX IF NOT EXISTS pipeline_http_component_idx ON public.pipeline_http_request_log USING btree (component_key, enqueued_at DESC);\n\nCREATE OR REPLACE FUNCTION public.enqueue_pipeline_http_v1(p_component_key text, p_body jsonb DEFAULT '{}'::jsonb)
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

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name='snapshot_project_url'
  limit 1;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name='snapshot_publishable_key'
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
$function$\nrevoke execute on function public.enqueue_pipeline_http_v1(p_component_key text, p_body jsonb) from public, anon, authenticated;\ngrant execute on function public.enqueue_pipeline_http_v1(p_component_key text, p_body jsonb) to service_role;\n\nCREATE OR REPLACE FUNCTION public.reconcile_pipeline_http_requests_v1()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'net'
AS $function$
declare
  v_count integer := 0;
  v_marked integer := 0;
begin
  update public.pipeline_http_request_log l
  set reconciled_at=now(),
      responded_at=r.created,
      status_code=r.status_code,
      timed_out=coalesce(r.timed_out,false),
      error_msg=r.error_msg,
      response_ok=(
        r.status_code between 200 and 299
        and coalesce(r.timed_out,false)=false
        and r.error_msg is null
      ),
      response_preview=left(coalesce(r.content,''),500)
  from net._http_response r
  where l.request_id=r.id
    and l.reconciled_at is null;

  get diagnostics v_count = row_count;

  update public.pipeline_http_request_log l
  set reconciled_at=now(),
      responded_at=now(),
      response_ok=false,
      error_msg=coalesce(l.error_msg,'NO_HTTP_RESPONSE_WITHIN_3_MINUTES')
  where l.reconciled_at is null
    and l.enqueued_at < now()-interval '3 minutes'
    and not exists (
      select 1 from net.http_request_queue q where q.id=l.request_id
    )
    and not exists (
      select 1 from net._http_response r where r.id=l.request_id
    );

  get diagnostics v_marked = row_count;
  return v_count+v_marked;
end;
$function$\nrevoke execute on function public.reconcile_pipeline_http_requests_v1() from public, anon, authenticated;\ngrant execute on function public.reconcile_pipeline_http_requests_v1() to service_role;\n\nCREATE OR REPLACE FUNCTION public.pipeline_health_snapshot_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'pg_catalog'
AS $function$
declare
  v_result jsonb;
begin
  with jobs as (
    select
      j.jobid,
      j.jobname,
      j.schedule,
      j.active,
      case
        when j.jobname like '%-5min' or j.jobname like '%grading-live%' then 12
        when j.jobname like '%-10min' then 25
        when j.jobname like '%-6hour' then 390
        when j.jobname like '%daily%' or j.jobname like '%retention%' then 1560
        when j.jobname like '%hourly%' then 90
        else 1560
      end::numeric as expected_max_age_minutes
    from cron.job j
  ),
  latest as (
    select distinct on (d.jobid)
      d.jobid,
      d.status,
      d.start_time,
      d.end_time,
      d.return_message
    from cron.job_run_details d
    order by d.jobid,d.start_time desc
  ),
  failures as (
    select
      d.jobid,
      count(*) filter (
        where d.start_time >= now()-interval '24 hours'
          and lower(coalesce(d.status,'')) not in ('succeeded','success')
      ) as failures_24h
    from cron.job_run_details d
    group by d.jobid
  ),
  evaluated as (
    select
      j.*,
      l.status as latest_status,
      l.start_time as latest_start_time,
      l.end_time as latest_end_time,
      l.return_message,
      coalesce(f.failures_24h,0) as failures_24h,
      case
        when l.start_time is null then null
        else round((extract(epoch from (now()-l.start_time))/60.0)::numeric,1)
      end as age_minutes,
      case
        when not j.active then 'INACTIVE'
        when l.start_time is null then 'NEVER_RUN'
        when lower(coalesce(l.status,'')) not in ('succeeded','success') then 'FAILED'
        when extract(epoch from (now()-l.start_time))/60.0 > j.expected_max_age_minutes then 'STALE'
        else 'HEALTHY'
      end as health
    from jobs j
    left join latest l on l.jobid=j.jobid
    left join failures f on f.jobid=j.jobid
  )
  select jsonb_build_object(
    'version','pipeline-health-v1',
    'checkedAt',now(),
    'summary',jsonb_build_object(
      'jobs',count(*),
      'active',count(*) filter (where active),
      'healthy',count(*) filter (where health='HEALTHY'),
      'failed',count(*) filter (where health='FAILED'),
      'stale',count(*) filter (where health='STALE'),
      'neverRun',count(*) filter (where health='NEVER_RUN'),
      'inactive',count(*) filter (where health='INACTIVE'),
      'failures24h',coalesce(sum(failures_24h),0)
    ),
    'jobs',coalesce(jsonb_agg(
      jsonb_build_object(
        'jobId',jobid,
        'name',jobname,
        'schedule',schedule,
        'active',active,
        'health',health,
        'expectedMaxAgeMinutes',expected_max_age_minutes,
        'ageMinutes',age_minutes,
        'latestStatus',latest_status,
        'latestStartAt',latest_start_time,
        'latestEndAt',latest_end_time,
        'failures24h',failures_24h,
        'returnMessage',case
          when health in ('FAILED','STALE') then left(coalesce(return_message,''),500)
          else null
        end
      )
      order by
        case health when 'FAILED' then 0 when 'STALE' then 1 when 'NEVER_RUN' then 2 when 'INACTIVE' then 3 else 4 end,
        jobname
    ),'[]'::jsonb)
  )
  into v_result
  from evaluated;

  return v_result;
end;
$function$\nrevoke execute on function public.pipeline_health_snapshot_v1() from public, anon, authenticated;\ngrant execute on function public.pipeline_health_snapshot_v1() to service_role;\n\ncreate or replace view public.pipeline_component_health_v1 with (security_invoker = true) as\nSELECT r.component_key,
    r.display_name,
    r.subsystem,
    r.sport,
    r.job_name,
    r.runner_type,
    r.expected_interval_minutes,
    r.stale_after_minutes,
    r.critical,
    r.enabled,
    j.jobid,
    j.active AS cron_active,
    cr.status AS cron_last_status,
    cr.start_time AS cron_last_started_at,
    cr.end_time AS cron_last_ended_at,
        CASE
            WHEN cr.start_time IS NULL THEN NULL::numeric
            ELSE round(EXTRACT(epoch FROM now() - cr.start_time) / 60.0, 2)
        END AS cron_age_minutes,
    h.request_id AS http_request_id,
    h.enqueued_at AS http_enqueued_at,
    h.responded_at AS http_responded_at,
    h.status_code AS http_status_code,
    h.timed_out AS http_timed_out,
    h.error_msg AS http_error_msg,
    h.response_ok AS http_ok,
        CASE
            WHEN h.enqueued_at IS NULL THEN NULL::numeric
            ELSE round(EXTRACT(epoch FROM now() - h.enqueued_at) / 60.0, 2)
        END AS http_age_minutes,
    COALESCE(stats.runs_24h, 0) AS cron_runs_24h,
    COALESCE(stats.failed_runs_24h, 0) AS cron_failed_runs_24h,
        CASE
            WHEN COALESCE(stats.runs_24h, 0) = 0 THEN NULL::numeric
            ELSE round((1::numeric - stats.failed_runs_24h::numeric / stats.runs_24h::numeric) * 100::numeric, 2)
        END AS cron_success_rate_24h_pct,
        CASE
            WHEN r.enabled = false THEN 'DISABLED'::text
            WHEN j.jobid IS NULL THEN 'MISSING_JOB'::text
            WHEN COALESCE(j.active, false) = false THEN 'CRON_DISABLED'::text
            WHEN cr.start_time IS NULL AND (now() - r.registered_at) <= make_interval(mins => r.stale_after_minutes) THEN 'WARMING_UP'::text
            WHEN cr.start_time IS NULL THEN 'NEVER_RAN'::text
            WHEN cr.status IS DISTINCT FROM 'succeeded'::text THEN 'CRON_FAILED'::text
            WHEN (now() - cr.start_time) > make_interval(mins => r.stale_after_minutes) THEN 'CRON_STALE'::text
            WHEN r.runner_type = 'HTTP'::text AND h.request_id IS NULL AND (now() - r.registered_at) <= make_interval(mins => r.stale_after_minutes) THEN 'WARMING_UP'::text
            WHEN r.runner_type = 'HTTP'::text AND h.request_id IS NULL THEN 'HTTP_NOT_OBSERVED'::text
            WHEN r.runner_type = 'HTTP'::text AND h.reconciled_at IS NULL AND (now() - h.enqueued_at) <= '00:03:00'::interval THEN 'HTTP_PENDING'::text
            WHEN r.runner_type = 'HTTP'::text AND h.reconciled_at IS NULL THEN 'HTTP_NO_RESPONSE'::text
            WHEN r.runner_type = 'HTTP'::text AND COALESCE(h.response_ok, false) = false THEN 'HTTP_FAILED'::text
            WHEN r.runner_type = 'HTTP'::text AND (now() - h.enqueued_at) > make_interval(mins => r.stale_after_minutes) THEN 'HTTP_STALE'::text
            ELSE 'HEALTHY'::text
        END AS health_status,
        CASE
            WHEN r.enabled = false THEN 'Component monitoring is disabled.'::text
            WHEN j.jobid IS NULL THEN 'Expected cron job is missing.'::text
            WHEN COALESCE(j.active, false) = false THEN 'Cron job is disabled.'::text
            WHEN cr.start_time IS NULL THEN 'No cron execution has been observed yet.'::text
            WHEN cr.status IS DISTINCT FROM 'succeeded'::text THEN 'The latest cron execution did not succeed.'::text
            WHEN (now() - cr.start_time) > make_interval(mins => r.stale_after_minutes) THEN 'The latest cron execution is older than its freshness SLO.'::text
            WHEN r.runner_type = 'HTTP'::text AND h.request_id IS NULL THEN 'No instrumented HTTP request has been observed yet.'::text
            WHEN r.runner_type = 'HTTP'::text AND h.reconciled_at IS NULL THEN 'The latest HTTP request is awaiting reconciliation.'::text
            WHEN r.runner_type = 'HTTP'::text AND COALESCE(h.response_ok, false) = false THEN 'The latest Edge Function request failed or timed out.'::text
            WHEN r.runner_type = 'HTTP'::text AND (now() - h.enqueued_at) > make_interval(mins => r.stale_after_minutes) THEN 'The latest successful HTTP request is older than its freshness SLO.'::text
            ELSE 'Cron execution and downstream runner are within the configured SLO.'::text
        END AS health_reason
   FROM pipeline_component_registry r
     LEFT JOIN cron.job j ON j.jobname = r.job_name
     LEFT JOIN LATERAL ( SELECT d.status,
            d.start_time,
            d.end_time,
            d.return_message
           FROM cron.job_run_details d
          WHERE d.jobid = j.jobid
          ORDER BY d.start_time DESC
         LIMIT 1) cr ON true
     LEFT JOIN LATERAL ( SELECT l.request_id,
            l.component_key,
            l.enqueued_at,
            l.reconciled_at,
            l.responded_at,
            l.status_code,
            l.timed_out,
            l.error_msg,
            l.response_ok,
            l.response_preview
           FROM pipeline_http_request_log l
          WHERE l.component_key = r.component_key
          ORDER BY l.enqueued_at DESC
         LIMIT 1) h ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS runs_24h,
            count(*) FILTER (WHERE d.status IS DISTINCT FROM 'succeeded'::text)::integer AS failed_runs_24h
           FROM cron.job_run_details d
          WHERE d.jobid = j.jobid AND d.start_time >= (now() - '24:00:00'::interval)) stats ON true
  WHERE r.enabled = true;\n;\nrevoke all on table public.pipeline_component_health_v1 from public, anon, authenticated;\ngrant select on table public.pipeline_component_health_v1 to service_role;\n\ninsert into public.pipeline_component_registry\nselect * from jsonb_populate_recordset(null::public.pipeline_component_registry, '[{"notes":"Time-to-start calibration snapshots.","sport":"MLB","enabled":true,"critical":false,"job_name":"decision-timing-shadow-5min","subsystem":"Timing","runner_type":"DATABASE","display_name":"Decision Timing","component_key":"decision_timing","endpoint_path":null,"registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Market-specific shadow thresholds.","sport":"MLB","enabled":true,"critical":true,"job_name":"market-policy-shadow-5min","subsystem":"Decision","runner_type":"DATABASE","display_name":"Market Policy","component_key":"market_policy","endpoint_path":null,"registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Captures current team-market model observations.","sport":"MLB","enabled":true,"critical":true,"job_name":"mlb-model-audit-hourly","subsystem":"Model","runner_type":"HTTP","display_name":"Model Audit Capture","component_key":"model_audit","endpoint_path":"/functions/v1/capture-model-audit","registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":80,"expected_interval_minutes":60},{"notes":"Refreshes champion/challenger diagnostics.","sport":"MLB","enabled":true,"critical":false,"job_name":"model-governance-6hour","subsystem":"Governance","runner_type":"HTTP","display_name":"Model Governance","component_key":"model_governance","endpoint_path":"/functions/v1/refresh-model-governance","registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":390,"expected_interval_minutes":360},{"notes":"Separates process quality from final outcome.","sport":"MLB","enabled":true,"critical":false,"job_name":"decision-outcome-attribution-10min","subsystem":"Results","runner_type":"DATABASE","display_name":"Outcome Attribution","component_key":"outcome_attribution","endpoint_path":null,"registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":22,"expected_interval_minutes":10},{"notes":"Correlation classification and pair audit.","sport":"MLB","enabled":true,"critical":false,"job_name":"parlay-correlation-shadow-5min","subsystem":"Parlay","runner_type":"DATABASE","display_name":"Parlay Correlation","component_key":"parlay_correlation","endpoint_path":null,"registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Captures player prop board and model observations.","sport":"MLB","enabled":true,"critical":true,"job_name":"mlb-player-props-capture-hourly","subsystem":"Props","runner_type":"HTTP","display_name":"Player Prop Capture","component_key":"player_prop_capture","endpoint_path":"/functions/v1/capture-player-props","registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":80,"expected_interval_minutes":60},{"notes":"Buy-point and price-state shadow.","sport":"MLB","enabled":true,"critical":true,"job_name":"market-price-sensitivity-shadow-5min","subsystem":"Decision","runner_type":"DATABASE","display_name":"Price Sensitivity","component_key":"price_sensitivity","endpoint_path":null,"registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Tracks player-prop market movement and close.","sport":"MLB","enabled":true,"critical":true,"job_name":"mlb-player-prop-clv-5min","subsystem":"Calibration","runner_type":"HTTP","display_name":"Player Prop CLV","component_key":"prop_clv","endpoint_path":"/functions/v1/refresh-player-prop-clv","registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Prop signal conflict resolver.","sport":"MLB","enabled":true,"critical":true,"job_name":"player-prop-decision-fusion-5min","subsystem":"Decision","runner_type":"DATABASE","display_name":"Prop Decision Fusion","component_key":"prop_fusion","endpoint_path":null,"registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Grades player props during live windows.","sport":"MLB","enabled":true,"critical":true,"job_name":"mlb-player-props-grading-live","subsystem":"Results","runner_type":"HTTP","display_name":"Player Prop Grading","component_key":"prop_grading","endpoint_path":"/functions/v1/grade-player-props","registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Tracks team-market closing value.","sport":"MLB","enabled":true,"critical":true,"job_name":"mlb-sharp-clv-10min","subsystem":"Calibration","runner_type":"HTTP","display_name":"Team Sharp CLV","component_key":"sharp_clv","endpoint_path":"/functions/v1/capture-sharp-clv","registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":22,"expected_interval_minutes":10},{"notes":"Sharp-source disagreement classification.","sport":"MLB","enabled":true,"critical":true,"job_name":"sharp-disagreement-shadow-5min","subsystem":"Sharp","runner_type":"DATABASE","display_name":"Sharp Disagreement","component_key":"sharp_disagreement","endpoint_path":null,"registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Refreshes automated sharp-source quotes.","sport":"MLB","enabled":true,"critical":true,"job_name":"mlb-sharp-sources-5min","subsystem":"Sharp","runner_type":"HTTP","display_name":"Sharp Source Refresh","component_key":"sharp_sources","endpoint_path":"/functions/v1/refresh-sharp-sources","registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Team signal conflict resolver.","sport":"MLB","enabled":true,"critical":true,"job_name":"market-decision-fusion-5min","subsystem":"Decision","runner_type":"DATABASE","display_name":"Team Decision Fusion","component_key":"team_fusion","endpoint_path":null,"registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Grades team markets during live windows.","sport":"MLB","enabled":true,"critical":true,"job_name":"mlb-team-market-grading-live","subsystem":"Results","runner_type":"HTTP","display_name":"Team Market Grading","component_key":"team_grading","endpoint_path":"/functions/v1/grade-team-markets","registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Robust-edge uncertainty shadow.","sport":"MLB","enabled":true,"critical":true,"job_name":"market-uncertainty-shadow-5min","subsystem":"Decision","runner_type":"DATABASE","display_name":"Uncertainty Engine","component_key":"uncertainty","endpoint_path":null,"registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Starter, lineup, catcher and role verification.","sport":"MLB","enabled":true,"critical":true,"job_name":"mlb-verification-gate-5min","subsystem":"Context","runner_type":"HTTP","display_name":"Verification Gate","component_key":"verification_gate","endpoint_path":"/functions/v1/refresh-mlb-verification-gate","registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5},{"notes":"Weather, roof and park refresh.","sport":"MLB","enabled":true,"critical":true,"job_name":"mlb-weather-park-5min","subsystem":"Context","runner_type":"HTTP","display_name":"Weather / Park","component_key":"weather_park","endpoint_path":"/functions/v1/refresh-mlb-weather-park","registered_at":"2026-09-23T12:12:35.939337+00:00","stale_after_minutes":12,"expected_interval_minutes":5}]'::jsonb)\non conflict do nothing;\n