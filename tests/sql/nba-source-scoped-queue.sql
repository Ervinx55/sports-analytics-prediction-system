-- Synthetic fixtures and temporary queue timestamps roll back together.
begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
create temporary table queue_checks(check_name text,passed boolean) on commit drop;
do $$
declare tag text:='__queue_'||txid_current(); result jsonb; n integer; rejected boolean:=false;
begin
 perform 1 from public.nba_prop_collector_v1 where id=1 for update;
 update public.nba_prop_collector_v1 set lease_until=null where id=1;
 update public.nba_prop_observations_v1 set last_attempt_at=now() where starts_at<now() and starts_at>now()-interval '30 days';
 insert into public.nba_prop_observations_v1(identity,payload,starts_at,last_attempt_at) values
 (tag||'_legacy',jsonb_build_object('identity',tag||'_legacy','context','{}'::jsonb),now()-interval '20 days','-infinity'),
 (tag||'_sgo1',jsonb_build_object('identity',tag||'_sgo1','context',jsonb_build_object('sourceContract','sgo-nba-v1')),now()-interval '20 days','-infinity'),
 (tag||'_sgo2',jsonb_build_object('identity',tag||'_sgo2','context',jsonb_build_object('sourceContract','sgo-nba-v1')),now()-interval '19 days','-infinity'),
 (tag||'_future',jsonb_build_object('identity',tag||'_future','context',jsonb_build_object('sourceContract','sgo-nba-v1')),now()+interval '1 day','-infinity');
 result:=public.claim_nba_prop_run_v2('sgo-nba-v1');
 if result#>>'{pending,0,identity}'<>tag||'_sgo1' or exists(select 1 from jsonb_array_elements(result->'pending') r where r#>>'{context,sourceContract}' is distinct from 'sgo-nba-v1') then raise exception 'SGO source/date isolation failed';end if;
 if exists(select 1 from public.nba_prop_observations_v1 where identity=tag||'_legacy' and last_attempt_at<>'-infinity'::timestamptz) then raise exception 'Legacy attempt was changed';end if;
 insert into queue_checks values('SGO queue preserves incompatible observations',true);
 if public.claim_nba_prop_run_v2('sgo-nba-v1') is not null then raise exception 'Lease exclusion failed';end if;
 insert into queue_checks values('Shared lease prevents concurrent processing',true);
 update public.nba_prop_collector_v1 set lease_until=null where id=1;
 result:=public.claim_nba_prop_run_v2('sgo-nba-v1');
 if result#>>'{pending,0,identity}'<>tag||'_sgo2' then raise exception 'Date fairness failed';end if;
 insert into queue_checks values('Unattempted eligible dates rotate first',true);
 update public.nba_prop_collector_v1 set lease_until=null where id=1;
 result:=public.claim_nba_prop_run_v2('legacy');
 if result#>>'{pending,0,identity}'<>tag||'_legacy' or exists(select 1 from jsonb_array_elements(result->'pending') r where r#>>'{context,sourceContract}' is not null) then raise exception 'Legacy isolation failed';end if;
 insert into queue_checks values('Legacy queue remains available',true);
 begin perform public.claim_nba_prop_run_v2('unknown');exception when others then rejected:=sqlerrm='UNSUPPORTED_NBA_SOURCE_CONTRACT';end;
 if not rejected then raise exception 'Unknown source accepted';end if;
 if has_function_privilege('anon','public.claim_nba_prop_run_v2(text)','EXECUTE') or has_function_privilege('authenticated','public.claim_nba_prop_run_v2(text)','EXECUTE') or not has_function_privilege('service_role','public.claim_nba_prop_run_v2(text)','EXECUTE') then raise exception 'Queue privilege failure';end if;
 insert into queue_checks values('Unknown source and public access rejected',true);
end $$;
select * from queue_checks;
rollback;
