-- Read-only presentation evidence. No model, forecast, collector or approval changes.
create or replace function public.read_nba_explanation_snapshot_v1()
returns jsonb language sql stable security invoker
set search_path = public, pg_temp
set statement_timeout = '5s'
as $$
with accepted as materialized (
 select s.payload
 from public.nba_prop_collector_v1 c
 cross join lateral (select value from jsonb_array_elements_text(coalesce(c.state#>'{sgoHistory,ids}','[]'::jsonb)) with ordinality a(value,n) order by n desc limit 300) ids
 join public.nba_prop_summaries_v1 s on s.id=ids.value
 where c.id=1
), history as (
 select jsonb_build_object('summary',s.payload,'archiveSha256',b.payload->'sha256','raw',g.value) item
 from accepted s
 left join public.nba_prop_summaries_v1 b on b.id =
 'bdl-date:' || substring(s.payload#>>'{backupEvidence,sourceUrl}' from 'date=([0-9-]+)') || ':' || (s.payload#>>'{backupEvidence,sourceSha256}') || ':' || (s.payload#>>'{backupEvidence,retrievedAt}')
 left join lateral (select value from jsonb_array_elements(coalesce(b.payload#>'{body,data}','[]'::jsonb)) x(value) where value->'id'=s.payload#>'{backupEvidence,bdlGameID}' limit 1) g on true
), recent as materialized (
 select distinct on(identity,model_hash) identity,model_hash from public.nba_live_decisions_v1 where starts_at>now() and decided_at>now()-interval '24 hours' order by identity,model_hash,decided_at desc limit 1000
), targets as (
 select distinct jsonb_build_object('eventID',f.payload->'eventID','playerID',f.payload->'playerID','startsAt',f.payload->'startsAt','teamId',f.payload#>'{context,teamId}','opponentTeamId',f.payload#>'{context,opponentTeamId}') item
 from recent r join public.nba_prop_forecasts_v1 f using(identity,model_hash)
)
select jsonb_build_object('contract','nba-explanation-snapshot-v1','generatedAt',now(),'history',coalesce((select jsonb_agg(item) from history),'[]'::jsonb),'targets',coalesce((select jsonb_agg(item) from targets),'[]'::jsonb));
$$;
revoke all on function public.read_nba_explanation_snapshot_v1() from public, anon, authenticated;
grant execute on function public.read_nba_explanation_snapshot_v1() to service_role;

