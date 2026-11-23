create or replace view public.edge_nba_prop_outcome_audit_v1 with (security_invoker=true) as
select j.id as journal_id,j.issued_at,j.starts_at,j.event_id,j.player_id,j.market_type,j.side,j.line,j.odds,j.decision,
o.payload->>'outcome' as upstream_outcome,
nullif(o.payload->>'actual','')::numeric as upstream_actual,
o.payload->>'settlementPolicy' as upstream_settlement_policy,
o.payload->>'officialEventId' as upstream_event_id,
case when o.identity is null then 'UNMATCHED'
when o.payload->>'officialEventId' is distinct from j.event_id then 'EVENT_MISMATCH'
when o.payload->>'playerID' is distinct from j.player_id then 'PLAYER_MISMATCH'
when o.payload->>'sourceContract' is null then 'SOURCE_CONTRACT_MISSING'
else 'MATCHED_RESEARCH_ONLY' end as verification_state,
false as official_box_score_reverified,
false as wager_settled
from public.edge_decision_journal_v1 j
left join public.nba_prop_outcomes_v1 o
on o.identity=j.context->>'identity'
where j.source='nba_live_decisions_v1';
revoke all on public.edge_nba_prop_outcome_audit_v1 from anon,authenticated;

