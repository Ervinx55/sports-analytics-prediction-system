select cron.unschedule('mlb-player-prop-quote-retention-daily');

select cron.schedule(
  'mlb-player-prop-quote-retention-daily',
  '55 9 * * *',
  $job$
    select public.archive_player_prop_quotes();
    delete from public.player_prop_market_quotes
    where observed_at < now() - interval '14 days';
  $job$
);
