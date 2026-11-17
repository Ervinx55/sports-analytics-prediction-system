-- 01-schema
select table_name, string_agg(column_name||':'||data_type, ', ' order by ordinal_position) as columns from information_schema.columns where table_schema='public' and (table_name like 'nba%' or table_name like '%audit%' or table_name like '%model%' or table_name like '%game%' or table_name like '%candidate%' or table_name like '%injury%') group by table_name order by table_name;

-- 02-tables
select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name;

-- 03-performance-schema
select table_name,string_agg(column_name||':'||data_type,', ' order by ordinal_position) as columns from information_schema.columns where table_schema='public' and (table_name like 'performance_%' or table_name='market_grade_observations') group by table_name order by table_name;

-- 04-old-ledger-counts
select 'model_audit_observations' as source,sport,model_version,count(*) n,count(distinct event_id) events,min(captured_at) min_captured,max(captured_at) max_captured,min(starts_at) min_starts,max(starts_at) max_starts from public.model_audit_observations group by sport,model_version union all select 'market_grade_observations',sport,model_version,count(*),count(distinct event_id),min(captured_at),max(captured_at),min(starts_at),max(starts_at) from public.market_grade_observations group by sport,model_version order by source,sport,model_version;

-- 05-current-prediction-inventory
select sport,market_type,model_mode,model_available,probability_basis,valid,count(*) rows,count(distinct event_key) events,count(distinct model_version) models,min(captured_at) min_capture,max(captured_at) max_capture,min(starts_at) min_starts,max(starts_at) max_starts from public.performance_predictions where sport in ('NBA','NFL') group by sport,market_type,model_mode,model_available,probability_basis,valid order by sport,market_type,model_mode,valid;

-- 06-performance-sports
select sport,market_type,model_mode,model_available,probability_basis,valid,count(*) rows,count(distinct event_key) events,min(captured_at) min_capture,max(captured_at) max_capture,min(starts_at) min_starts,max(starts_at) max_starts from public.performance_predictions group by sport,market_type,model_mode,model_available,probability_basis,valid order by sport,market_type,model_mode,valid;

-- 09-winner-current-pairs
with latest as (select distinct on(prediction_id) prediction_id,outcome,revision,source,reason from public.performance_settlements order by prediction_id,revision desc), p as (select *,coalesce(sport,payload->>'sport') as declared_sport from public.performance_predictions where market_type='moneyline') select p.declared_sport,p.model_mode,p.valid,p.model_available,p.model_version,count(*) forecasts,count(distinct coalesce(p.event_key,p.payload->>'eventKey')) payload_events,count(s.prediction_id) latest_settlements,count(*) filter(where s.outcome in('WIN','LOSS')) binary_outcomes,count(*) filter(where p.valid and p.captured_at<p.eligibility_starts_at and s.outcome in('WIN','LOSS')) usable_valid_pregame_pairs,count(*) filter(where p.payload#>>'{provenance,rawIndependentProbability}' is not null) with_raw_independent_probability,min(p.captured_at) min_capture,max(p.captured_at) max_capture from p left join latest s on p.id=s.prediction_id group by p.declared_sport,p.model_mode,p.valid,p.model_available,p.model_version order by p.declared_sport;

-- 10-prop-inventory
select 'observations' as source,count(*) rows,count(distinct payload->>'eventID') events,min(payload->>'issuedAt') earliest,max(payload->>'issuedAt') latest from public.nba_prop_observations_v1 union all select 'forecasts',count(*),count(distinct payload->>'eventID'),min(payload->>'issuedAt'),max(payload->>'issuedAt') from public.nba_prop_forecasts_v1 union all select 'outcomes',count(*),count(distinct payload->>'officialEventId'),min(payload->>'retrievedAt'),max(payload->>'retrievedAt') from public.nba_prop_outcomes_v1 union all select 'summaries',count(*),count(distinct id),min(payload->>'startsAt'),max(payload->>'startsAt') from public.nba_prop_summaries_v1;

-- 11-prop-json-keys
select 'summary' as source,key,count(*) rows from public.nba_prop_summaries_v1 s cross join lateral jsonb_object_keys(s.payload) key group by key union all select 'outcome',key,count(*) from public.nba_prop_outcomes_v1 s cross join lateral jsonb_object_keys(s.payload) key group by key union all select 'forecast',key,count(*) from public.nba_prop_forecasts_v1 s cross join lateral jsonb_object_keys(s.payload) key group by key order by source,key;

-- 12-prop-outcomes-and-forecast-review
select 'outcomes' as kind,payload->>'outcome' as status,payload->>'source' as source,count(*) rows,count(distinct payload->>'officialEventId') events from public.nba_prop_outcomes_v1 group by 2,3 union all select 'forecasts',payload->>'forecastScope',coalesce(payload->>'inputDataRevisionReviewRequired','false'),count(*),count(distinct payload->>'eventID') from public.nba_prop_forecasts_v1 group by 2,3 order by kind,status,source;

-- 13-prop-availability-coverage
select payload->>'forecastScope' as scope,count(*) rows,count(distinct identity) identities,count(distinct payload->>'eventID') events,count(*) filter(where payload#>>'{pregame,availability,publishedAt}' is not null) availability_published,count(*) filter(where payload#>>'{pregame,availability,retrievedAt}' is not null) availability_retrieved,count(*) filter(where (payload#>>'{pregame,availability,publishedAt}')::timestamptz <=(payload->>'issuedAt')::timestamptz and (payload#>>'{pregame,availability,retrievedAt}')::timestamptz <=(payload->>'issuedAt')::timestamptz) availability_known_at_forecast,count(*) filter(where payload#>>'{pregame,participationConfirmed}'='true') participation_confirmed,count(*) filter(where payload#>>'{pregame,minutes,productionEligible}'='true') minutes_production_eligible,count(*) filter(where payload->>'productionEligible'='true') production_eligible,count(*) filter(where payload->>'inputDataRevisionReviewRequired'='true') input_revision_review_required from public.nba_prop_forecasts_v1 group by 1 order by 1;

-- 14-summary-types-and-backup-status
select split_part(id,':',1) as key_prefix,payload->>'source' as source,payload#>>'{backupEvidence,status}' as backup_status,count(*) rows,count(*) filter(where payload ? 'teams') game_summaries,count(*) filter(where payload ? 'players') player_summaries,min(payload->>'startsAt') earliest,max(payload->>'startsAt') latest from public.nba_prop_summaries_v1 group by 1,2,3 order by 1,2,3;

-- 16-prop-pair-coverage
select f.payload->>'forecastScope' as scope,count(*) forecast_rows,count(distinct f.identity) identities,count(*) filter(where o.payload->>'outcome' in('WIN','LOSS')) binary_pairs,count(distinct f.payload->>'eventID') filter(where o.payload->>'outcome' in('WIN','LOSS')) binary_pair_events,count(*) filter(where o.payload->>'outcome' in('WIN','LOSS') and coalesce(f.payload->>'inputDataRevisionReviewRequired','false')<>'true') unflagged_binary_pairs,count(*) filter(where o.identity is null) no_outcome_rows from public.nba_prop_forecasts_v1 f left join public.nba_prop_outcomes_v1 o using(identity) group by 1 order by 1;

-- 17-collector-state-shape
select 'state' as source,key from public.nba_prop_collector_v1 cross join lateral jsonb_object_keys(state) key union all select 'last_report',key from public.nba_prop_collector_v1 cross join lateral jsonb_object_keys(last_report) key order by source,key;

-- 18-winner-eligibility-blockers
select coalesce(p.sport,p.payload->>'sport') sport,p.market_type,reason,count(*) rows from public.performance_predictions p cross join lateral jsonb_array_elements_text(coalesce(p.eligibility_reasons,p.payload->'eligibilityReasons')) reason where market_type='moneyline' group by 1,2,3 order by 1,2,3;

-- 19-current-collector-health
select last_completed_at,last_report->>'at' as report_at,last_report->'history' as history,last_report->'participationConflicts' as participation_conflicts,last_report->'validation' as validation,last_report->'faults' as faults,last_report->'blocked' as blocked,last_report->'productionWeight' as production_weight from public.nba_prop_collector_v1;

-- 20-summary-corrections-and-forecast-times
select count(*) filter(where payload ? 'teams') summary_rows,count(distinct payload->>'id') filter(where payload ? 'teams') payload_ids,count(*) filter(where jsonb_array_length(coalesce(payload#>'{backupEvidence,officialCorrections}','[]'::jsonb))>0) rows_with_official_corrections,count(distinct payload->>'id') filter(where jsonb_array_length(coalesce(payload#>'{backupEvidence,officialCorrections}','[]'::jsonb))>0) corrected_payload_ids,count(*) filter(where (payload->>'observedAt')::timestamptz<=(payload->>'startsAt')::timestamptz) summary_rows_observed_by_start from public.nba_prop_summaries_v1;

-- 21-game-results-counts
select sport,count(*) rows,count(*) filter(where away_score is not null and home_score is not null) scored,min(starts_at) min_starts,max(starts_at) max_starts from public.game_results group by sport;
