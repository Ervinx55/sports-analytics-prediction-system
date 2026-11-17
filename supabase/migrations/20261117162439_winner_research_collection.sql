-- Independent observational winner research; never feeds production decisions.
create table public.winner_model_manifests (
 model_hash text primary key check(model_hash ~ '^[a-f0-9]{64}$'),
 sport text not null check(sport in ('NBA','NFL')), model_version text not null,
 manifest jsonb not null check(jsonb_typeof(manifest)='object'),
 recorded_at timestamptz not null default clock_timestamp()
);
create table public.winner_source_snapshots (
 source_hash text primary key check(source_hash ~ '^[a-f0-9]{64}$'),
 source_url text not null, fetched_at timestamptz not null,
 body jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
 check(fetched_at<=recorded_at)
);
-- Content is stored once; each real retrieval keeps its own immutable receipt.
create table public.winner_source_receipts (
 source_hash text not null references public.winner_source_snapshots(source_hash),
 fetched_at timestamptz not null, recorded_at timestamptz not null default clock_timestamp(),
 primary key(source_hash,fetched_at), check(fetched_at<=recorded_at)
);
create table public.winner_prospective_forecasts (
 sport text not null check(sport in ('NBA','NFL')), event_id text not null,
 model_hash text not null references public.winner_model_manifests(model_hash),
 model_version text not null, starts_at timestamptz not null,
 capture_window text not null check(capture_window in ('EARLY','PRE90_30','PRE30_5')),
 captured_at timestamptz not null default clock_timestamp(),
 issued_at timestamptz not null, input_hash text not null references public.winner_source_snapshots(source_hash),
 forecast jsonb not null,
 primary key(sport,event_id,model_hash,capture_window),
 check(issued_at<=captured_at and captured_at<starts_at),
 check((forecast->>'homeProbability')::numeric > 0 and (forecast->>'homeProbability')::numeric < 1),
 check(forecast->>'productionEligible'='false' and forecast->>'productionWeight'='0')
);
create index winner_forecasts_starts on public.winner_prospective_forecasts(starts_at,sport,event_id);
create table public.winner_outcome_revisions (
 sport text not null check(sport in ('NBA','NFL')), event_id text not null,
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 observed_at timestamptz not null, outcome jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(sport,event_id,evidence_hash), check(observed_at<=recorded_at)
);
create index winner_outcomes_latest on public.winner_outcome_revisions(sport,event_id,observed_at desc,recorded_at desc);
create table public.winner_research_state (
 id text primary key check(id='latest'), payload jsonb not null,
 recorded_at timestamptz not null default clock_timestamp()
);
create table public.winner_outcome_checks (
 sport text not null check(sport in ('NBA','NFL')), event_id text not null,
 checked_at timestamptz not null default clock_timestamp(), primary key(sport,event_id)
);
alter table public.winner_model_manifests enable row level security;
alter table public.winner_source_snapshots enable row level security;
alter table public.winner_source_receipts enable row level security;
alter table public.winner_prospective_forecasts enable row level security;
alter table public.winner_outcome_revisions enable row level security;
alter table public.winner_research_state enable row level security;
alter table public.winner_outcome_checks enable row level security;
revoke all on public.winner_model_manifests,public.winner_source_snapshots,public.winner_prospective_forecasts,public.winner_outcome_revisions,public.winner_research_state from public,anon,authenticated;
grant select,insert on public.winner_model_manifests,public.winner_source_snapshots,public.winner_prospective_forecasts,public.winner_outcome_revisions to service_role;
grant select,insert,update on public.winner_research_state to service_role;
revoke all on public.winner_outcome_checks from public,anon,authenticated;
grant select,insert,update on public.winner_outcome_checks to service_role;
revoke all on public.winner_source_receipts from public,anon,authenticated;
grant select,insert on public.winner_source_receipts to service_role;

create function public.winner_reject_mutation() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Winner research evidence is append-only'; end;
$$;
revoke all on function public.winner_reject_mutation() from public,anon,authenticated;
create trigger winner_manifest_immutable before update or delete on public.winner_model_manifests for each row execute function public.winner_reject_mutation();
create trigger winner_source_immutable before update or delete on public.winner_source_snapshots for each row execute function public.winner_reject_mutation();
create trigger winner_receipt_immutable before update or delete on public.winner_source_receipts for each row execute function public.winner_reject_mutation();
create trigger winner_forecast_immutable before update or delete on public.winner_prospective_forecasts for each row execute function public.winner_reject_mutation();
create trigger winner_outcome_immutable before update or delete on public.winner_outcome_revisions for each row execute function public.winner_reject_mutation();

-- Server clock and chronology also apply to direct service-role inserts.
create function public.winner_before_insert() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare m public.winner_model_manifests; s public.winner_source_snapshots; f public.winner_prospective_forecasts; h numeric; a numeric;
begin
 if tg_table_name='winner_prospective_forecasts' then
  new.captured_at:=clock_timestamp();
  if new.starts_at-new.captured_at <= interval '5 minutes' or new.starts_at-new.captured_at > interval '7 days' then raise exception 'Outside winner capture window'; end if;
  new.capture_window:=case when new.starts_at-new.captured_at>interval '90 minutes' then 'EARLY' when new.starts_at-new.captured_at>interval '30 minutes' then 'PRE90_30' else 'PRE30_5' end;
  select * into strict m from public.winner_model_manifests where model_hash=new.model_hash;
  select * into strict s from public.winner_source_snapshots where source_hash=new.input_hash;
  if m.sport<>new.sport or m.model_version<>new.model_version or s.fetched_at>new.issued_at or s.recorded_at>new.captured_at
   or new.forecast->>'productionEligible' is distinct from 'false' or new.forecast->>'productionWeight' is distinct from '0'
   or new.forecast->>'fullFeatureEligible' is distinct from 'false'
   or jsonb_typeof(new.forecast->'identity') is distinct from 'object'
   or new.forecast->>'sport' is distinct from new.sport
   or new.forecast->>'eventID' is distinct from new.event_id
   or new.forecast#>>'{identity,eventID}' is distinct from new.event_id
   or new.forecast#>>'{identity,home,id}' is null or new.forecast#>>'{identity,away,id}' is null
   or new.forecast#>>'{identity,home,id}'=new.forecast#>>'{identity,away,id}'
   or new.forecast->>'homeProbability' is null or new.forecast->>'homeProbability' in ('NaN','Infinity','-Infinity')
   or new.forecast->>'manifestHash' is distinct from new.model_hash
   or (new.forecast->>'issuedAt')::timestamptz is distinct from new.issued_at
   or (new.forecast->>'startsAt')::timestamptz is distinct from new.starts_at then raise exception 'Invalid winner forecast provenance'; end if;
  if exists(select 1 from public.winner_prospective_forecasts prior_forecast where prior_forecast.sport=new.sport and prior_forecast.event_id=new.event_id and (prior_forecast.starts_at<>new.starts_at or prior_forecast.forecast->'identity' is distinct from new.forecast->'identity')) then raise exception 'Winner event identity changed'; end if;
 elsif tg_table_name='winner_outcome_revisions' then
  new.recorded_at:=clock_timestamp();
  select * into strict f from public.winner_prospective_forecasts where sport=new.sport and event_id=new.event_id order by captured_at limit 1;
  select * into strict s from public.winner_source_snapshots where source_hash=new.outcome->>'sourceHash';
  h:=(new.outcome->>'homeScore')::numeric; a:=(new.outcome->>'awayScore')::numeric;
  if new.observed_at<f.starts_at
   or (new.outcome->>'sourceFetchedAt')::timestamptz is distinct from new.observed_at
   or not exists(select 1 from public.winner_source_receipts r where r.source_hash=s.source_hash and r.fetched_at=new.observed_at)
   or new.outcome->>'sourceUrl' is distinct from s.source_url
   or new.outcome->'identity' is distinct from f.forecast->'identity'
   or new.outcome->>'final' is distinct from 'true' or new.outcome->>'productionEligible' is distinct from 'false'
   or new.outcome->>'source' is distinct from (case when new.sport='NBA' then 'ESPN_SCOREBOARD' else 'NFLVERSE_SCHEDULE' end)
   or h is null or a is null or h<0 or a<0 or h>250 or a>250 or h<>trunc(h) or a<>trunc(a)
   or h::text in ('NaN','Infinity','-Infinity') or a::text in ('NaN','Infinity','-Infinity')
   or new.outcome->>'status' is distinct from (case when h=a and new.sport='NFL' then 'TIE' else 'FINAL' end)
   or (h=a and new.sport='NBA')
   or new.outcome->>'result' is distinct from (case when h=a then 'TIE' when h>a then 'HOME_WIN' else 'AWAY_WIN' end)
   then raise exception 'Invalid winner final outcome provenance'; end if;
 elsif tg_table_name='winner_model_manifests' then
  new.recorded_at:=clock_timestamp();
  if new.manifest->>'sport' is distinct from new.sport or new.manifest->>'modelVersion' is distinct from new.model_version
   or new.manifest->>'manifestHash' is distinct from new.model_hash or new.manifest->>'productionWeight' is distinct from '0'
   or new.manifest->>'productionEligible' is distinct from 'false' then raise exception 'Invalid frozen research manifest'; end if;
 else
  new.recorded_at:=clock_timestamp();
 end if;
 return new;
end;
$$;
revoke all on function public.winner_before_insert() from public,anon,authenticated;
create trigger winner_manifest_clock before insert on public.winner_model_manifests for each row execute function public.winner_before_insert();
create trigger winner_source_clock before insert on public.winner_source_snapshots for each row execute function public.winner_before_insert();
create trigger winner_receipt_clock before insert on public.winner_source_receipts for each row execute function public.winner_before_insert();
create trigger winner_forecast_clock before insert on public.winner_prospective_forecasts for each row execute function public.winner_before_insert();
create trigger winner_outcome_clock before insert on public.winner_outcome_revisions for each row execute function public.winner_before_insert();

create function public.winner_research_append(p_manifests jsonb default '[]',p_sources jsonb default '[]',p_forecasts jsonb default '[]',p_outcomes jsonb default '[]',p_status jsonb default '{}') returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare r jsonb; n integer; captured integer:=0; sources integer:=0; outcomes integer:=0; f public.winner_prospective_forecasts;
begin
 if jsonb_typeof(p_manifests) is distinct from 'array' or jsonb_typeof(p_sources) is distinct from 'array' or jsonb_typeof(p_forecasts) is distinct from 'array' or jsonb_typeof(p_outcomes) is distinct from 'array'
  or jsonb_array_length(p_manifests)>4 or jsonb_array_length(p_sources)>300 or jsonb_array_length(p_forecasts)>100 or jsonb_array_length(p_outcomes)>100 then raise exception 'Winner batch limit'; end if;
 for r in select value from jsonb_array_elements(p_manifests) loop
  insert into public.winner_model_manifests(model_hash,sport,model_version,manifest) values(r->>'model_hash',r->>'sport',r->>'model_version',r->'manifest') on conflict do nothing;
  if not exists(select 1 from public.winner_model_manifests where model_hash=r->>'model_hash' and sport=r->>'sport' and model_version=r->>'model_version' and manifest=r->'manifest') then raise exception 'Frozen winner manifest mismatch'; end if;
 end loop;
 for r in select value from jsonb_array_elements(p_sources) loop
  insert into public.winner_source_snapshots(source_hash,source_url,fetched_at,body) values(r->>'source_hash',r->>'source_url',(r->>'fetched_at')::timestamptz,r->'body') on conflict do nothing;
  get diagnostics n=row_count; sources:=sources+n;
  if not exists(select 1 from public.winner_source_snapshots where source_hash=r->>'source_hash' and body=r->'body' and source_url=r->>'source_url') then raise exception 'Winner source hash collision'; end if;
  insert into public.winner_source_receipts(source_hash,fetched_at) values(r->>'source_hash',(r->>'fetched_at')::timestamptz) on conflict do nothing;
 end loop;
 for r in select value from jsonb_array_elements(p_forecasts) loop
  -- Do not backdate a forecast if a batch crosses kickoff or its final window.
  if (r->>'starts_at')::timestamptz-clock_timestamp() <= interval '5 minutes' or (r->>'starts_at')::timestamptz-clock_timestamp()>interval '7 days' then continue; end if;
  insert into public.winner_prospective_forecasts(sport,event_id,model_hash,model_version,starts_at,capture_window,issued_at,input_hash,forecast)
  values(r->>'sport',r->>'event_id',coalesce(r->>'model_hash',r#>>'{forecast,manifestHash}'),r->>'model_version',(r->>'starts_at')::timestamptz,'EARLY',(r#>>'{forecast,issuedAt}')::timestamptz,r->>'input_hash',r->'forecast') on conflict do nothing;
  get diagnostics n=row_count; captured:=captured+n;
 end loop;
 for r in select value from jsonb_array_elements(p_outcomes) loop
  select * into f from public.winner_prospective_forecasts where sport=r->>'sport' and event_id=r->>'event_id' order by captured_at limit 1;
  if not found or (r->>'observed_at')::timestamptz<f.starts_at or r#>'{outcome,identity}' is distinct from f.forecast->'identity' then raise exception 'Winner outcome identity mismatch'; end if;
  insert into public.winner_outcome_revisions(sport,event_id,evidence_hash,observed_at,outcome) values(r->>'sport',r->>'event_id',r->>'evidence_hash',(r->>'observed_at')::timestamptz,r->'outcome') on conflict do nothing;
  get diagnostics n=row_count; outcomes:=outcomes+n;
 end loop;
 if p_status<>'{}'::jsonb then
  for r in select value from jsonb_array_elements(coalesce(p_status->'checkedEvents','[]'::jsonb)) limit 100 loop
   if exists(select 1 from public.winner_prospective_forecasts where sport=r->>'sport' and event_id=r->>'event_id') then
    insert into public.winner_outcome_checks(sport,event_id) values(r->>'sport',r->>'event_id') on conflict(sport,event_id) do update set checked_at=clock_timestamp();
   end if;
  end loop;
  insert into public.winner_research_state(id,payload) values('latest',p_status) on conflict(id) do update set payload=excluded.payload,recorded_at=clock_timestamp();
 end if;
 return jsonb_build_object('captured',captured,'sourceCount',sources,'outcomeRevisions',outcomes);
end;
$$;
revoke all on function public.winner_research_append(jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.winner_research_append(jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

create function public.winner_research_pending() returns jsonb language sql stable set search_path=pg_catalog,public as $$
 with events as (
  select distinct on(f.sport,f.event_id) f.sport,f.event_id,f.model_hash,f.model_version,f.starts_at,f.input_hash,f.forecast
  from public.winner_prospective_forecasts f
  where f.starts_at<clock_timestamp() and f.starts_at>clock_timestamp()-interval '14 days'
  order by f.sport,f.event_id,f.captured_at
 ) select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (
  select e.* from events e left join public.winner_outcome_checks c using(sport,event_id)
  order by c.checked_at nulls first,e.starts_at,e.sport,e.event_id limit 100
 ) t;
$$;
revoke all on function public.winner_research_pending() from public,anon,authenticated;
grant execute on function public.winner_research_pending() to service_role;

create function public.winner_research_status() returns jsonb language sql stable set search_path=pg_catalog,public as $$
 with latest as (select distinct on(sport,event_id) sport,event_id,outcome from public.winner_outcome_revisions order by sport,event_id,observed_at desc,recorded_at desc,evidence_hash),
 report as (
 select f.sport,f.capture_window,count(*) as forecast_rows,count(distinct f.event_id) as games,
 count(*) filter(where f.forecast->>'lineupVerified'='true') as lineup_verified,
 count(*) filter(where f.forecast->>'quoteComparisonEligible'='true') as paired_prices,
 count(*) filter(where o.outcome->>'status'='FINAL') as final_results,
 count(*) filter(where o.outcome->>'status'='TIE') as ties,
 count(*) filter(where o.event_id is null) as awaiting_outcome
 from public.winner_prospective_forecasts f left join latest o using(sport,event_id) group by f.sport,f.capture_window
 ) select jsonb_build_object('status','RESEARCH_NOT_CLEARED','productionWeight',0,'productionEligible',false,'cohorts',coalesce((select jsonb_agg(to_jsonb(report)) from report),'[]'),'latest',(select payload from public.winner_research_state where id='latest'));
$$;
revoke all on function public.winner_research_status() from public,anon,authenticated;
grant execute on function public.winner_research_status() to service_role;
