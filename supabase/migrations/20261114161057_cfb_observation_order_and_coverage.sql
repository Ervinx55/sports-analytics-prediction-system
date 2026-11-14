-- Persist the scheduled FBS universe independently of quotes/capture success.
create table public.cfb_capture_scope (
 espn_event_id text not null,model_version text not null,starts_at timestamptz not null,
 first_observed_at timestamptz not null default now(),game jsonb not null,
 primary key(espn_event_id,model_version,starts_at)
);
alter table public.cfb_capture_scope enable row level security;
revoke all on public.cfb_capture_scope from public,anon,authenticated;
grant select,insert on public.cfb_capture_scope to service_role;
create trigger cfb_scope_immutable before update or delete on public.cfb_capture_scope for each row execute function public.cfb_reject_evidence_mutation();

create or replace function public.record_cfb_capture_scope(p_model_version text) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare frozen_at timestamptz;
begin
 select updated_at into frozen_at from public.cfb_research_documents
 where doc_key='frozen-model' and body->>'modelVersion'=p_model_version;
 if frozen_at is null then raise exception 'Frozen model required'; end if;
 insert into public.cfb_research_documents(doc_key,body)
 values('cohort-start:'||p_model_version,jsonb_build_object('startedAt',frozen_at)) on conflict(doc_key) do nothing;
 select (body->>'startedAt')::timestamptz into frozen_at from public.cfb_research_documents where doc_key='cohort-start:'||p_model_version;
 insert into public.cfb_capture_scope(espn_event_id,model_version,starts_at,game)
 select g->>'id',p_model_version,(g->>'startsAt')::timestamptz,g
 from public.cfb_research_documents d cross join lateral jsonb_array_elements(d.body->'games') g
 where d.doc_key='source-current' and (g->>'fbsVerified')::boolean and (g->>'season')::integer=2026
 and (g->>'startsAt')::timestamptz>=frozen_at+interval '30 minutes'
 on conflict do nothing;
end;
$$;
revoke all on function public.record_cfb_capture_scope(text) from public,anon,authenticated;
grant execute on function public.record_cfb_capture_scope(text) to service_role;

create or replace function public.cfb_research_performance(p_model_version text) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 with latest as (
 select distinct on(event_id) event_id,outcome from public.cfb_outcome_revisions
 order by event_id,(outcome->>'fetchedAt')::timestamptz desc nulls last,recorded_at desc,evidence_hash desc
 ), records as (
 select f.event_id,f.starts_at,f.forecast->>'espnEventID' espn_id,(f.forecast->>'homeProbability')::double precision p,
 case when (o.outcome->>'valid')::boolean then case when (o.outcome->>'homeScore')::integer>(o.outcome->>'awayScore')::integer then 1.0 else 0.0 end end y,
 o.outcome from public.cfb_prospective_forecasts f left join latest o using(event_id) where f.model_version=p_model_version
 ), scope as (
 select s.*,exists(select 1 from records r where r.espn_id=s.espn_event_id and r.starts_at=s.starts_at) captured
 from public.cfb_capture_scope s where s.model_version=p_model_version and s.starts_at<=now()+interval '24 hours'
 ), coverage as (
 select jsonb_build_object('scopeOpenedGames',count(*),'closedCaptureWindows',count(*) filter(where starts_at<now()+interval '30 minutes'),
 'missedClosedCaptureWindows',count(*) filter(where not captured and starts_at<now()+interval '30 minutes'),
 'pendingScopeGames',count(*) filter(where not captured and starts_at>=now()+interval '30 minutes'),
 'capturedScopeGames',count(*) filter(where captured),
 'scopeDefinition','FBS games scheduled since freeze; retains cancelled/rescheduled windows and missing forecasts') data from scope
 ) select jsonb_build_object('captured',count(*),'capturedEspnIDs',coalesce(jsonb_agg(espn_id),'[]'::jsonb),'n',count(y),'unresolved',count(*) filter(where outcome is null),
 'excluded',count(*) filter(where outcome is not null and y is null),'brier',avg(power(p-y,2)),
 'logLoss',avg(-y*ln(p)-(1-y)*ln(1-p)),
 'wins',count(*) filter(where (p>=0.5 and y=1) or(p<0.5 and y=0)),
 'losses',count(*) filter(where (p>=0.5 and y=0) or(p<0.5 and y=1)),
 'coverage',(select data from coverage)) from records;
$$;
revoke all on function public.cfb_research_performance(text) from public,anon,authenticated;
grant execute on function public.cfb_research_performance(text) to service_role;

-- Initialize the denominator from the already-frozen model before more windows close.
select public.record_cfb_capture_scope(body->>'modelVersion') from public.cfb_research_documents where doc_key='frozen-model';
