
alter view if exists public.model_calibration_latest set (security_invoker = true);
alter view if exists public.market_grade_latest set (security_invoker = true);
alter view if exists public.player_prop_latest set (security_invoker = true);
alter view if exists public.sharp_gate_latest set (security_invoker = true);
alter view if exists public.team_market_latest_results set (security_invoker = true);
alter view if exists public.player_prop_latest_results set (security_invoker = true);

revoke execute on function public.rls_auto_enable() from anon, authenticated;
revoke execute on function public.trigger_closing_snapshot() from anon, authenticated;
revoke execute on function public.trigger_league_snapshot(text, text, integer) from anon, authenticated;
revoke execute on function public.trigger_market_snapshot(text) from anon, authenticated;
revoke execute on function public.trigger_model_audit() from anon, authenticated;
revoke execute on function public.trigger_model_grading() from anon, authenticated;
revoke execute on function public.trigger_player_prop_capture() from anon, authenticated;
revoke execute on function public.trigger_player_prop_grading() from anon, authenticated;
revoke execute on function public.trigger_team_market_grading() from anon, authenticated;

grant execute on function public.rls_auto_enable() to service_role;
grant execute on function public.trigger_closing_snapshot() to service_role;
grant execute on function public.trigger_league_snapshot(text, text, integer) to service_role;
grant execute on function public.trigger_market_snapshot(text) to service_role;
grant execute on function public.trigger_model_audit() to service_role;
grant execute on function public.trigger_model_grading() to service_role;
grant execute on function public.trigger_player_prop_capture() to service_role;
grant execute on function public.trigger_player_prop_grading() to service_role;
grant execute on function public.trigger_team_market_grading() to service_role;

create index if not exists market_snapshots_run_id_idx
  on public.market_snapshots(run_id);

create index if not exists sharp_gate_lookup_idx
  on public.sharp_gate_history(
    sport, event_id, market_type, market_side, market_line, checked_at desc
  );
