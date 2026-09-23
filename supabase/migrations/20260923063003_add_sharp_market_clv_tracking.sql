
create table if not exists public.sharp_market_clv (
  observation_id bigint primary key references public.market_grade_observations(id) on delete cascade,
  captured_at timestamptz not null default now(),
  sport text not null default 'MLB',
  event_id text not null,
  game_pk bigint,
  starts_at timestamptz,
  away_team text,
  home_team text,
  market_type text not null,
  market_side text not null,
  market_label text,
  line numeric,
  decision_status text,
  outcome text,
  best_book text,
  best_odds integer,
  model_probability numeric,
  market_fair_probability numeric,
  first_tracked_at timestamptz,
  first_tracked_sharp_probability numeric,
  first_tracked_source_count integer not null default 0,
  closing_at timestamptz,
  closing_sharp_probability numeric,
  closing_source_count integer not null default 0,
  tracked_sharp_move_pp numeric,
  market_to_close_clv_pp numeric,
  model_vs_close_pp numeric,
  closing_fair_american_odds integer,
  source_summary jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb
);

alter table public.sharp_market_clv enable row level security;

create index if not exists sharp_market_clv_event_idx
  on public.sharp_market_clv(sport,event_id,market_type,market_side);

create index if not exists sharp_market_clv_start_idx
  on public.sharp_market_clv(starts_at desc);

grant select, insert, update on public.sharp_market_clv to service_role;
