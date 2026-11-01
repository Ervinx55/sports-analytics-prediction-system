-- Performance pipeline connection audit (READ ONLY)
-- Run against the project's Supabase Postgres database.
-- Never activate capture/settlement cron jobs until the referenced endpoints
-- are deployed, authenticated, schema-verified and smoke-tested.
-- This script intentionally does not backfill, promote shadow predictions,
-- or write fabricated decisions/settlements.

-- 1. Prediction -> decision -> settlement integrity and eligibility.
select
 (select count(*) from public.performance_predictions) as predictions,
 (select count(*) from public.performance_predictions where valid and model_mode = 'LIVE') as valid_live_predictions,
 (select count(*) from public.performance_predictions where sport is null) as missing_sport,
 (select count(*) from public.performance_predictions where model_mode = 'SHADOW') as shadow_predictions,
 (select count(*) from public.performance_decisions) as decisions,
 (select count(*) from public.performance_settlement_queue) as queued_settlements,
 (select count(*) from public.performance_settlements) as settlements,
 (select count(*) from public.performance_events) as canonical_events,
 (select count(*) from public.performance_event_mappings) as external_event_mappings;

-- 2. Actual reasons records are not eligible (count unique predictions, not bets).
select reason, count(*) as predictions
from public.performance_predictions p
cross join lateral (
 select distinct jsonb_array_elements_text(p.eligibility_reasons) as reason
) reasons
group by reason order by predictions desc,reason;

-- 3. Scheduler AND registry must both be enabled for dispatch to run.
select j.jobname,j.active as cron_active,
       r.component_key,r.enabled as registry_enabled,
       r.endpoint_path
from cron.job j
left join public.pipeline_component_registry r
 on j.command like '%' || r.component_key || '%'
where j.jobname like 'performance-%'
order by j.jobname,r.component_key;

-- 4. HTTP requests and successful acknowledgments of pipeline components.
select component_key,count(*) as dispatches,
       count(*) filter(where response_ok) as successful_responses,
       max(enqueued_at) as latest_dispatch,
       max(responded_at) as latest_response
from public.pipeline_http_request_log
where component_key like 'performance_%'
group by component_key order by component_key;

-- 5. Detect accidental duplicate grading rows: do not count each as an independent bet.
select audit_id,event_id,side_key,count(*) as repeats
from public.candidate_grades
group by audit_id,event_id,side_key
having count(*) > 1
order by repeats desc limit 25;

-- 6. Sample ineligible records without changing historical provenance.
select source_key,sport,event_key,market_type,side,model_mode,
       valid,eligibility_reasons,captured_at,starts_at
from public.performance_predictions
where not valid
order by captured_at desc limit 20;

-- Acceptance criteria:
-- A. Capture and settle Edge Functions exist, return authorized non-404 responses.
-- B. New records have a canonical sport/event identity, a real pregame receipt,
--    a known probability basis and market-specific settlement contract.
-- C. Only LIVE, valid, pregame decisions qualify as PLAY; shadow/legacy never do.
-- D. A real final result creates exactly one latest settlement per prediction;
--    rerunning settlement is idempotent, and revisions preserve prior history.
-- E. Dashboard performance excludes unmatched/malformed predictions and
--    deduplicates by original decision, not by both sides of a market.
