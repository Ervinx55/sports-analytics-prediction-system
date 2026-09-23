
create or replace view public.model_calibration_latest as
with ranked as (
  select
    a.*,
    g.result,
    g.won,
    g.closing_odds,
    g.closing_fair_probability,
    g.initial_implied_probability,
    g.closing_implied_probability,
    g.clv_implied_pp,
    g.model_vs_close_pp,
    g.graded_at,
    row_number() over (
      partition by a.event_id, a.side_key
      order by a.captured_at desc
    ) as rn
  from public.model_audit_observations a
  join public.candidate_grades g
    on g.audit_id = a.id
)
select *
from ranked
where rn = 1;
