-- No approvals are seeded. An authorized completed evaluation review is required.
create table public.nba_model_approvals_v1 (
 id uuid primary key default gen_random_uuid(),
 model_hash text not null check(model_hash ~ '^[a-f0-9]{64}$'),
 protocol_id text not null check(length(protocol_id)>0),
 status text not null check(status in ('APPROVED','REVOKED')),
 review jsonb not null,
 created_at timestamptz not null default now(),
 constraint reviewed_nba_approval_shape check(coalesce(
   length(review->>'reviewer')>0 and review->>'evaluationSha256' ~ '^[a-f0-9]{64}$'
   and review->>'settlementSha256' ~ '^[a-f0-9]{64}$'
   and review->>'variant' in ('BASELINE','MINUTES_ONLY')
   and review->>'availabilityPolicy'='OFFICIAL_AVAILABLE' and review->'minutesValidated'='true'::jsonb
   and review->'productionWeight'='1'::jsonb
   and jsonb_array_length(review->'markets')>0 and jsonb_array_length(review->'books')>0
   and (review->>'minEdge')::numeric>0 and (review->>'minEdge')::numeric<1
   and (review->>'minEv')::numeric>0 and (review->>'minEv')::numeric<10
   and isfinite((review->>'holdoutEndedAt')::timestamptz) and isfinite((review->>'expiresAt')::timestamptz)
   and (review->>'holdoutEndedAt')::timestamptz <= (review->>'reviewedAt')::timestamptz
   and (review->>'reviewedAt')::timestamptz <= (review->>'effectiveAt')::timestamptz
   and (review->>'effectiveAt')::timestamptz < (review->>'expiresAt')::timestamptz,false))
);
alter table public.nba_model_approvals_v1 enable row level security;
revoke all on public.nba_model_approvals_v1 from public,anon,authenticated,service_role;
grant select,insert,update on public.nba_model_approvals_v1 to service_role;
create function public.immutable_nba_approval_review_v1() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.id<>old.id or new.model_hash<>old.model_hash or new.protocol_id<>old.protocol_id or new.review<>old.review or new.created_at<>old.created_at or old.status='REVOKED' then raise exception 'Approval review is immutable; issue a new review';end if;
 return new;
end $$;
create trigger nba_approval_immutable before update on public.nba_model_approvals_v1 for each row execute function public.immutable_nba_approval_review_v1();
revoke all on function public.immutable_nba_approval_review_v1() from public,anon,authenticated,service_role;

create table public.nba_live_decisions_v1 (
 generation uuid not null,
 decision_id text primary key check(decision_id ~ '^[a-f0-9]{64}$'),
 identity text not null,model_hash text not null,approval_id uuid references public.nba_model_approvals_v1(id),
 decided_at timestamptz not null,starts_at timestamptz not null,valid_until timestamptz not null,payload jsonb not null
);
create index nba_live_latest_v1 on public.nba_live_decisions_v1(identity,model_hash,decided_at desc);
alter table public.nba_live_decisions_v1 enable row level security;
revoke all on public.nba_live_decisions_v1 from public,anon,authenticated,service_role;
grant select,insert on public.nba_live_decisions_v1 to service_role;

create function public.load_nba_model_approvals_v1() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(review||jsonb_build_object('id',id,'modelHash',model_hash,'protocolId',protocol_id,'status',status)),'[]')
 from public.nba_model_approvals_v1 where status='APPROVED' and (review->>'effectiveAt')::timestamptz<=now() and (review->>'expiresAt')::timestamptz>now();
$$;
revoke all on function public.load_nba_model_approvals_v1() from public,anon,authenticated,service_role;
grant execute on function public.load_nba_model_approvals_v1() to service_role;

create table public.nba_live_refresh_v1 (singleton boolean primary key default true check(singleton), generation uuid not null);
alter table public.nba_live_refresh_v1 enable row level security;
revoke all on public.nba_live_refresh_v1 from public,anon,authenticated,service_role;
grant select,insert,update on public.nba_live_refresh_v1 to service_role;
create function public.begin_nba_live_refresh_v1() returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare g uuid:=gen_random_uuid();
begin
 insert into nba_live_refresh_v1 values(true,g) on conflict(singleton) do update set generation=excluded.generation;
 return g;
end $$;
revoke all on function public.begin_nba_live_refresh_v1() from public,anon,authenticated,service_role;
grant execute on function public.begin_nba_live_refresh_v1() to service_role;

create function public.publish_nba_live_decisions_v1(p_generation uuid,p_decisions jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d jsonb;a public.nba_model_approvals_v1;n int;total int:=0;av jsonb;
begin
 perform 1 from nba_live_refresh_v1 where generation=p_generation for share;
 if not found then raise exception 'Superseded refresh';end if;
 if jsonb_typeof(p_decisions)<>'array' or jsonb_array_length(p_decisions)>500 or octet_length(p_decisions::text)>4000000 then raise exception 'Invalid batch';end if;
 for d in select value from jsonb_array_elements(p_decisions) loop
  if not coalesce(d->>'contract'='nba-reviewed-live-v1' and d->>'status' in ('PASS','PLAY') and length(d->>'identity')>0 and isfinite((d->>'issuedAt')::timestamptz) and (d->>'issuedAt')::timestamptz between now()-interval '10 minutes' and now() and (d->>'startsAt')::timestamptz>now(),false) then raise exception 'Invalid decision';end if;
  if not exists(select 1 from nba_prop_forecasts_v1 f where f.identity=d->>'identity' and f.model_hash=d->>'modelHash') then raise exception 'Unknown saved forecast';end if;
  if d->>'status'='PLAY' then
   select * into a from nba_model_approvals_v1 where id=(d->>'approvalId')::uuid for share;
   av=d->'evidence'->'availability';
   if not coalesce(a.status='APPROVED' and a.model_hash=d->>'modelHash' and a.protocol_id=d->>'validationProtocol'
    and a.review->'markets' ? (d->>'market') and a.review->'books' ? (d->>'book')
    and (a.review->>'effectiveAt')::timestamptz<=now() and (a.review->>'expiresAt')::timestamptz>now()
    and (d->>'validUntil')::timestamptz>now() and (d->>'validUntil')::timestamptz<=least((a.review->>'expiresAt')::timestamptz,(d->>'startsAt')::timestamptz,(d->>'issuedAt')::timestamptz+interval '10 minutes',(d->>'quoteAt')::timestamptz+interval '10 minutes',(d->>'oppositeQuoteAt')::timestamptz+interval '10 minutes',(av->>'publishedAt')::timestamptz+interval '90 minutes')
    and (d->>'quoteAt')::timestamptz<=now() and (d->>'oppositeQuoteAt')::timestamptz<=now()
    and av->>'status'='Available' and av->>'sourceSha256' ~ '^[a-f0-9]{64}$' and length(av->>'matchedPlayer')>0 and length(av->>'matchedTeam')>0
    and (av->>'publishedAt')::timestamptz<=now() and (av->>'retrievedAt')::timestamptz<=now()
    and d->'evidence'->>'evaluationSha256'=a.review->>'evaluationSha256' and d->'evidence'->>'settlementSha256'=a.review->>'settlementSha256'
    and (d->>'edge')::numeric>=(a.review->>'minEdge')::numeric and (d->>'ev')::numeric>=(a.review->>'minEv')::numeric
    and d->'productionEligible'='true'::jsonb and d->'productionWeight'='1'::jsonb,false) then raise exception 'PLAY approval or evidence invalid';end if;
  elsif d->'productionEligible' is distinct from 'false'::jsonb or d->'productionWeight' is distinct from '0'::jsonb then raise exception 'Invalid PASS';end if;
  insert into nba_live_decisions_v1 values(p_generation,d->>'decisionId',d->>'identity',d->>'modelHash',(d->>'approvalId')::uuid,(d->>'issuedAt')::timestamptz,(d->>'startsAt')::timestamptz,(d->>'validUntil')::timestamptz,d) on conflict do nothing;
  get diagnostics n=row_count;total:=total+n;
 end loop;
 return jsonb_build_object('inserted',total);
end $$;
revoke all on function public.publish_nba_live_decisions_v1(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.publish_nba_live_decisions_v1(uuid,jsonb) to service_role;

create function public.read_nba_live_decisions_v1() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with latest as (select distinct on(identity,model_hash) * from nba_live_decisions_v1 where starts_at>now() and decided_at>now()-interval '24 hours' order by identity,model_hash,decided_at desc,decision_id desc),
 checked as(select d.*,d.payload->>'status'='PLAY' and d.generation=(select generation from nba_live_refresh_v1 where singleton) and d.valid_until>now() and a.status='APPROVED' and a.model_hash=d.model_hash and (a.review->>'effectiveAt')::timestamptz<=now() and (a.review->>'expiresAt')::timestamptz>now() as cleared from latest d left join nba_model_approvals_v1 a on a.id=d.approval_id order by d.decided_at desc limit 500)
 select jsonb_build_object('generatedAt',now(),'contract','nba-reviewed-live-v1','decisions',coalesce(jsonb_agg((payload-'evidence')||case when coalesce(cleared,false) then '{}'::jsonb else jsonb_build_object('status','PASS','productionEligible',false,'productionWeight',0,'reason',case when payload->>'status'='PLAY' then 'Approval revoked/expired, refresh superseded, or price/decision validity expired.' else payload->>'reason' end) end),'[]')) from checked;
$$;
revoke all on function public.read_nba_live_decisions_v1() from public,anon,authenticated,service_role;
grant execute on function public.read_nba_live_decisions_v1() to service_role;

