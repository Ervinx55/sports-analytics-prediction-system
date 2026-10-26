-- Private ledger. No owner is seeded: activation requires explicit protected provisioning.
create schema private_accounts;
revoke all on schema private_accounts from public, anon;
grant usage on schema private_accounts to authenticated;
create table private_accounts.owner_config (
 singleton boolean primary key default true check(singleton),
 owner_id uuid not null unique
);
revoke all on private_accounts.owner_config from public,anon,authenticated;
alter table private_accounts.owner_config enable row level security;
create policy owner_config_read on private_accounts.owner_config for select to authenticated using(owner_id=(select auth.uid()));
grant select on private_accounts.owner_config to authenticated;

create function private_accounts.is_owner() returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private_accounts.owner_config where owner_id=(select auth.uid()))
$$;
revoke all on function private_accounts.is_owner() from public,anon;
grant execute on function private_accounts.is_owner() to authenticated;
create function private_accounts.identifier(v text) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(length(v) between 1 and 200 and v=btrim(v) and btrim(v)<>'',false)
$$;
create function private_accounts.money(v jsonb,signed boolean default false) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_typeof(v)='number' and v::text ~ '^-?[0-9]+$' and (v::text)::numeric between case when signed then -9007199254740991 else 0 end and 9007199254740991,false)
$$;
create function private_accounts.instant(v text) returns boolean language plpgsql immutable security invoker set search_path='' as $$
 begin
 return coalesce(v ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' and isfinite(v::timestamptz),false);
 exception when others then return false;end
$$;
create function private_accounts.valid_payload(p jsonb,kind text) returns boolean language plpgsql immutable security invoker set search_path='' as $$
 declare keys text[]; k text; s text; stake numeric; payout numeric;
 begin
 if jsonb_typeof(p)<>'object' or jsonb_typeof(p->'id') is distinct from 'string' or octet_length(p::text)>32768 or not private_accounts.identifier(p->>'id') then return false;end if;
 if kind='account' then
 keys:=array['id','provider','name','openingAt','openingBalanceCents','historyComplete','archived'];
 if not coalesce(jsonb_typeof(p->'name')='string' and p->>'provider' in ('prizepicks','kalshi','underdog','bovada') and length(btrim(p->>'name')) between 1 and 100 and private_accounts.instant(p->>'openingAt') and private_accounts.money(p->'openingBalanceCents',true) and jsonb_typeof(p->'historyComplete')='boolean' and p->'archived'='false'::jsonb,false) then return false;end if;
 elsif kind='movement' then
 if jsonb_typeof(p->'accountId') is distinct from 'string' then return false;end if;
 keys:=array['id','accountId','type','amountCents','occurredAt'];
 if not coalesce(private_accounts.identifier(p->>'accountId') and p->>'type' in ('deposit','withdrawal','bonus','adjustment') and private_accounts.money(p->'amountCents',p->>'type'='adjustment') and (p->>'type'='adjustment' or (p->>'amountCents')::numeric>0) and private_accounts.instant(p->>'occurredAt'),false) then return false;end if;
 elsif kind='entry' then
 if jsonb_typeof(p->'accountId') is distinct from 'string' then return false;end if;
 keys:=array['id','accountId','source','sourceId','kind','status','sport','description','placedAt','settledAt','stakeCents','returnCents','feeCents','feeIncluded','predictionId','legs','supersedes'];
 if not coalesce(private_accounts.identifier(p->>'accountId') and p->>'source' in ('manual','import') and p->>'kind' in ('cash','promo') and jsonb_typeof(p->'sport')='string' and length(p->>'sport')<=4000 and jsonb_typeof(p->'description')='string' and length(p->>'description')<=4000 and private_accounts.instant(p->>'placedAt') and private_accounts.money(p->'stakeCents') and private_accounts.money(p->'feeCents') and jsonb_typeof(p->'feeIncluded')='boolean' and jsonb_typeof(p->'legs')='array' and jsonb_array_length(p->'legs')<=100,false) then return false;end if;
 foreach k in array array['sourceId','predictionId','supersedes'] loop
 if p->k<>'null'::jsonb and (jsonb_typeof(p->k)<>'string' or not private_accounts.identifier(p->>k)) then return false;end if;
 end loop;
 if p->>'source'='import' and not private_accounts.identifier(p->>'sourceId') then return false;end if;
 s:=p->>'status';stake:=(p->>'stakeCents')::numeric;
 if s='pending' then
 if p->'settledAt'<>'null'::jsonb or p->'returnCents'<>'null'::jsonb then return false;end if;
 else
 if not coalesce(s in ('won','lost','push','void','partial') and private_accounts.instant(p->>'settledAt') and (p->>'settledAt')::timestamptz >= (p->>'placedAt')::timestamptz and private_accounts.money(p->'returnCents'),false) then return false;end if;
 payout:=(p->>'returnCents')::numeric;
 if (s='won' and payout<=stake) or (s='lost' and payout<>0) or (s in ('push','void') and payout<>stake) or (s='partial' and (payout<=0 or payout>=stake)) then return false;end if;
 end if;
 else return false;end if;
 if not p ?& keys then return false;end if;
 for k in select jsonb_object_keys(p) loop if not k=any(keys) then return false;end if;end loop;
 return true;
 exception when others then return false;end
$$;
revoke all on function private_accounts.identifier(text),private_accounts.money(jsonb,boolean),private_accounts.instant(text),private_accounts.valid_payload(jsonb,text) from public,anon;
grant execute on function private_accounts.identifier(text),private_accounts.money(jsonb,boolean),private_accounts.instant(text),private_accounts.valid_payload(jsonb,text) to authenticated;

create table private_accounts.accounts(
 owner_id uuid not null default auth.uid(), id text not null, payload jsonb not null,
 archived boolean not null default false,
 primary key(owner_id,id),check(id=payload->>'id'),check(private_accounts.valid_payload(payload,'account'))
);
create table private_accounts.entries(
 owner_id uuid not null default auth.uid(),id text not null,account_id text not null,payload jsonb not null,
 supersedes text generated always as(payload->>'supersedes') stored,
 primary key(owner_id,id),unique(owner_id,account_id,id),unique(owner_id,supersedes),
 foreign key(owner_id,account_id) references private_accounts.accounts(owner_id,id),
 foreign key(owner_id,account_id,supersedes) references private_accounts.entries(owner_id,account_id,id),
 check(id=payload->>'id' and account_id=payload->>'accountId'),check(private_accounts.valid_payload(payload,'entry'))
);
create table private_accounts.movements(
 owner_id uuid not null default auth.uid(),id text not null,account_id text not null,payload jsonb not null,
 primary key(owner_id,id),foreign key(owner_id,account_id) references private_accounts.accounts(owner_id,id),
 check(id=payload->>'id' and account_id=payload->>'accountId'),check(private_accounts.valid_payload(payload,'movement'))
);
create table private_accounts.requests(
 owner_id uuid not null default auth.uid(),id text not null,action text not null,payload jsonb not null,result jsonb not null,
 primary key(owner_id,id),check(private_accounts.identifier(id)),check(action in ('create-account','add-entry','add-movement','import','correct','archive')),
 check(octet_length(payload::text)<=1100000 and octet_length(result::text)<=1000)
);
revoke all on private_accounts.accounts, private_accounts.entries, private_accounts.movements, private_accounts.requests from public,anon,authenticated;
-- An owner must satisfy both the caller UUID and the separately provisioned allowlist.
do $$declare t text;begin foreach t in array array['accounts','entries','movements','requests'] loop
 execute format('alter table private_accounts.%I enable row level security',t);
 execute format('create policy owner_read on private_accounts.%I for select to authenticated using(owner_id=(select auth.uid()) and (select private_accounts.is_owner()))',t);
 execute format('create policy owner_insert on private_accounts.%I for insert to authenticated with check(owner_id=(select auth.uid()) and (select private_accounts.is_owner()))',t);
 execute format('grant select,insert on private_accounts.%I to authenticated',t);
 end loop;end$$;
create policy owner_archive on private_accounts.accounts for update to authenticated using(owner_id=(select auth.uid()) and (select private_accounts.is_owner())) with check(owner_id=(select auth.uid()) and (select private_accounts.is_owner()));
grant update(archived) on private_accounts.accounts to authenticated;

create function private_accounts.append_entry() returns trigger language plpgsql security invoker set search_path='' as $$
 declare previous jsonb;
 begin
 -- Serialize even direct inserts against the same account. This makes live-source uniqueness race-safe.
 perform 1 from private_accounts.accounts where owner_id=new.owner_id and id=new.account_id for update;
 if not found then raise exception 'Ledger write rejected';end if;
 if (new.payload->>'supersedes') is not null then
 select payload into previous from private_accounts.entries where owner_id=new.owner_id and account_id=new.account_id and id=(new.payload->>'supersedes');
 if not found or new.id=(new.payload->>'supersedes') or exists(select 1 from private_accounts.entries where owner_id=new.owner_id and supersedes=(new.payload->>'supersedes')) then raise exception 'Ledger write rejected';end if;
 if previous->'source' is distinct from new.payload->'source' or previous->'sourceId' is distinct from new.payload->'sourceId' or previous->'predictionId' is distinct from new.payload->'predictionId' then raise exception 'Ledger write rejected';end if;
 end if;
 if new.payload->>'sourceId' is not null and exists(
 select 1 from private_accounts.entries e where e.owner_id=new.owner_id and e.account_id=new.account_id
 and e.payload->>'source'=new.payload->>'source' and e.payload->>'sourceId'=new.payload->>'sourceId'
 and e.id is distinct from (new.payload->>'supersedes')
 and not exists(select 1 from private_accounts.entries c where c.owner_id=e.owner_id and c.supersedes=e.id)
 ) then raise exception 'Ledger write rejected';end if;
 return new;end
$$;
revoke all on function private_accounts.append_entry() from public,anon;
grant execute on function private_accounts.append_entry() to authenticated;
create trigger entries_append before insert on private_accounts.entries for each row execute function private_accounts.append_entry();

-- Invoker RPCs are the only objects required in the exposed public schema.
create function public.accounts_write(action text,request_id text,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare existing private_accounts.requests%rowtype;item jsonb;result jsonb;count_rows integer:=0;
 begin
 if not private_accounts.is_owner() then raise exception 'Access denied';end if;
 if not private_accounts.identifier(request_id) or payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>1100000 then raise exception 'Invalid request';end if;
 -- Per-owner transaction lock gives deterministic retries and serializes multi-account batches.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into existing from private_accounts.requests r where r.owner_id=auth.uid() and r.id=request_id;
 if found then
 if existing.action is distinct from action or existing.payload is distinct from payload then raise exception 'Request conflict';end if;
 return existing.result;
 end if;
 case action
 when 'create-account' then
 item:=payload->'account';insert into private_accounts.accounts(id,payload) values(item->>'id',item);count_rows:=1;
 when 'add-entry','correct' then
 item:=payload->'entry';
 if (action='correct') is distinct from (item->>'supersedes' is not null) then raise exception 'Invalid correction';end if;
 insert into private_accounts.entries(id,account_id,payload) values(item->>'id',item->>'accountId',item);count_rows:=1;
 when 'add-movement' then
 item:=payload->'movement';insert into private_accounts.movements(id,account_id,payload) values(item->>'id',item->>'accountId',item);count_rows:=1;
 when 'import' then
 if jsonb_typeof(payload->'entries') is distinct from 'array' or jsonb_array_length(payload->'entries') not between 1 and 2000 then raise exception 'Invalid import';end if;
 if exists(select 1 from jsonb_array_elements(payload->'entries') e where e->>'source' is distinct from 'import' or e->>'supersedes' is not null) then raise exception 'Invalid import';end if;
 insert into private_accounts.entries(id,account_id,payload)
 select e->>'id',e->>'accountId',e from jsonb_array_elements(payload->'entries') e;
 get diagnostics count_rows=row_count;
 when 'archive' then
 if jsonb_typeof(payload->'archived') is distinct from 'boolean' then raise exception 'Invalid archive';end if;
 update private_accounts.accounts set archived=(accounts_write.payload->>'archived')::boolean where owner_id=auth.uid() and id=accounts_write.payload->>'accountId';
 get diagnostics count_rows=row_count;if count_rows<>1 then raise exception 'Account unavailable';end if;
 else raise exception 'Unsupported action';end case;
 result:=jsonb_build_object('requestId',request_id,'action',action,'count',count_rows);
 insert into private_accounts.requests(id,action,payload,result) values(request_id,action,payload,result);
 return result;end
$$;
create function public.accounts_snapshot() returns jsonb language plpgsql security invoker set search_path='' as $$
 declare result jsonb;
 begin
 if not private_accounts.is_owner() then raise exception 'Access denied';end if;
 -- A single SQL statement sees one MVCC snapshot; refuse oversized histories rather than truncate corrections.
 with a as(select payload||jsonb_build_object('archived',archived) p from private_accounts.accounts),
 e as(select payload p from private_accounts.entries),m as(select payload p from private_accounts.movements)
 select jsonb_build_object('accounts',coalesce((select jsonb_agg(p order by p->>'id') from a),'[]'),
 'entries',coalesce((select jsonb_agg(p order by p->>'id') from e),'[]'),
 'movements',coalesce((select jsonb_agg(p order by p->>'id') from m),'[]')) into result
 where (select count(*) from a)<=100 and (select count(*) from e)<=10000 and (select count(*) from m)<=10000
 and coalesce((select sum(octet_length(p::text)) from a),0)+coalesce((select sum(octet_length(p::text)) from e),0)+coalesce((select sum(octet_length(p::text)) from m),0)<=7340032;
 if result is null or octet_length(result::text)>8388608 then raise exception 'Snapshot read limit exceeded';end if;
 return result;end
$$;
revoke all on function public.accounts_write(text,text,jsonb),public.accounts_snapshot() from public,anon;
grant execute on function public.accounts_write(text,text,jsonb),public.accounts_snapshot() to authenticated;




-- Serialize all supported appends, including direct SQL grants, before row locks.
create function private_accounts.lock_capacity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 return null;
end $$;
create function private_accounts.check_capacity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform public.accounts_snapshot();
 return null;
exception when raise_exception then
 if sqlerrm='Snapshot read limit exceeded' then
  raise exception using errcode='P0001', message='Ledger capacity exceeded';
 end if;
 raise;
end $$;
revoke all on function private_accounts.lock_capacity(),private_accounts.check_capacity() from public,anon;
grant execute on function private_accounts.lock_capacity(),private_accounts.check_capacity() to authenticated;
do $$declare t text;begin foreach t in array array['accounts','entries','movements'] loop
 execute format('create trigger capacity_lock before insert or update on private_accounts.%I for each statement execute function private_accounts.lock_capacity()',t);
 execute format('create trigger capacity_check after insert or update on private_accounts.%I for each statement execute function private_accounts.check_capacity()',t);
end loop;end$$;
