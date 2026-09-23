
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.trigger_closing_snapshot() from public, anon, authenticated;
revoke execute on function public.trigger_league_snapshot(text, text, integer) from public, anon, authenticated;
revoke execute on function public.trigger_market_snapshot(text) from public, anon, authenticated;
revoke execute on function public.trigger_model_audit() from public, anon, authenticated;
revoke execute on function public.trigger_model_grading() from public, anon, authenticated;
revoke execute on function public.trigger_player_prop_capture() from public, anon, authenticated;
revoke execute on function public.trigger_player_prop_grading() from public, anon, authenticated;
revoke execute on function public.trigger_team_market_grading() from public, anon, authenticated;

grant execute on function public.rls_auto_enable() to service_role;
grant execute on function public.trigger_closing_snapshot() to service_role;
grant execute on function public.trigger_league_snapshot(text, text, integer) to service_role;
grant execute on function public.trigger_market_snapshot(text) to service_role;
grant execute on function public.trigger_model_audit() to service_role;
grant execute on function public.trigger_model_grading() to service_role;
grant execute on function public.trigger_player_prop_capture() to service_role;
grant execute on function public.trigger_player_prop_grading() to service_role;
grant execute on function public.trigger_team_market_grading() to service_role;
