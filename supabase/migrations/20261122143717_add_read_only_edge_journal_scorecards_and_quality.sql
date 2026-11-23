create or replace view public.edge_journal_daily_scorecard_v1 with (security_invoker=true) as
select (issued_at at time zone 'America/Chicago')::date as decision_day_ct,
sport,provenance,decision,
count(*) as evaluation_count,
count(distinct concat_ws('|',coalesce(event_id,''),coalesce(player_id,player_name,''),market_type,coalesce(side,''),coalesce(line::text,''))) as distinct_market_sides,
count(*) filter (where model_probability is not null) as probability_documented,
count(*) filter (where odds is not null) as odds_documented,
count(*) filter (where event_id is not null and starts_at is not null) as event_time_documented,
count(*) filter (where is_documented_wager) as documented_wager_records
from public.edge_decision_journal_v1
group by 1,2,3,4;
create or replace view public.edge_journal_quality_v1 with (security_invoker=true) as
select id,issued_at,sport,source,source_reference,decision,market_type,
case when event_id is null then 'MISSING_EVENT'
when starts_at is null then 'MISSING_START_TIME'
when side is null then 'MISSING_SIDE'
when line is null and lower(market_type) not in ('moneyline','ml') then 'MISSING_LINE'
when odds is null then 'MISSING_ODDS'
when model_probability is null then 'MISSING_PROBABILITY'
else 'READY_FOR_OUTCOME_MATCH' end as reconciliation_state
from public.edge_decision_journal_v1;
revoke all on public.edge_journal_daily_scorecard_v1,public.edge_journal_quality_v1 from anon,authenticated;

