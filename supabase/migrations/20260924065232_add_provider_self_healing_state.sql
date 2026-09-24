alter table public.provider_circuit_state
  add column if not exists backoff_seconds integer not null default 0
    check (backoff_seconds between 0 and 900),
  add column if not exists last_probe_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists recovery_count integer not null default 0
    check (recovery_count >= 0);

alter table public.provider_request_events
  drop constraint if exists provider_request_events_event_type_check;

alter table public.provider_request_events
  add constraint provider_request_events_event_type_check
  check (
    event_type in (
      'SHARED_HIT',
      'UPSTREAM_SUCCESS',
      'UPSTREAM_FAILURE',
      'STALE_SERVED',
      'CIRCUIT_BLOCKED',
      'PROBE_STARTED',
      'PROBE_SUCCESS',
      'PROBE_FAILURE',
      'RECOVERED'
    )
  );

create or replace function public.record_provider_probe(
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
    backoff_seconds,
    last_probe_at,
    last_success_at,
    recovery_count,
    updated_at
  )
  values (
    p_provider,
    0,
    null,
    null,
    null,
    null,
    0,
    now(),
    null,
    0,
    now()
  )
  on conflict (provider) do update
  set
    last_probe_at = now(),
    updated_at = now();
$$;

create or replace function public.record_provider_success(
  p_provider text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_was_recovering boolean := false;
begin
  select
    consecutive_failures > 0
      or opened_until is not null
      or backoff_seconds > 0
  into v_was_recovering
  from public.provider_circuit_state
  where provider = p_provider;

  insert into public.provider_circuit_state (
    provider,
    consecutive_failures,
    opened_until,
    last_status,
    last_error,
    last_failure_at,
    backoff_seconds,
    last_probe_at,
    last_success_at,
    recovery_count,
    updated_at
  )
  values (
    p_provider,
    0,
    null,
    null,
    null,
    null,
    0,
    null,
    now(),
    0,
    now()
  )
  on conflict (provider) do update
  set
    consecutive_failures = 0,
    opened_until = null,
    last_status = null,
    last_error = null,
    last_failure_at = null,
    backoff_seconds = 0,
    last_success_at = now(),
    recovery_count = public.provider_circuit_state.recovery_count
      + case when v_was_recovering then 1 else 0 end,
    updated_at = now();
end;
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
begin
  insert into public.provider_circuit_state (
    provider,
    consecutive_failures,
    opened_until,
    last_status,
    last_error,
    last_failure_at,
    backoff_seconds,
    last_probe_at,
    last_success_at,
    recovery_count,
    updated_at
  )
  values (
    p_provider,
    1,
    case
      when p_status = 429 then
        now() + make_interval(
          secs => greatest(
            coalesce(p_retry_after_seconds, 60),
            60
          )
        )
      else null
    end,
    p_status,
    left(coalesce(p_message, ''), 500),
    now(),
    case
      when p_status = 429 then greatest(
        coalesce(p_retry_after_seconds, 60),
        60
      )
      else 0
    end,
    null,
    null,
    0,
    now()
  )
  on conflict (provider) do update
  set
    consecutive_failures =
      public.provider_circuit_state.consecutive_failures + 1,
    backoff_seconds = case
      when p_status = 429 then
        greatest(
          coalesce(p_retry_after_seconds, 60),
          least(
            900,
            60 * (2 ^ least(
              public.provider_circuit_state.consecutive_failures,
              4
            ))
          )
        )
      when p_status between 500 and 599
        and public.provider_circuit_state.consecutive_failures + 1 >= 3
        then least(
          300,
          30 * (2 ^ least(
            greatest(
              public.provider_circuit_state.consecutive_failures - 2,
              0
            ),
            4
          ))
        )
      else 0
    end,
    opened_until = case
      when p_status = 429 then
        now() + make_interval(
          secs => greatest(
            coalesce(p_retry_after_seconds, 60),
            least(
              900,
              60 * (2 ^ least(
                public.provider_circuit_state.consecutive_failures,
                4
              ))
            )
          )
        )
      when p_status between 500 and 599
        and public.provider_circuit_state.consecutive_failures + 1 >= 3
        then now() + make_interval(
          secs => least(
            300,
            30 * (2 ^ least(
              greatest(
                public.provider_circuit_state.consecutive_failures - 2,
                0
              ),
              4
            ))
          )
        )
      else null
    end,
    last_status = p_status,
    last_error = left(coalesce(p_message, ''), 500),
    last_failure_at = now(),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.record_provider_probe(text)
  from public, anon, authenticated;
revoke all on function public.record_provider_success(text)
  from public, anon, authenticated;
revoke all on function public.record_provider_failure(text, integer, text, integer)
  from public, anon, authenticated;

grant execute on function public.record_provider_probe(text) to service_role;
grant execute on function public.record_provider_success(text) to service_role;
grant execute on function public.record_provider_failure(text, integer, text, integer)
  to service_role;
