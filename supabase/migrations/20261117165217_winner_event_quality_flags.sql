-- Durable research quarantine. Evidence is retained even when later source coverage is empty.
-- A flag never rewrites captured identities, source documents, outcomes, or model weights.
create table public.winner_event_quality_flags (
 sport text not null check(sport in ('NBA','NFL')),
 event_id text not null check(length(event_id) between 1 and 200),
 reason text not null check(reason='SCHEDULE_SOURCE_CONFLICT'),
 source_event_id text not null check(length(source_event_id) between 1 and 200),
 home text not null check(home ~ '^[A-Z]{2,4}$'), away text not null check(away ~ '^[A-Z]{2,4}$'),
 schedule_starts_at timestamptz not null, provider_starts_at timestamptz not null,
 schedule_source_hash text not null, schedule_source_fetched_at timestamptz not null,
 provider_source_hash text not null, provider_source_fetched_at timestamptz not null,
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(sport,event_id,reason),
 foreign key(schedule_source_hash,schedule_source_fetched_at) references public.winner_source_receipts(source_hash,fetched_at),
 foreign key(provider_source_hash,provider_source_fetched_at) references public.winner_source_receipts(source_hash,fetched_at),
 check((sport='NBA' and event_id ~ '^espn:.+') or (sport='NFL' and event_id ~ '^nflverse:.+')),
 check(home<>away and schedule_source_hash<>provider_source_hash),
 check(isfinite(schedule_starts_at) and isfinite(provider_starts_at) and schedule_starts_at<>provider_starts_at),
 check((schedule_starts_at at time zone 'America/New_York')::date=(provider_starts_at at time zone 'America/New_York')::date),
 check(isfinite(schedule_source_fetched_at) and isfinite(provider_source_fetched_at)
  and schedule_source_fetched_at<=recorded_at and provider_source_fetched_at<=recorded_at),
 check(evidence->>'sport' is not distinct from sport and evidence->>'eventID' is not distinct from event_id
  and evidence->>'reason' is not distinct from reason and evidence->>'sourceEventId' is not distinct from source_event_id
  and evidence->>'home' is not distinct from home and evidence->>'away' is not distinct from away
  and evidence->>'scheduleSourceHash' is not distinct from schedule_source_hash
  and evidence->>'providerSourceHash' is not distinct from provider_source_hash
  and (evidence->>'scheduleStartsAt')::timestamptz is not distinct from schedule_starts_at
  and (evidence->>'providerStartsAt')::timestamptz is not distinct from provider_starts_at
  and (evidence->>'scheduleSourceFetchedAt')::timestamptz is not distinct from schedule_source_fetched_at
  and (evidence->>'providerSourceFetchedAt')::timestamptz is not distinct from provider_source_fetched_at)
);
alter table public.winner_event_quality_flags enable row level security;
revoke all on public.winner_event_quality_flags from public,anon,authenticated,service_role;
grant select,insert on public.winner_event_quality_flags to service_role;
create trigger winner_quality_flag_immutable before update or delete on public.winner_event_quality_flags
 for each row execute function public.winner_reject_mutation();
create trigger winner_quality_flag_clock before insert on public.winner_event_quality_flags
 for each row execute function public.winner_before_insert();

create function public.winner_record_quality_flags() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare conflicts jsonb; r jsonb;
begin
 conflicts:=coalesce(new.payload#>'{coverage,scheduleSourceConflicts}','[]'::jsonb);
 if jsonb_typeof(conflicts) is distinct from 'array' or jsonb_array_length(conflicts)>100 then
  raise exception 'Invalid winner schedule conflict batch';
 end if;
 for r in select value from jsonb_array_elements(conflicts) loop
  insert into public.winner_event_quality_flags(sport,event_id,reason,source_event_id,home,away,
   schedule_starts_at,provider_starts_at,schedule_source_hash,schedule_source_fetched_at,
   provider_source_hash,provider_source_fetched_at,evidence)
  values(r->>'sport',r->>'eventID',r->>'reason',r->>'sourceEventId',r->>'home',r->>'away',
   (r->>'scheduleStartsAt')::timestamptz,(r->>'providerStartsAt')::timestamptz,
   r->>'scheduleSourceHash',(r->>'scheduleSourceFetchedAt')::timestamptz,
   r->>'providerSourceHash',(r->>'providerSourceFetchedAt')::timestamptz,r)
  on conflict(sport,event_id,reason) do nothing;
 end loop;
 return new;
end;
$$;
revoke all on function public.winner_record_quality_flags() from public,anon,authenticated;
create trigger winner_state_quality_flags after insert or update of payload on public.winner_research_state
 for each row execute function public.winner_record_quality_flags();

-- An unavailable comparison source must not permit later capture windows for a known conflict.
create function public.winner_skip_quarantined_forecast() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.winner_event_quality_flags q where q.sport=new.sport and q.event_id=new.event_id) then return null; end if;
 return new;
end;
$$;
revoke all on function public.winner_skip_quarantined_forecast() from public,anon,authenticated;
create trigger winner_00_quality_quarantine before insert on public.winner_prospective_forecasts
 for each row execute function public.winner_skip_quarantined_forecast();

create or replace function public.winner_research_status() returns jsonb language sql stable set search_path=pg_catalog,public as $$
 with latest as (select distinct on(sport,event_id) sport,event_id,outcome from public.winner_outcome_revisions order by sport,event_id,observed_at desc,recorded_at desc,evidence_hash),
 flagged as (select distinct sport,event_id from public.winner_event_quality_flags),
 report as (
 select f.sport,f.capture_window,count(*) as forecast_rows,count(distinct f.event_id) as games,
 count(distinct f.event_id) filter(where q.event_id is null) as eligible_games,
 count(distinct f.event_id) filter(where q.event_id is not null) as quarantined_games,
 count(*) filter(where q.event_id is null and f.forecast->>'lineupVerified'='true') as lineup_verified,
 count(*) filter(where q.event_id is null and f.forecast->>'quoteComparisonEligible'='true') as paired_prices,
 count(*) filter(where q.event_id is null and o.outcome->>'status'='FINAL') as final_results,
 count(*) filter(where q.event_id is null and o.outcome->>'status'='TIE') as ties,
 count(*) filter(where q.event_id is null and o.event_id is null) as awaiting_outcome
 from public.winner_prospective_forecasts f left join latest o using(sport,event_id) left join flagged q using(sport,event_id)
 group by f.sport,f.capture_window
 ) select jsonb_build_object('status','RESEARCH_NOT_CLEARED','productionWeight',0,'productionEligible',false,
 'quarantined_games',(select count(*) from flagged q where exists(select 1 from public.winner_prospective_forecasts f where f.sport=q.sport and f.event_id=q.event_id)),
 'quality_flagged_events',(select count(*) from flagged),
 'cohorts',coalesce((select jsonb_agg(to_jsonb(report)) from report),'[]'),
 'latest',(select payload from public.winner_research_state where id='latest'));
$$;
revoke all on function public.winner_research_status() from public,anon,authenticated;
grant execute on function public.winner_research_status() to service_role;

-- Preserve any exact conflicts already present at deployment; this does not touch captured evidence.
update public.winner_research_state set payload=payload
 where jsonb_typeof(payload#>'{coverage,scheduleSourceConflicts}')='array'
 and jsonb_array_length(payload#>'{coverage,scheduleSourceConflicts}')>0;
