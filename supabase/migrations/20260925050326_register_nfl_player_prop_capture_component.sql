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
  'nfl_player_prop_capture',
  'NFL Player Prop Capture',
  'Props',
  'NFL',
  'nfl-player-props-capture-hourly',
  'HTTP',
  '/functions/v1/capture-nfl-player-props',
  60,
  80,
  true,
  false,
  'Ready but intentionally disabled until the next Vercel production deployment activates SharpAPI/The Odds API fallback and NFL props v2 release.'
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
