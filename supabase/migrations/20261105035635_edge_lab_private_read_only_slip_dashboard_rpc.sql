create or replace function public.edge_lab_slip_history_v1()
returns table (
 slip_key text, event_date date, source text, recorded_at timestamptz,
 ticket_wager_usd numeric, potential_payout_usd numeric,
 reported_slip_status text, recorded_at_stage text, legs jsonb, source_notes text, integrity_notes text
)
language sql stable security invoker set search_path = ''
as $fn$
 select s.slip_key,s.event_date,s.source,s.recorded_at,
 s.ticket_wager_usd,s.potential_payout_usd,s.reported_slip_status,
 s.recorded_at_stage,s.legs,s.source_notes,s.integrity_notes
 from edge_lab.slip_archive s
 order by s.event_date desc,s.recorded_at desc
 limit 200
$fn$;
revoke all on function public.edge_lab_slip_history_v1() from public, anon, authenticated;
grant usage on schema edge_lab to service_role;
grant select on edge_lab.slip_archive to service_role;
grant execute on function public.edge_lab_slip_history_v1() to service_role;