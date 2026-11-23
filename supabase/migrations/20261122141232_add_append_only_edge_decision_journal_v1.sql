create table if not exists public.edge_decision_journal_v1 (
 id bigint generated always as identity primary key,
 recorded_at timestamptz not null default now(),
 issued_at timestamptz not null,
 source text not null,
 source_reference text,
 sport text not null,
 event_id text,
 starts_at timestamptz,
 player_id text,
 player_name text,
 market_type text not null,
 side text,
 line numeric,
 odds integer,
 book text,
 decision text not null check (decision in ('BUY','AVOID','PASS','WATCH','REVERSED','PLACED')),
 previous_decision_id bigint references public.edge_decision_journal_v1(id),
 model_probability numeric check (model_probability between 0 and 1),
 model_version text,
 context jsonb not null default '{}'::jsonb,
 evidence jsonb not null default '{}'::jsonb,
 provenance text not null check (provenance in ('system','conversation','documented_ticket','historical_backfill')),
 is_documented_wager boolean not null default false,
 unique (source,source_reference)
);
create index if not exists edge_decision_journal_event_idx on public.edge_decision_journal_v1 (sport,event_id,issued_at);
create index if not exists edge_decision_journal_issued_idx on public.edge_decision_journal_v1 (issued_at);
create or replace function public.edge_decision_journal_immutable() returns trigger language plpgsql as $$ begin raise exception 'Decision journal is append-only'; end $$;
drop trigger if exists edge_decision_journal_no_update_delete on public.edge_decision_journal_v1;
create trigger edge_decision_journal_no_update_delete before update or delete on public.edge_decision_journal_v1 for each row execute function public.edge_decision_journal_immutable();
alter table public.edge_decision_journal_v1 enable row level security;
revoke all on public.edge_decision_journal_v1 from anon,authenticated;

