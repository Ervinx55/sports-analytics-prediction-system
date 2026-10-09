-- Service-only, read-only projection. One statement snapshot; JSON object bypasses REST row-count caps.
create index performance_read_capture on public.performance_predictions(captured_at,id);
create index performance_read_decisions on public.performance_decisions(prediction_id,id);
create function public.read_performance_v1(p_from timestamptz,p_to timestamptz,p_sport text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
with predictions as materialized (
 select p.* from public.performance_predictions p
 where p.captured_at >= p_from and p.captured_at < p_to
 and (p_sport is null or coalesce(p.sport,p.payload->>'sport')=p_sport)
 order by p.captured_at,p.id limit 10001
), projected as (
 select p.id,jsonb_build_object(
 'id',p.id,'sourceKey',p.source_key,'sport',coalesce(p.sport,p.payload->>'sport'),'eventKey',p.event_key,
 'playerKey',p.player_key,'marketType',p.market_type,'side',p.side,'line',p.line,'marketKey',p.market_key,
 'modelVersion',p.model_version,'modelMode',p.model_mode,'modelAvailable',p.model_available,'valid',p.valid,
 'capturedAt',p.captured_at,'startsAt',p.starts_at,'eligibilityStartsAt',p.eligibility_starts_at,'quoteAt',p.quote_at,
 'odds',p.odds,'book',p.book,'modelProbability',p.model_probability,'marketProbability',p.market_probability,
 'pushProbability',p.push_probability,'probabilityBasis',p.probability_basis,'settlementRule',p.settlement_rule,
 'eligibilityReasons',p.eligibility_reasons,'competitionKey',p.payload->>'competitionKey','tour',p.payload->>'tour',
 'marketScope',p.payload->'marketScope') value from predictions p
), decisions as materialized (
 select d.* from public.performance_decisions d join predictions p on p.id=d.prediction_id order by d.id limit 30001
), settlements as (
 select s.* from predictions p cross join lateral (select s.* from public.performance_settlements s where s.prediction_id=p.id order by s.revision desc limit 1) s
)
select case when (select count(*) from predictions)>10000 or (select count(*) from decisions)>30000 then jsonb_build_object('error','PERFORMANCE_READ_LIMIT_EXCEEDED') else jsonb_build_object(
 'predictions',coalesce((select jsonb_agg(value order by id) from projected),'[]'::jsonb),
 'decisions',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'predictionId',d.prediction_id,
 'issuedAt',d.issued_at,'status',d.status,'qualified',d.qualified,'firstIssued',d.first_issued,
 'legacyReconstructed',d.legacy_reconstructed) order by d.id) from decisions d),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(jsonb_build_object('predictionId',s.prediction_id,'revision',s.revision,
 'outcome',s.outcome,'reason',s.reason) order by s.prediction_id,s.revision) from settlements s),'[]'::jsonb),
 'queue',coalesce((select jsonb_agg(jsonb_build_object('predictionId',q.prediction_id,'sport',q.sport,'attempts',q.attempts,
 'nextAttemptAt',q.next_attempt_at,'lastError',q.last_error,'lastAttemptAt',q.last_attempt_at,'lastSuccessAt',q.last_success_at))
 from public.performance_settlement_queue q join predictions p on p.id=q.prediction_id),'[]'::jsonb)
) end;
$$;
revoke all on function public.read_performance_v1(timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.read_performance_v1(timestamptz,timestamptz,text) to service_role;
