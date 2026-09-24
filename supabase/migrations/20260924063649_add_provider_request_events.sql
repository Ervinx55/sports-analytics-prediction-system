create table if not exists public.provider_request_events (
  id bigint generated always as identity primary key,
  provider text not null,
  consumer text not null,
  event_type text not null check (
    event_type in (
      'SHARED_HIT',
      'UPSTREAM_SUCCESS',
      'UPSTREAM_FAILURE',
      'STALE_SERVED',
      'CIRCUIT_BLOCKED'
    )
  ),
  status_code integer,
  cache_layer text,
  retry_after_seconds integer,
  duration_ms integer,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists provider_request_events_occurred_at_idx
  on public.provider_request_events (occurred_at desc);

create index if not exists provider_request_events_provider_type_idx
  on public.provider_request_events (provider, event_type, occurred_at desc);

alter table public.provider_request_events enable row level security;
revoke all on table public.provider_request_events from anon, authenticated;
grant select, insert, delete on table public.provider_request_events to service_role;
