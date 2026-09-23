-- Reconstructed from production catalog on 2026-09-23.
-- Catch-up source for fresh environments; do not replay blindly on current production.

CREATE OR REPLACE FUNCTION public.trigger_model_audit()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.enqueue_pipeline_http_v1('model_audit','{}'::jsonb);
$function$;
revoke execute on function public.trigger_model_audit() from public, anon, authenticated;
grant execute on function public.trigger_model_audit() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_player_prop_capture()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.enqueue_pipeline_http_v1('player_prop_capture','{}'::jsonb);
$function$;
revoke execute on function public.trigger_player_prop_capture() from public, anon, authenticated;
grant execute on function public.trigger_player_prop_capture() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_sharp_source_refresh()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.enqueue_pipeline_http_v1('sharp_sources','{}'::jsonb);
$function$;
revoke execute on function public.trigger_sharp_source_refresh() from public, anon, authenticated;
grant execute on function public.trigger_sharp_source_refresh() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_team_market_grading()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.enqueue_pipeline_http_v1('team_grading','{}'::jsonb);
$function$;
revoke execute on function public.trigger_team_market_grading() from public, anon, authenticated;
grant execute on function public.trigger_team_market_grading() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_player_prop_grading()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.enqueue_pipeline_http_v1('prop_grading','{}'::jsonb);
$function$;
revoke execute on function public.trigger_player_prop_grading() from public, anon, authenticated;
grant execute on function public.trigger_player_prop_grading() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_sharp_clv_capture()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.enqueue_pipeline_http_v1('sharp_clv','{}'::jsonb);
$function$;
revoke execute on function public.trigger_sharp_clv_capture() from public, anon, authenticated;
grant execute on function public.trigger_sharp_clv_capture() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_mlb_verification_gate()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.enqueue_pipeline_http_v1('verification_gate','{}'::jsonb);
$function$;
revoke execute on function public.trigger_mlb_verification_gate() from public, anon, authenticated;
grant execute on function public.trigger_mlb_verification_gate() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_mlb_weather_park()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.enqueue_pipeline_http_v1('weather_park','{}'::jsonb);
$function$;
revoke execute on function public.trigger_mlb_weather_park() from public, anon, authenticated;
grant execute on function public.trigger_mlb_weather_park() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_model_governance_refresh()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.enqueue_pipeline_http_v1('model_governance','{}'::jsonb);
$function$;
revoke execute on function public.trigger_model_governance_refresh() from public, anon, authenticated;
grant execute on function public.trigger_model_governance_refresh() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_player_prop_clv_refresh()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.enqueue_pipeline_http_v1('prop_clv','{}'::jsonb);
$function$;
revoke execute on function public.trigger_player_prop_clv_refresh() from public, anon, authenticated;
grant execute on function public.trigger_player_prop_clv_refresh() to service_role;

CREATE OR REPLACE FUNCTION public.trigger_sharp_disagreement_shadow()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'vault', 'pg_catalog'
AS $function$
  select net.http_post(
    url := (
      select decrypted_secret from vault.decrypted_secrets
      where name='snapshot_project_url' limit 1
    ) || '/functions/v1/refresh-sharp-disagreement-shadow',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(
        select decrypted_secret from vault.decrypted_secrets
        where name='snapshot_publishable_key' limit 1
      ),
      'Authorization','Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name='snapshot_publishable_key' limit 1
      )
    ),
    body := '{"hours":48}'::jsonb,
    timeout_milliseconds := 60000
  );
$function$;
revoke execute on function public.trigger_sharp_disagreement_shadow() from public, anon, authenticated;
grant execute on function public.trigger_sharp_disagreement_shadow() to service_role;

-- Normalize cron to the exact current production schedule. No literal API keys/JWTs are stored.
select cron.unschedule(jobid) from cron.job where jobname='decision-outcome-attribution-10min';
select cron.schedule('decision-outcome-attribution-10min','12-59/10 * * * *',$cron$select public.trigger_decision_outcome_attribution();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='decision-timing-shadow-5min';
select cron.schedule('decision-timing-shadow-5min','10-59/5 * * * *',$cron$select public.trigger_decision_timing_shadow();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='market-decision-fusion-5min';
select cron.schedule('market-decision-fusion-5min','7-59/5 * * * *',$cron$select public.trigger_market_decision_fusion();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='market-policy-shadow-5min';
select cron.schedule('market-policy-shadow-5min','1-59/5 * * * *',$cron$select public.refresh_market_policy_shadow();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='market-price-sensitivity-shadow-5min';
select cron.schedule('market-price-sensitivity-shadow-5min','2-59/5 * * * *',$cron$select public.refresh_market_price_sensitivity_shadow();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='market-uncertainty-shadow-5min';
select cron.schedule('market-uncertainty-shadow-5min','*/5 * * * *',$cron$select public.refresh_market_uncertainty_shadow();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-closing-window-hourly';
select cron.schedule('mlb-closing-window-hourly','45 * * * *',$cron$select public.trigger_closing_snapshot();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-market-snapshot-midday';
select cron.schedule('mlb-market-snapshot-midday','0 18 * * *',$cron$select public.trigger_market_snapshot('midday');$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-market-snapshot-morning';
select cron.schedule('mlb-market-snapshot-morning','0 13 * * *',$cron$select public.trigger_market_snapshot('morning');$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-market-snapshot-pregame';
select cron.schedule('mlb-market-snapshot-pregame','30 21 * * *',$cron$select public.trigger_market_snapshot('pregame');$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-model-audit-hourly';
select cron.schedule('mlb-model-audit-hourly','20 * * * *',$cron$select public.trigger_model_audit();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-model-grading-hourly';
select cron.schedule('mlb-model-grading-hourly','35 * * * *',$cron$select public.trigger_model_grading();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-player-prop-clv-5min';
select cron.schedule('mlb-player-prop-clv-5min','*/5 * * * *',$cron$select public.trigger_player_prop_clv_refresh();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-player-prop-quote-retention-daily';
select cron.schedule('mlb-player-prop-quote-retention-daily','55 9 * * *',$cron$
  delete from public.player_prop_market_quotes
  where observed_at < now() - interval '14 days';
  $cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-player-props-capture-hourly';
select cron.schedule('mlb-player-props-capture-hourly','25 * * * *',$cron$select public.trigger_player_prop_capture();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-player-props-grading-live';
select cron.schedule('mlb-player-props-grading-live','*/5 * * * *',$cron$select public.trigger_player_prop_grading();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-sharp-clv-10min';
select cron.schedule('mlb-sharp-clv-10min','*/10 * * * *',$cron$select public.trigger_sharp_clv_capture();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-sharp-sources-5min';
select cron.schedule('mlb-sharp-sources-5min','*/5 * * * *',$cron$select public.trigger_sharp_source_refresh();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-team-market-grading-live';
select cron.schedule('mlb-team-market-grading-live','*/5 * * * *',$cron$select public.trigger_team_market_grading();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-verification-gate-5min';
select cron.schedule('mlb-verification-gate-5min','3-59/5 * * * *',$cron$select public.trigger_mlb_verification_gate();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-verification-retention-daily';
select cron.schedule('mlb-verification-retention-daily','35 9 * * *',$cron$select public.cleanup_mlb_verification_history();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-weather-park-5min';
select cron.schedule('mlb-weather-park-5min','4-59/5 * * * *',$cron$select public.trigger_mlb_weather_park();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mlb-weather-park-retention-daily';
select cron.schedule('mlb-weather-park-retention-daily','40 9 * * *',$cron$select public.cleanup_mlb_weather_park_history();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mls-closing-window-hourly';
select cron.schedule('mls-closing-window-hourly','18 * * * *',$cron$select public.trigger_league_snapshot('MLS','closing-window',2);$cron$);
select cron.unschedule(jobid) from cron.job where jobname='mls-market-baseline-daily';
select cron.schedule('mls-market-baseline-daily','15 13 * * *',$cron$select public.trigger_league_snapshot('MLS','daily-baseline',48);$cron$);
select cron.unschedule(jobid) from cron.job where jobname='model-governance-6hour';
select cron.schedule('model-governance-6hour','15 */6 * * *',$cron$select public.trigger_model_governance_refresh();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='nfl-closing-window-hourly';
select cron.schedule('nfl-closing-window-hourly','8 * * * *',$cron$select public.trigger_league_snapshot('NFL','closing-window',2);$cron$);
select cron.unschedule(jobid) from cron.job where jobname='nfl-market-baseline-daily';
select cron.schedule('nfl-market-baseline-daily','5 13 * * *',$cron$select public.trigger_league_snapshot('NFL','daily-baseline',192);$cron$);
select cron.unschedule(jobid) from cron.job where jobname='parlay-correlation-shadow-5min';
select cron.schedule('parlay-correlation-shadow-5min','9-59/5 * * * *',$cron$select public.trigger_parlay_correlation_shadow();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='pipeline-http-reconcile-1min';
select cron.schedule('pipeline-http-reconcile-1min','* * * * *',$cron$select public.reconcile_pipeline_http_requests_v1();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='player-prop-decision-fusion-5min';
select cron.schedule('player-prop-decision-fusion-5min','8-59/5 * * * *',$cron$select public.trigger_player_prop_decision_fusion();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='sharp-disagreement-shadow-5min';
select cron.schedule('sharp-disagreement-shadow-5min','6-59/5 * * * *',$cron$select public.trigger_sharp_disagreement_shadow();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='sharp-source-retention-daily';
select cron.schedule('sharp-source-retention-daily','15 9 * * *',$cron$select public.cleanup_sharp_source_quotes();$cron$);
select cron.unschedule(jobid) from cron.job where jobname='ucl-closing-window-hourly';
select cron.schedule('ucl-closing-window-hourly','28 * * * *',$cron$select public.trigger_league_snapshot('UEFA_CHAMPIONS_LEAGUE','closing-window',2);$cron$);
select cron.unschedule(jobid) from cron.job where jobname='ucl-market-baseline-daily';
select cron.schedule('ucl-market-baseline-daily','25 13 * * *',$cron$select public.trigger_league_snapshot('UEFA_CHAMPIONS_LEAGUE','daily-baseline',48);$cron$);
