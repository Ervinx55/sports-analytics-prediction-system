insert into public.pipeline_component_registry (
  component_key,
  display_name,
  subsystem,
  sport,
  job_name,
  runner_type,
  endpoint_path,
  expected_interval_minutes,
  stale_after_minutes,
  critical,
  enabled,
  notes
)
values (
  'nba_player_prop_capture',
  'NBA Player Prop Capture',
  'Props',
  'NBA',
  'nba-player-props-capture-hourly',
  'HTTP',
  '/functions/v1/capture-nba-player-props',
  60,
  80,
  true,
  false,
  'Ready but intentionally disabled until the next Vercel production deployment exposes /api/nbaprops and NBA data collection is activated.'
)
on conflict (component_key) do update
set display_name=excluded.display_name,
    subsystem=excluded.subsystem,
    sport=excluded.sport,
    job_name=excluded.job_name,
    runner_type=excluded.runner_type,
    endpoint_path=excluded.endpoint_path,
    expected_interval_minutes=excluded.expected_interval_minutes,
    stale_after_minutes=excluded.stale_after_minutes,
    critical=excluded.critical,
    enabled=false,
    notes=excluded.notes;
