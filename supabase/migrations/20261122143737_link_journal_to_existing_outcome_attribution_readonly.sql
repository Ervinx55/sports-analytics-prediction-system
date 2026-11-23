create or replace view public.edge_journal_outcome_research_v1 with (security_invoker=true) as
select j.id as journal_id,j.issued_at,j.sport,j.event_id,j.market_type,j.side,j.line,j.decision,j.provenance,
a.outcome as attributed_outcome,a.process_grade,a.primary_attribution,a.evaluated_at as outcome_evaluated_at,
'EXISTING_ATTRIBUTION_UNVERIFIED_OFFICIAL'::text as verification_level,
false as documented_wager_settlement
from public.edge_decision_journal_v1 j
join public.decision_outcome_attribution a
 on j.source='market_grade_observations'
 and a.leg_type='TEAM'
 and a.observation_id=j.source_reference::bigint
 and a.event_id=j.event_id
where a.outcome in ('W','L','PUSH');
revoke all on public.edge_journal_outcome_research_v1 from anon,authenticated;

