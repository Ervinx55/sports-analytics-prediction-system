create table if not exists edge_lab.prop_market_capture (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  event_starts_at timestamptz not null,
  sport text not null check(sport in ('NBA','NFL')),
  event_id text not null,
  player_id text not null,
  player_name text not null,
  stat_id text not null,
  side text not null check(side in ('over','under')),
  line numeric not null check(line>=0),
  book text not null,
  american_odds integer not null check(american_odds <= -100 or american_odds >= 100),
  source text not null,
  source_quote_at timestamptz not null,
  model_version text,
  pregame_model_probability numeric check(pregame_model_probability > 0 and pregame_model_probability < 1),
  prediction_observed_at timestamptz,
  is_production_model boolean not null default false,
  provenance text not null default 'LIVE_PROVIDER_OBSERVATION',
  raw jsonb not null default '{}'::jsonb,
  constraint prop_capture_pregame_only check(captured_at < event_starts_at and source_quote_at <= captured_at),
  constraint prop_capture_prediction_before_event check(prediction_observed_at is null or (pregame_model_probability is not null and prediction_observed_at <= captured_at and prediction_observed_at < event_starts_at)),
  constraint prop_capture_prediction_pair check((pregame_model_probability is null and prediction_observed_at is null) or (pregame_model_probability is not null and prediction_observed_at is not null))
);
create unique index if not exists prop_capture_identity_idx on edge_lab.prop_market_capture
(sport,event_id,player_id,stat_id,side,line,book,source_quote_at);
create index if not exists prop_capture_pending_idx on edge_lab.prop_market_capture(sport,event_starts_at);
create table if not exists edge_lab.prop_market_settlements (
  id bigint generated always as identity primary key,
  sport text not null check(sport in ('NBA','NFL')),
  event_id text not null,
  player_id text not null,
  stat_id text not null,
  actual_value numeric not null check(actual_value>=0),
  result_source text not null,
  finalized_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  constraint prop_settlement_unique unique(sport,event_id,player_id,stat_id)
);
alter table edge_lab.prop_market_capture enable row level security;
alter table edge_lab.prop_market_settlements enable row level security;
revoke all on edge_lab.prop_market_capture from anon,authenticated;
revoke all on edge_lab.prop_market_settlements from anon,authenticated;
revoke all on sequence edge_lab.prop_market_capture_id_seq from anon,authenticated;
revoke all on sequence edge_lab.prop_market_settlements_id_seq from anon,authenticated;
grant select,insert on edge_lab.prop_market_capture to service_role;
grant select,insert on edge_lab.prop_market_settlements to service_role;
grant usage on sequence edge_lab.prop_market_capture_id_seq to service_role;
grant usage on sequence edge_lab.prop_market_settlements_id_seq to service_role;