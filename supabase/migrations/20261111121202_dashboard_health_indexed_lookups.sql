-- Use existing job/time index for latest run and 24h counts; preserve health semantics.
create or replace view public.pipeline_component_health_v1 with (security_invoker = true) as
SELECT r.component_key,
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
     LEFT JOIN LATERAL (select status,start_time,end_time from public.pipeline_cron_history where jobid=j.jobid order by start_time desc limit 1) cr ON true
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
     LEFT JOIN LATERAL (select count(*)::integer as runs_24h,count(*) filter(where status is distinct from 'succeeded')::integer as failed_runs_24h from public.pipeline_cron_history where jobid=j.jobid and start_time>=now()-interval '24 hours') stats ON true
  WHERE r.enabled = true;
;
