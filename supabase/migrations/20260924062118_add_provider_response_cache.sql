create table if not exists public.provider_response_cache (
  cache_key text primary key,
  provider text not null,
  payload jsonb not null,
  status_code integer not null default 200 check (status_code between 100 and 599),
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stale_until timestamptz not null,
  last_error jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists provider_response_cache_stale_until_idx
  on public.provider_response_cache (stale_until);

alter table public.provider_response_cache enable row level security;
revoke all on table public.provider_response_cache from anon, authenticated;
grant select, insert, update, delete on table public.provider_response_cache to service_role;

create table if not exists public.provider_refresh_locks (
  cache_key text primary key,
  provider text not null,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists provider_refresh_locks_locked_until_idx
  on public.provider_refresh_locks (locked_until);

alter table public.provider_refresh_locks enable row level security;
revoke all on table public.provider_refresh_locks from anon, authenticated;
grant select, insert, update, delete on table public.provider_refresh_locks to service_role;

create table if not exists public.provider_circuit_state (
  provider text primary key,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  opened_until timestamptz,
  last_status integer,
  last_error text,
  last_failure_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.provider_circuit_state enable row level security;
revoke all on table public.provider_circuit_state from anon, authenticated;
grant select, insert, update, delete on table public.provider_circuit_state to service_role;

create or replace function public.claim_provider_refresh(
  p_cache_key text,
  p_provider text,
  p_lease_seconds integer default 10
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows integer := 0;
  v_seconds integer := greatest(1, least(coalesce(p_lease_seconds, 10), 60));
begin
  insert into public.provider_refresh_locks (
    cache_key,
    provider,
    locked_until,
    updated_at
  )
  values (
    p_cache_key,
    p_provider,
    now() + make_interval(secs => v_seconds),
    now()
  )
  on conflict (cache_key) do update
  set
    provider = excluded.provider,
    locked_until = excluded.locked_until,
    updated_at = now()
  where public.provider_refresh_locks.locked_until <= now();

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.release_provider_refresh(
  p_cache_key text
)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.provider_refresh_locks
  where cache_key = p_cache_key;
$$;

create or replace function public.record_provider_success(
  p_provider text
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.provider_circuit_state (
    provider,
    consecutive_failures,
    opened_until,
    last_status,
    last_error,
    last_failure_at,
    updated_at
  )
  values (
    p_provider,
    0,
    null,
    null,
    null,
    null,
    now()
  )
  on conflict (provider) do update
  set
    consecutive_failures = 0,
    opened_until = null,
    last_status = null,
    last_error = null,
    last_failure_at = null,
    updated_at = now();
$$;

create or replace function public.record_provider_failure(
  p_provider text,
  p_status integer,
  p_message text,
  p_retry_after_seconds integer default null
)
returns public.provider_circuit_state
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.provider_circuit_state;
  v_retry_seconds integer := greatest(
    1,
    least(coalesce(p_retry_after_seconds, 60), 300)
  );
begin
  insert into public.provider_circuit_state (
    provider,
    consecutive_failures,
    opened_until,
    last_status,
    last_error,
    last_failure_at,
    updated_at
  )
  values (
    p_provider,
    1,
    case
      when p_status = 429 then now() + make_interval(secs => v_retry_seconds)
      else null
    end,
    p_status,
    left(coalesce(p_message, ''), 500),
    now(),
    now()
  )
  on conflict (provider) do update
  set
    consecutive_failures = public.provider_circuit_state.consecutive_failures + 1,
    opened_until = case
      when p_status = 429 then now() + make_interval(secs => v_retry_seconds)
      when p_status between 500 and 599
        and public.provider_circuit_state.consecutive_failures + 1 >= 3
        then now() + interval '30 seconds'
      else public.provider_circuit_state.opened_until
    end,
    last_status = p_status,
    last_error = left(coalesce(p_message, ''), 500),
    last_failure_at = now(),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.claim_provider_refresh(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_provider_refresh(text) from public, anon, authenticated;
revoke all on function public.record_provider_success(text) from public, anon, authenticated;
revoke all on function public.record_provider_failure(text, integer, text, integer) from public, anon, authenticated;

grant execute on function public.claim_provider_refresh(text, text, integer) to service_role;
grant execute on function public.release_provider_refresh(text) to service_role;
grant execute on function public.record_provider_success(text) to service_role;
grant execute on function public.record_provider_failure(text, integer, text, integer) to service_role;
