create table if not exists edge_lab.external_prop_archive (
 id bigint generated always as identity primary key,
 provider text not null,
 sport text not null check(sport in ('NBA','NFL')),
 game_date date not null,
 vendor_game_id text not null,
 vendor_player_id text not null,
 player_name text not null,
 team text,
 opponent text,
 stat_id text not null,
 first_line numeric,
 first_odds integer,
 closing_line numeric,
 closing_odds integer,
 best_closing_odds integer,
 best_closing_book text,
 actual_stat numeric,
 result text check(result in ('over','under','push','void')),
 vendor_season text,
 quote_timestamps_verified boolean not null default false,
 independent_result_verified boolean not null default false,
 pregame_model_snapshot_available boolean not null default false,
 calibration_eligible boolean not null default false,
 imported_at timestamptz not null default now(),
 raw jsonb not null default '{}'::jsonb,
 constraint external_prop_archive_uniq unique(provider,sport,vendor_game_id,vendor_player_id,stat_id)
);
alter table edge_lab.external_prop_archive enable row level security;
revoke all on edge_lab.external_prop_archive from anon,authenticated;
revoke all on sequence edge_lab.external_prop_archive_id_seq from anon,authenticated;
grant select,insert on edge_lab.external_prop_archive to service_role;
grant usage on sequence edge_lab.external_prop_archive_id_seq to service_role;
create index if not exists external_prop_archive_game_idx on edge_lab.external_prop_archive(sport,game_date);