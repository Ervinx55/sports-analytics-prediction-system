create table if not exists edge_lab.pregame_research_boards (
board_key text primary key,
slate_date date not null,
sport text not null,
created_at timestamptz not null default now(),
status text not null default 'PREGAME_RESEARCH' check (status in ('PREGAME_RESEARCH','CLOSED','REVIEWED')),
research_policy text not null,
picks jsonb not null,
notes text not null default ''
);
alter table edge_lab.pregame_research_boards enable row level security;
revoke all on edge_lab.pregame_research_boards from public,anon,authenticated;
grant select on edge_lab.pregame_research_boards to service_role;
comment on table edge_lab.pregame_research_boards is 'Private immutable pregame research snapshots; not official independent model predictions or wager records.';