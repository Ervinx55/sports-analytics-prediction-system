create schema if not exists edge_lab;
create table if not exists edge_lab.slip_archive (
  slip_key text primary key,
  event_date date not null,
  source text not null,
  recorded_at timestamptz not null default now(),
  ticket_wager_usd numeric(12,2),
  potential_payout_usd numeric(12,2),
  reported_slip_status text not null check(reported_slip_status in ('IN_PROGRESS','USER_REPORTED_WON','OFFICIALLY_SETTLED_WON','OFFICIALLY_SETTLED_LOST','VOID','UNKNOWN')),
  recorded_at_stage text not null check(recorded_at_stage in ('IN_GAME','PREGAME','POSTGAME')),
  legs jsonb not null,
  source_notes text,
  integrity_notes text,
  updated_at timestamptz not null default now()
);
alter table edge_lab.slip_archive enable row level security;
revoke all on schema edge_lab from public, anon, authenticated;
revoke all on edge_lab.slip_archive from public, anon, authenticated;
comment on table edge_lab.slip_archive is 'Private historical slip archive, not a pregame prediction ledger or evidence of actual settlement.';