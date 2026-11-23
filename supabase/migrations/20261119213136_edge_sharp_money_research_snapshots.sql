create table if not exists public.edge_sharp_money_snapshots (
 id bigint generated always as identity primary key,
 event_id text not null,
 league text not null,
 market text not null,
 selection text not null,
 book text not null,
 source text not null,
 observed_at timestamptz not null,
 starts_at timestamptz not null,
 ticket_pct numeric(5,2),
 handle_pct numeric(5,2),
 ticket_count integer,
 open_line numeric,
 current_line numeric,
 movement_toward_selection boolean,
 imported_at timestamptz not null default now(),
 constraint edge_split_ticket_range check(ticket_pct between 0 and 100),
 constraint edge_split_handle_range check(handle_pct between 0 and 100),
 constraint edge_split_count_nonnegative check(ticket_count is null or ticket_count >= 0),
 constraint edge_split_pregame check(observed_at < starts_at),
 constraint edge_split_unique unique(event_id,market,selection,book,source,observed_at)
);
alter table public.edge_sharp_money_snapshots enable row level security;
revoke all on public.edge_sharp_money_snapshots from anon, authenticated;
revoke all on sequence public.edge_sharp_money_snapshots_id_seq from anon, authenticated;
create index if not exists edge_sharp_money_event_time on public.edge_sharp_money_snapshots(event_id, observed_at desc);
comment on table public.edge_sharp_money_snapshots is 'Research-only authorized pregame betting splits; no public policies; server-side authorized imports only.';