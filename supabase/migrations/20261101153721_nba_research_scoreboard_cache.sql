-- Durable handoff: pg_net must finish the invoking HTTP request before nested work is consumed.
create table public.nba_research_scoreboards (
 scoreboard_date text primary key check (scoreboard_date ~ '^[0-9]{8}$'),
 request_id bigint, requested_at timestamptz,
 body jsonb, received_at timestamptz,
 check (body is null or jsonb_typeof(body->'events')='array')
);
alter table public.nba_research_scoreboards enable row level security;
revoke all on public.nba_research_scoreboards from public,anon,authenticated;
grant select,insert,update on public.nba_research_scoreboards to service_role;
