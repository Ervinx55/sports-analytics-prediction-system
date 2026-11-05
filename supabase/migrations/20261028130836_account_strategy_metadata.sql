-- Optional version 1 strategy metadata. No policy, grants, or historical-row changes.
-- Replace the validator in place so existing table constraints use the new contract.
create or replace function private_accounts.valid_payload(p jsonb,kind text) returns boolean language plpgsql immutable security invoker set search_path='' as $$
 declare keys text[]; k text; s text; stake numeric; payout numeric; metadata jsonb;
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
 if p ? 'strategyMetadata' then
 metadata:=p->'strategyMetadata';
 if jsonb_typeof(metadata) is distinct from 'object' or metadata->'version' is distinct from '1'::jsonb or not coalesce(metadata->>'strategy' in ('unclassified','value','matched','arbitrage','specialization'),false) then return false;end if;
 for k in select jsonb_object_keys(metadata) loop
 if not k=any(array['version','strategy','league','market','calculationRef','assignment']) then return false;end if;
 if k=any(array['league','market','calculationRef']) and (jsonb_typeof(metadata->k) is distinct from 'string' or not private_accounts.identifier(metadata->>k)) then return false;end if;
 end loop;
 if metadata ? 'assignment' and metadata->>'assignment' is distinct from 'entry' then return false;end if;
 p:=p-'strategyMetadata';
 end if;
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

