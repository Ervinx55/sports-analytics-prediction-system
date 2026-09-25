create table if not exists public.player_prop_quote_archive (
  market_key text primary key,
  sport text not null,
  source text not null,
  event_id text not null,
  starts_at timestamptz,
  away_team text,
  home_team text,
  player_id text,
  player_name text not null,
  stat_id text not null,
  market_name text,
  book text not null,
  side text not null check (side = any (array['over'::text, 'under'::text])),
  line numeric,
  opening_observed_at timestamptz not null,
  opening_odds integer,
  opening_source_updated_at timestamptz,
  closing_observed_at timestamptz not null,
  closing_odds integer,
  closing_source_updated_at timestamptz,
  observation_count integer not null default 1 check (observation_count >= 1),
  archived_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

alter table public.player_prop_quote_archive enable row level security;
revoke all on table public.player_prop_quote_archive from anon, authenticated;
grant select, insert, update, delete on table public.player_prop_quote_archive to service_role;

create index if not exists player_prop_quote_archive_start_idx
  on public.player_prop_quote_archive (sport, starts_at desc);

create index if not exists player_prop_quote_archive_player_idx
  on public.player_prop_quote_archive
  (sport, player_name, stat_id, book, closing_observed_at desc);

create index if not exists player_prop_quote_archive_event_idx
  on public.player_prop_quote_archive
  (sport, event_id, stat_id, side, line, closing_observed_at desc);

create or replace function public.archive_player_prop_quotes()
returns bigint
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with eligible as (
    select
      q.*,
      coalesce(q.player_id, lower(q.player_name)) as player_key
    from public.player_prop_market_quotes q
    where q.starts_at is not null
      and q.starts_at <= now() - interval '2 hours'
      and q.observed_at < q.starts_at
  ),
  collapsed as (
    select
      md5(concat_ws(
        '|',
        sport,
        source,
        event_id,
        coalesce(player_key, ''),
        stat_id,
        book,
        side,
        coalesce(line::text, 'NULL')
      )) as market_key,
      sport,
      source,
      event_id,
      max(starts_at) as starts_at,
      max(away_team) as away_team,
      max(home_team) as home_team,
      max(player_id) as player_id,
      max(player_name) as player_name,
      stat_id,
      max(market_name) as market_name,
      book,
      side,
      line,
      min(observed_at) as opening_observed_at,
      (array_agg(odds order by observed_at asc, id asc))[1] as opening_odds,
      (array_agg(source_updated_at order by observed_at asc, id asc))[1]
        as opening_source_updated_at,
      max(observed_at) as closing_observed_at,
      (array_agg(odds order by observed_at desc, id desc))[1] as closing_odds,
      (array_agg(source_updated_at order by observed_at desc, id desc))[1]
        as closing_source_updated_at,
      count(*)::integer as observation_count
    from eligible
    group by
      sport,
      source,
      event_id,
      player_key,
      stat_id,
      book,
      side,
      line
  ),
  upserted as (
    insert into public.player_prop_quote_archive (
      market_key,
      sport,
      source,
      event_id,
      starts_at,
      away_team,
      home_team,
      player_id,
      player_name,
      stat_id,
      market_name,
      book,
      side,
      line,
      opening_observed_at,
      opening_odds,
      opening_source_updated_at,
      closing_observed_at,
      closing_odds,
      closing_source_updated_at,
      observation_count,
      archived_at,
      raw
    )
    select
      market_key,
      sport,
      source,
      event_id,
      starts_at,
      away_team,
      home_team,
      player_id,
      player_name,
      stat_id,
      market_name,
      book,
      side,
      line,
      opening_observed_at,
      opening_odds,
      opening_source_updated_at,
      closing_observed_at,
      closing_odds,
      closing_source_updated_at,
      observation_count,
      now(),
      jsonb_build_object(
        'archived_from', 'player_prop_market_quotes',
        'archive_policy', 'pregame_open_close_v1'
      )
    from collapsed
    on conflict (market_key) do update
    set
      starts_at = excluded.starts_at,
      away_team = excluded.away_team,
      home_team = excluded.home_team,
      player_id = excluded.player_id,
      player_name = excluded.player_name,
      market_name = excluded.market_name,
      opening_observed_at =
        least(
          public.player_prop_quote_archive.opening_observed_at,
          excluded.opening_observed_at
        ),
      opening_odds =
        case
          when excluded.opening_observed_at <
               public.player_prop_quote_archive.opening_observed_at
            then excluded.opening_odds
          else public.player_prop_quote_archive.opening_odds
        end,
      opening_source_updated_at =
        case
          when excluded.opening_observed_at <
               public.player_prop_quote_archive.opening_observed_at
            then excluded.opening_source_updated_at
          else public.player_prop_quote_archive.opening_source_updated_at
        end,
      closing_observed_at =
        greatest(
          public.player_prop_quote_archive.closing_observed_at,
          excluded.closing_observed_at
        ),
      closing_odds =
        case
          when excluded.closing_observed_at >
               public.player_prop_quote_archive.closing_observed_at
            then excluded.closing_odds
          else public.player_prop_quote_archive.closing_odds
        end,
      closing_source_updated_at =
        case
          when excluded.closing_observed_at >
               public.player_prop_quote_archive.closing_observed_at
            then excluded.closing_source_updated_at
          else public.player_prop_quote_archive.closing_source_updated_at
        end,
      observation_count =
        greatest(
          public.player_prop_quote_archive.observation_count,
          excluded.observation_count
        ),
      archived_at = now(),
      raw = public.player_prop_quote_archive.raw || excluded.raw
    returning 1
  )
  select count(*)::bigint from upserted;
$$;

revoke all on function public.archive_player_prop_quotes()
  from public, anon, authenticated;
grant execute on function public.archive_player_prop_quotes()
  to service_role;

select public.archive_player_prop_quotes();
