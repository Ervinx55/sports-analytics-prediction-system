create table if not exists public.provider_request_budget_state (
  provider text primary key,
  tokens numeric not null default 0,
  capacity integer not null default 9 check (capacity between 1 and 1000),
  refilled_at timestamptz not null default now(),
  last_claim_at timestamptz,
  last_denied_at timestamptz,
  claimed_count bigint not null default 0 check (claimed_count >= 0),
  denied_count bigint not null default 0 check (denied_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.provider_request_budget_state enable row level security;
revoke all on table public.provider_request_budget_state from anon, authenticated;
grant select, insert, update on table public.provider_request_budget_state to service_role;

create or replace function public.claim_provider_budget(
  p_provider text,
  p_priority text default 'normal',
  p_capacity integer default 9,
  p_critical_reserve integer default 2,
  p_normal_reserve integer default 1
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_priority text := lower(coalesce(p_priority, 'normal'));
  v_capacity integer := greatest(1, least(coalesce(p_capacity, 9), 1000));
  v_critical_reserve integer;
  v_normal_reserve integer;
  v_required numeric;
  v_now timestamptz := clock_timestamp();
  v_row public.provider_request_budget_state;
  v_elapsed_seconds numeric;
  v_tokens numeric;
  v_allowed boolean;
  v_retry_after integer := 0;
  v_refill_per_second numeric;
begin
  if v_priority not in ('critical', 'normal', 'background') then
    v_priority := 'normal';
  end if;

  v_critical_reserve := greatest(
    0,
    least(coalesce(p_critical_reserve, 2), v_capacity - 1)
  );
  v_normal_reserve := greatest(
    0,
    least(
      coalesce(p_normal_reserve, 1),
      greatest(v_capacity - v_critical_reserve - 1, 0)
    )
  );

  insert into public.provider_request_budget_state (
    provider,
    tokens,
    capacity,
    refilled_at,
    updated_at
  )
  values (
    p_provider,
    v_capacity,
    v_capacity,
    v_now,
    v_now
  )
  on conflict (provider) do nothing;

  select *
  into v_row
  from public.provider_request_budget_state
  where provider = p_provider
  for update;

  v_elapsed_seconds := greatest(
    0,
    extract(epoch from (v_now - v_row.refilled_at))
  );

  v_refill_per_second := v_capacity::numeric / 60.0;
  v_tokens := least(
    v_capacity::numeric,
    least(v_row.tokens, v_capacity::numeric)
      + (v_elapsed_seconds * v_refill_per_second)
  );

  v_required := case v_priority
    when 'critical' then 1
    when 'normal' then v_critical_reserve + 1
    else v_critical_reserve + v_normal_reserve + 1
  end;

  v_allowed := v_tokens >= v_required;

  if v_allowed then
    v_tokens := v_tokens - 1;

    update public.provider_request_budget_state
    set
      tokens = v_tokens,
      capacity = v_capacity,
      refilled_at = v_now,
      last_claim_at = v_now,
      claimed_count = claimed_count + 1,
      updated_at = v_now
    where provider = p_provider;
  else
    if v_refill_per_second > 0 then
      v_retry_after := greatest(
        1,
        ceil((v_required - v_tokens) / v_refill_per_second)::integer
      );
    else
      v_retry_after := 60;
    end if;

    update public.provider_request_budget_state
    set
      tokens = v_tokens,
      capacity = v_capacity,
      refilled_at = v_now,
      last_denied_at = v_now,
      denied_count = denied_count + 1,
      updated_at = v_now
    where provider = p_provider;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'priority', v_priority,
    'capacity', v_capacity,
    'tokensRemaining', round(v_tokens, 3),
    'criticalReserve', v_critical_reserve,
    'normalReserve', v_normal_reserve,
    'retryAfterSeconds', v_retry_after
  );
end;
$$;

revoke all on function public.claim_provider_budget(text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_provider_budget(text, text, integer, integer, integer)
  to service_role;

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
      'RECOVERED',
      'BUDGET_BLOCKED'
    )
  );
