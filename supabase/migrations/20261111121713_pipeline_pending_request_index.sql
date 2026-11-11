-- Limit reconciliation scans to pending requests without changing settlement rules.
set lock_timeout = '3s';
create index pipeline_http_pending_time_v1 on public.pipeline_http_request_log (enqueued_at) include (request_id, component_key) where reconciled_at is null;
