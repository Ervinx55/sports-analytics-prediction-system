
    create table if not exists public.team_market_results (
      observation_id bigint primary key
        references public.market_grade_observations(id) on delete cascade,
      event_id text not null,
      game_pk bigint,
      market_type text not null,
      market_side text not null,
      market_label text not null,
      line numeric,
      decision_status text not null,
      actual_value numeric,
      away_score integer,
      home_score integer,
      outcome text,
      won boolean,
      pushed boolean not null default false,
      pass_evaluation text,
      graded_at timestamptz not null default now(),
      raw jsonb not null default '{}'::jsonb
    );

    create index if not exists team_market_results_event_idx
      on public.team_market_results(event_id, market_type, market_side);

    create or replace view public.team_market_latest_results as
    with ranked as (
      select
        o.*,
        r.decision_status,
        r.actual_value,
        r.away_score,
        r.home_score,
        r.outcome,
        r.won,
        r.pushed,
        r.pass_evaluation,
        r.graded_at,
        row_number() over (
          partition by
            o.event_id,
            o.market_type,
            o.market_side,
            coalesce(o.line::text, '')
          order by o.captured_at desc, o.id desc
        ) as rn
      from public.market_grade_observations o
      join public.team_market_results r
        on r.observation_id = o.id
    )
    select *
    from ranked
    where rn = 1;

    create or replace view public.player_prop_latest_results as
    with ranked as (
      select
        o.*,
        r.actual_value,
        r.outcome,
        r.won,
        r.pushed,
        r.graded_at,
        row_number() over (
          partition by
            o.event_id,
            o.player_id,
            o.stat_id,
            o.line,
            o.side
          order by o.captured_at desc, o.id desc
        ) as rn
      from public.player_prop_observations o
      join public.player_prop_results r
        on r.observation_id = o.id
    )
    select *
    from ranked
    where rn = 1;

    alter table public.team_market_results enable row level security;
  
