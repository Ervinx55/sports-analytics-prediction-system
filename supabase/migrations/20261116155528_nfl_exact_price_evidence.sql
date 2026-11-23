create table public.nfl_price_responses_v1 (
 id text primary key check (id ~ '^[0-9a-f]{64}$'),
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 received_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table public.nfl_price_observations_v1 (
 id text primary key check (id ~ '^[0-9a-f]{64}$'),
 payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload->>'schemaVersion' = 'nfl-exact-price-pair-v1'),
 created_at timestamptz not null default now()
);
create table public.nfl_price_collection_runs_v1 (
 id uuid primary key,
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 created_at timestamptz not null default now()
);
alter table public.nfl_price_responses_v1 enable row level security;
alter table public.nfl_price_observations_v1 enable row level security;
alter table public.nfl_price_collection_runs_v1 enable row level security;
revoke all on public.nfl_price_responses_v1, public.nfl_price_observations_v1, public.nfl_price_collection_runs_v1 from public, anon, authenticated, service_role;
grant select, insert on public.nfl_price_responses_v1, public.nfl_price_observations_v1, public.nfl_price_collection_runs_v1 to service_role;
create index nfl_price_observations_v1_event_idx on public.nfl_price_observations_v1 ((payload->>'eventID'));
create index nfl_price_collection_runs_v1_created_idx on public.nfl_price_collection_runs_v1 (created_at desc);
comment on table public.nfl_price_observations_v1 is 'Append-only exact paired NFL price evidence. Collection is not model validation or PLAY approval.';
