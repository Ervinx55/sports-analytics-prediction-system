-- Cohort eligibility is determined at the database, never at HTTP request start.
create or replace function public.capture_cfb_forecasts(p_rows jsonb) returns setof public.cfb_prospective_forecasts
language sql set search_path=pg_catalog,public as $$
 with candidates as materialized (
 select item,clock_timestamp() as captured_at from jsonb_array_elements(p_rows) item limit 200
 ) insert into public.cfb_prospective_forecasts(event_id,model_version,captured_at,starts_at,forecast,input_hash)
 select item->>'event_id',item->>'model_version',captured_at,(item->>'starts_at')::timestamptz,item->'forecast',item->>'input_hash'
 from candidates where (item->>'starts_at')::timestamptz-captured_at between interval '30 minutes' and interval '24 hours'
 on conflict(event_id,model_version) do nothing returning *;
$$;
revoke all on function public.capture_cfb_forecasts(jsonb) from public,anon,authenticated;
grant execute on function public.capture_cfb_forecasts(jsonb) to service_role;

create or replace function public.cfb_research_performance(p_model_version text) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 with latest as (
 select distinct on(event_id) event_id,outcome from public.cfb_outcome_revisions order by event_id,recorded_at desc,evidence_hash desc
 ), records as (
 select f.event_id,f.forecast->>'espnEventID' espn_id,(f.forecast->>'homeProbability')::double precision p,
 case when (o.outcome->>'valid')::boolean then case when (o.outcome->>'homeScore')::integer>(o.outcome->>'awayScore')::integer then 1.0 else 0.0 end end y,
 o.outcome from public.cfb_prospective_forecasts f left join latest o using(event_id) where f.model_version=p_model_version
 ) select jsonb_build_object('captured',count(*),'capturedEspnIDs',coalesce(jsonb_agg(espn_id),'[]'::jsonb),'n',count(y),'unresolved',count(*) filter(where outcome is null),
 'excluded',count(*) filter(where outcome is not null and y is null),'brier',avg(power(p-y,2)),
 'logLoss',avg(-y*ln(p)-(1-y)*ln(1-p)),
 'wins',count(*) filter(where (p>=0.5 and y=1) or(p<0.5 and y=0)),
 'losses',count(*) filter(where (p>=0.5 and y=0) or(p<0.5 and y=1))) from records;
$$;
revoke all on function public.cfb_research_performance(text) from public,anon,authenticated;
grant execute on function public.cfb_research_performance(text) to service_role;
