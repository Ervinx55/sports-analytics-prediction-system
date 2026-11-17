-- Versioned official schedule identities; original captures and quality flags are never changed.
create table public.winner_official_schedule_revisions (
 revision_hash text primary key check(revision_hash ~ '^[a-f0-9]{64}$'),
 sport text not null check(sport='NFL'), base_event_id text not null, event_id text not null unique,
 reason text not null default 'SCHEDULE_SOURCE_CONFLICT' check(reason='SCHEDULE_SOURCE_CONFLICT'),
 announcement_source_hash text not null, announcement_fetched_at timestamptz not null,
 schedule_source_hash text not null, schedule_fetched_at timestamptz not null,
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(sport,base_event_id,reason) references public.winner_event_quality_flags(sport,event_id,reason),
 foreign key(announcement_source_hash,announcement_fetched_at) references public.winner_source_receipts(source_hash,fetched_at),
 foreign key(schedule_source_hash,schedule_fetched_at) references public.winner_source_receipts(source_hash,fetched_at),
 unique(sport,base_event_id), check(event_id=base_event_id||':schedule:'||revision_hash)
);
create table public.winner_event_quality_resolutions (
 revision_hash text primary key references public.winner_official_schedule_revisions(revision_hash),
 scope text not null default 'FUTURE_VERSION_ONLY' check(scope='FUTURE_VERSION_ONLY'),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table public.winner_official_schedule_revisions enable row level security;
alter table public.winner_event_quality_resolutions enable row level security;
revoke all on public.winner_official_schedule_revisions,public.winner_event_quality_resolutions from public,anon,authenticated,service_role;
grant select,insert on public.winner_official_schedule_revisions,public.winner_event_quality_resolutions to service_role;
create trigger winner_schedule_revision_immutable before update or delete on public.winner_official_schedule_revisions for each row execute function public.winner_reject_mutation();
create trigger winner_schedule_resolution_immutable before update or delete on public.winner_event_quality_resolutions for each row execute function public.winner_reject_mutation();
create trigger winner_schedule_resolution_clock before insert on public.winner_event_quality_resolutions for each row execute function public.winner_before_insert();

create function public.winner_validate_schedule_revision() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare r jsonb:=new.evidence; q public.winner_event_quality_flags; a public.winner_source_snapshots; s public.winner_source_snapshots;
 fields text[]:=array['contract','sport','baseEventID','providerGameID','sourceEventId','officialGameID','season','week','gameDate','home','away','oldStartsAt','startsAt','announcementSourceHash','announcementFetchedAt','scheduleSourceHash','scheduleFetchedAt','sourceUpdatedAt'];
 fingerprint text; actual_hash text; fact text; local_time timestamp; official_time text;
begin
 new.recorded_at:=clock_timestamp();
 select * into strict q from public.winner_event_quality_flags where sport=new.sport and event_id=new.base_event_id and reason=new.reason;
 select * into strict a from public.winner_source_snapshots where source_hash=new.announcement_source_hash;
 select * into strict s from public.winner_source_snapshots where source_hash=new.schedule_source_hash;
 select string_agg(r->>key,E'\n' order by ordinality) into fingerprint from unnest(fields) with ordinality t(key,ordinality);
 actual_hash:=encode(sha256(convert_to(fingerprint,'UTF8')),'hex');
 if exists(select 1 from unnest(fields) key where r->>key is null or r->>key like '%'||E'\n'||'%')
  or actual_hash is distinct from new.revision_hash or r->>'revisionHash' is distinct from new.revision_hash
  or r->>'contract' is distinct from 'winner-official-schedule-v1' or r->>'sport' is distinct from new.sport
  or r->>'eventID' is distinct from new.event_id or r->>'baseEventID' is distinct from new.base_event_id
  or new.base_event_id is distinct from 'nflverse:'||(r->>'providerGameID')
  or r->>'providerGameID' is distinct from (r->>'season')||'_'||lpad(r->>'week',2,'0')||'_'||(r->>'away')||'_'||(r->>'home')
  or r->>'home' is distinct from q.home or r->>'away' is distinct from q.away or r->>'sourceEventId' is distinct from q.source_event_id
  or (r->>'oldStartsAt')::timestamptz is distinct from q.schedule_starts_at or (r->>'startsAt')::timestamptz is distinct from q.provider_starts_at
  or r->>'announcementSourceHash' is distinct from new.announcement_source_hash or r->>'scheduleSourceHash' is distinct from new.schedule_source_hash
  or (r->>'announcementFetchedAt')::timestamptz is distinct from new.announcement_fetched_at
  or (r->>'scheduleFetchedAt')::timestamptz is distinct from new.schedule_fetched_at
  or greatest(new.announcement_fetched_at,new.schedule_fetched_at)>new.recorded_at
  or greatest(new.announcement_fetched_at,new.schedule_fetched_at)>=least(q.schedule_starts_at,q.provider_starts_at)
  or (r->>'sourceUpdatedAt')::timestamptz>least(new.announcement_fetched_at,new.schedule_fetched_at)
  or a.source_url is distinct from r->>'announcementUrl' or s.source_url is distinct from r->>'scheduleUrl'
  or a.source_url<>'https://media.nfl.com/news-and-releases/week-11-schedule-change--jaguars-giants-to-4-25-p-m--et--steeler'
  or s.source_url<>'https://www.nfl.com/schedules/2026/by-week/week-11'
  or r->>'season'<>'2026' or r->>'week'<>'11' or r->>'gameDate'<>'2026-11-22'
  or r->>'publishedDate' is distinct from '2026-11-09'
  or r->>'homeName' is null or r->>'awayName' is null or (r->>'officialGameID') !~ '^[a-f0-9-]{36}$'
  or r->>'homeName' is distinct from (case q.home when 'NYG' then 'New York Giants' when 'PHI' then 'Philadelphia Eagles' end)
  or r->>'awayName' is distinct from (case q.away when 'JAX' then 'Jacksonville Jaguars' when 'PIT' then 'Pittsburgh Steelers' end)
  or a.body->>'rawText' is null or a.body->>'rawSha256' is distinct from encode(sha256(convert_to(a.body->>'rawText','UTF8')),'hex')
  or a.body->>'rawText' not like '%Nov. 9, 2026%' or a.body->>'rawText' not like '%Sunday, Nov. 22%'
  then raise exception 'Invalid official schedule revision provenance'; end if;
 local_time:=(r->>'startsAt')::timestamptz at time zone 'America/New_York';
 official_time:=to_char(local_time,'FMHH12')||case when extract(minute from local_time)=0 then '' else ':'||to_char(local_time,'MI') end||case when extract(hour from local_time)>=12 then ' p.m. ET' else ' a.m. ET' end;
 fact:=(r->>'awayName')||' at '||(r->>'homeName')||' game will move to '||official_time;
 if r->>'officialTimeText' is distinct from official_time or position(fact in a.body->>'rawText')=0
  or position(replace(r->>'sourceUpdatedAt','.000Z','Z') in a.body->>'rawText')=0 then raise exception 'Official schedule fact mismatch'; end if;
 return new;
end;
$$;
revoke all on function public.winner_validate_schedule_revision() from public,anon,authenticated;
create trigger winner_schedule_revision_guard before insert on public.winner_official_schedule_revisions for each row execute function public.winner_validate_schedule_revision();

create function public.winner_register_schedule_revisions(p_sources jsonb,p_revisions jsonb) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare r jsonb; inserted integer:=0; n integer;
begin
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_typeof(p_revisions) is distinct from 'array'
  or jsonb_array_length(p_sources)>4 or jsonb_array_length(p_revisions)>2 then raise exception 'Schedule registration batch invalid'; end if;
 perform public.winner_research_append(p_sources=>p_sources);
 for r in select value from jsonb_array_elements(p_revisions) loop
  insert into public.winner_official_schedule_revisions(revision_hash,sport,base_event_id,event_id,announcement_source_hash,announcement_fetched_at,schedule_source_hash,schedule_fetched_at,evidence)
  values(r->>'revisionHash',r->>'sport',r->>'baseEventID',r->>'eventID',r->>'announcementSourceHash',(r->>'announcementFetchedAt')::timestamptz,r->>'scheduleSourceHash',(r->>'scheduleFetchedAt')::timestamptz,r)
  on conflict do nothing;
  get diagnostics n=row_count;inserted:=inserted+n;
  if not exists(select 1 from public.winner_official_schedule_revisions where revision_hash=r->>'revisionHash' and evidence=r) then raise exception 'Schedule revision collision'; end if;
  insert into public.winner_event_quality_resolutions(revision_hash) values(r->>'revisionHash') on conflict do nothing;
 end loop;
 return jsonb_build_object('registered',inserted,'originalCapturesChanged',0,'originalFlagsChanged',0);
end;
$$;
revoke all on function public.winner_register_schedule_revisions(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.winner_register_schedule_revisions(jsonb,jsonb) to service_role;

-- The version suffix is evidence-bound. It is never sufficient to evade a base-event flag.
create function public.winner_guard_schedule_capture() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare revision public.winner_official_schedule_revisions; r jsonb; agreement jsonb; source public.winner_source_snapshots; received timestamptz;
begin
 if new.event_id not like '%:schedule:%' and new.forecast#>>'{identity,scheduleRevisionHash}' is null then return new; end if;
 select * into strict revision from public.winner_official_schedule_revisions where event_id=new.event_id;
 r:=revision.evidence;agreement:=new.forecast#>'{eventEvidence,scheduleAgreement}';received:=(agreement->>'fetchedAt')::timestamptz;
 select * into strict source from public.winner_source_snapshots where source_hash=agreement->>'sourceHash';
 if not exists(select 1 from public.winner_event_quality_resolutions where revision_hash=revision.revision_hash)
  or new.sport is distinct from revision.sport or new.starts_at is distinct from (r->>'startsAt')::timestamptz
  or new.forecast#>>'{identity,scheduleRevisionHash}' is distinct from revision.revision_hash
  or new.forecast#>>'{identity,providerEventID}' is distinct from revision.base_event_id
  or new.forecast#>>'{identity,officialGameID}' is distinct from r->>'officialGameID'
  or new.forecast#>>'{identity,sourceIds,nflverse}' is distinct from r->>'providerGameID'
  or new.forecast#>>'{identity,season}' is distinct from r->>'season' or new.forecast#>>'{identity,week}' is distinct from r->>'week'
  or new.forecast#>>'{identity,gameDate}' is distinct from r->>'gameDate'
  or new.forecast#>>'{identity,home,id}' is distinct from r->>'home' or new.forecast#>>'{identity,away,id}' is distinct from r->>'away'
  or new.forecast#>>'{identity,home,abbreviation}' is distinct from r->>'home' or new.forecast#>>'{identity,away,abbreviation}' is distinct from r->>'away'
  or new.forecast#>'{eventEvidence,scheduleRevision}' is distinct from r
  or greatest(revision.announcement_fetched_at,revision.schedule_fetched_at)>new.issued_at
  or new.forecast->>'quoteComparisonEligible' is distinct from 'true'
  or agreement->>'sourceEventId' is distinct from r->>'sourceEventId' or agreement->>'home' is distinct from r->>'home' or agreement->>'away' is distinct from r->>'away'
  or (agreement->>'startsAt')::timestamptz is distinct from new.starts_at or received is null
  or received>new.issued_at or received>=new.starts_at or new.issued_at-received>interval '60 seconds'
  or source.source_url not like 'https://api.sportsgameodds.com/v2/events?%'
  or not exists(select 1 from public.winner_source_receipts where source_hash=source.source_hash and fetched_at=received)
  or not exists(select 1 from jsonb_array_elements(new.forecast#>'{quoteComparison,pairs}') p where p->>'sourceHash'=source.source_hash and p->>'sourceEventId'=r->>'sourceEventId' and (p->>'fetchedAt')::timestamptz=received)
  then raise exception 'Unverified corrected schedule capture'; end if;
 return new;
end;
$$;
revoke all on function public.winner_guard_schedule_capture() from public,anon,authenticated;
create trigger winner_01_schedule_identity before insert on public.winner_prospective_forecasts for each row execute function public.winner_guard_schedule_capture();

create or replace function public.winner_research_status() returns jsonb language sql stable set search_path=pg_catalog,public as $$
 with latest as (select distinct on(sport,event_id) sport,event_id,outcome from public.winner_outcome_revisions order by sport,event_id,observed_at desc,recorded_at desc,evidence_hash),
 flagged as (select distinct sport,event_id from public.winner_event_quality_flags),
 report as (
 select f.sport,f.capture_window,count(*) as forecast_rows,count(distinct coalesce(r.base_event_id,f.event_id)) as games,
 count(distinct coalesce(r.base_event_id,f.event_id)) filter(where q.event_id is null) as eligible_games,
 count(distinct f.event_id) filter(where q.event_id is not null) as quarantined_games,
 count(distinct r.base_event_id) filter(where q.event_id is null) as schedule_resolved_games,
 count(*) filter(where q.event_id is null and f.forecast->>'lineupVerified'='true') as lineup_verified,
 count(*) filter(where q.event_id is null and f.forecast->>'quoteComparisonEligible'='true') as paired_prices,
 count(*) filter(where q.event_id is null and o.outcome->>'status'='FINAL') as final_results,
 count(*) filter(where q.event_id is null and o.outcome->>'status'='TIE') as ties,
 count(*) filter(where q.event_id is null and o.event_id is null) as awaiting_outcome
 from public.winner_prospective_forecasts f left join latest o using(sport,event_id) left join flagged q using(sport,event_id)
 left join public.winner_official_schedule_revisions r on r.event_id=f.event_id and r.sport=f.sport
 group by f.sport,f.capture_window
 ) select jsonb_build_object('status','RESEARCH_NOT_CLEARED','productionWeight',0,'productionEligible',false,
 'quarantined_games',(select count(*) from flagged q where exists(select 1 from public.winner_prospective_forecasts f where f.sport=q.sport and f.event_id=q.event_id)),
 'quality_flagged_events',(select count(*) from flagged),'schedule_resolutions',(select count(*) from public.winner_event_quality_resolutions),
 'cohorts',coalesce((select jsonb_agg(to_jsonb(report)) from report),'[]'),
 'latest',(select payload from public.winner_research_state where id='latest'));
$$;
revoke all on function public.winner_research_status() from public,anon,authenticated;
grant execute on function public.winner_research_status() to service_role;
