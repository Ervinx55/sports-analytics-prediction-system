-- CFB research stays separate from approved LIVE prediction contracts.
create table if not exists public.cfb_research_documents (
 doc_key text primary key check(length(doc_key)<=200), body jsonb not null,
 updated_at timestamptz not null default now()
);
create table if not exists public.cfb_prospective_forecasts (
 event_id text not null, model_version text not null,
 captured_at timestamptz not null default now(), starts_at timestamptz not null,
 forecast jsonb not null, input_hash text not null,
 primary key(event_id,model_version),
 check(starts_at-captured_at between interval '30 minutes' and interval '24 hours'),
 check((forecast->>'productionEligible')::boolean is false),
 check((forecast->>'homeProbability')::numeric > 0 and (forecast->>'homeProbability')::numeric < 1)
);
create table if not exists public.cfb_outcome_revisions (
 event_id text not null, evidence_hash text not null,
 recorded_at timestamptz not null default now(), outcome jsonb not null,
 primary key(event_id,evidence_hash)
);
alter table public.cfb_research_documents enable row level security;
alter table public.cfb_prospective_forecasts enable row level security;
alter table public.cfb_outcome_revisions enable row level security;
revoke all on public.cfb_research_documents,public.cfb_prospective_forecasts,public.cfb_outcome_revisions from public,anon,authenticated;
grant select,insert,update,delete on public.cfb_research_documents to service_role;
grant select,insert on public.cfb_prospective_forecasts,public.cfb_outcome_revisions to service_role;
create index if not exists cfb_forecast_start_idx on public.cfb_prospective_forecasts(starts_at desc);
create index if not exists cfb_outcome_time_idx on public.cfb_outcome_revisions(event_id,recorded_at desc);

create or replace function public.cfb_reject_evidence_mutation() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin raise exception 'CFB evidence is immutable; append corrections separately'; end; $$;
revoke all on function public.cfb_reject_evidence_mutation() from public,anon,authenticated;
create trigger cfb_forecast_immutable before update or delete on public.cfb_prospective_forecasts for each row execute function public.cfb_reject_evidence_mutation();
create trigger cfb_outcome_immutable before update or delete on public.cfb_outcome_revisions for each row execute function public.cfb_reject_evidence_mutation();

create or replace function public.claim_cfb_collection(p_token text) returns boolean language sql
set search_path=pg_catalog,public as $$
 with claimed as (
 insert into public.cfb_research_documents(doc_key,body,updated_at)
 values('_collection_lease',jsonb_build_object('token',p_token),now())
 on conflict(doc_key) do update set body=excluded.body,updated_at=excluded.updated_at
 where cfb_research_documents.updated_at < now()-interval '90 seconds'
 returning 1
 ) select exists(select 1 from claimed);
$$;
revoke all on function public.claim_cfb_collection(text) from public,anon,authenticated;
grant execute on function public.claim_cfb_collection(text) to service_role;
