-- Unapplied forward migration: durable service-only settlement work and disabled jobs.
-- Verified ESPN summary has no authoritative update time; retrieval is separate payload evidence.
alter table public.performance_settlements alter column source_updated_at drop not null;
create table public.performance_settlement_queue (
 prediction_id uuid primary key references public.performance_predictions(id), sport text not null,
 provider text not null, next_attempt_at timestamptz not null default now(), attempts integer not null default 0,
 lease_token uuid, lease_expires_at timestamptz, first_final_at timestamptz,
 last_error text, last_attempt_at timestamptz, last_success_at timestamptz
);
create index performance_settlement_queue_due on public.performance_settlement_queue(sport,next_attempt_at);
create table public.performance_provider_cooldowns (
 sport text not null, provider text not null, cooldown_until timestamptz not null,
 reason text not null, primary key(sport,provider)
);
alter table public.performance_settlement_queue enable row level security;
alter table public.performance_provider_cooldowns enable row level security;
revoke all on public.performance_settlement_queue,public.performance_provider_cooldowns from public,anon,authenticated;
grant select,insert,update on public.performance_settlement_queue,public.performance_provider_cooldowns to service_role;
create function public.claim_performance_settlements_v1(p_sport text,p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_sport not in ('MLB','NFL','NBA','CFB','NHL','TENNIS','SOCCER') or p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid claim';end if;
 -- A first-ever seeding race must not wait on conflicting uncommitted unique rows.
 if exists(select from public.performance_predictions p where p.sport=p_sport and (p.starts_at is null or p.starts_at<=clock_timestamp()) and not exists(select from public.performance_settlement_queue q where q.prediction_id=p.id)) then
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('performance-seed:'||p_sport,0)) then return '[]'::jsonb;end if;
 end if;
 insert into public.performance_settlement_queue(prediction_id,sport,provider,next_attempt_at)
 select id,sport,coalesce(source_ids->>'provider','unavailable'),coalesce(starts_at,now()) from public.performance_predictions
 where sport=p_sport and (starts_at is null or starts_at<=clock_timestamp())
 and not exists(select from public.performance_settlement_queue q where q.prediction_id=public.performance_predictions.id) on conflict do nothing;
 with due as (
 select q.prediction_id from public.performance_settlement_queue q
 where q.sport=p_sport and q.next_attempt_at<=clock_timestamp()
 and (q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp())
 and not exists(select from public.performance_provider_cooldowns c where c.sport=q.sport and c.provider=q.provider and c.cooldown_until>clock_timestamp())
 -- UNRESOLVED does not expire; final corrections remain due for fourteen days.
 and (q.first_final_at is null or q.first_final_at>clock_timestamp()-interval '14 days'
 or (select s.outcome from public.performance_settlements s where s.prediction_id=q.prediction_id order by revision desc limit 1)='UNRESOLVED')
 order by q.next_attempt_at,q.prediction_id for update of q skip locked limit p_limit
 ), claimed as (
 update public.performance_settlement_queue q set lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '120 seconds',last_attempt_at=clock_timestamp()
 from due where q.prediction_id=due.prediction_id returning q.*
 ) select coalesce(jsonb_agg(jsonb_build_object('prediction_id',c.prediction_id,'lease_token',c.lease_token,'prediction',p.payload)),'[]') into result
 from claimed c join public.performance_predictions p on p.id=c.prediction_id;
 return result;
end $$;
create function public.renew_performance_settlement_v1(p_prediction uuid,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare q public.performance_settlement_queue;
begin
 select * into q from public.performance_settlement_queue where prediction_id=p_prediction for update;
 if not found or q.lease_token is distinct from p_token or q.lease_expires_at<=clock_timestamp() then return false;end if;
 if exists(select from public.performance_provider_cooldowns c where c.sport=q.sport and c.provider=q.provider and c.cooldown_until>clock_timestamp()) then
 update public.performance_settlement_queue set lease_token=null,lease_expires_at=null where prediction_id=p_prediction;return false;end if;
 update public.performance_settlement_queue set lease_expires_at=clock_timestamp()+interval '120 seconds' where prediction_id=p_prediction;
 return true;
end $$;
create function public.complete_performance_settlement_v1(p_prediction uuid,p_token uuid,p_settlement jsonb default null,p_error text default null,p_cooldown_seconds integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.performance_settlement_queue; prior public.performance_settlements; s jsonb; outcome text; minutes integer; appended boolean:=false;stamp timestamptz;
begin
 select * into q from public.performance_settlement_queue where prediction_id=p_prediction for update;
 if not found or q.lease_token is distinct from p_token or q.lease_expires_at<=clock_timestamp() then return jsonb_build_object('accepted',false,'reason','LEASE_LOST');end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('settlement:'||p_prediction::text,0));
 -- Check again after a possible settlement lock wait; expired callers cannot write.
 if q.lease_expires_at<=clock_timestamp() then return jsonb_build_object('accepted',false,'reason','LEASE_LOST');end if;
 select * into prior from public.performance_settlements where prediction_id=p_prediction order by revision desc limit 1;
 if p_error is null then
  if p_settlement is null or p_settlement->>'predictionId' is distinct from p_prediction::text or p_settlement->>'outcome' not in ('WIN','LOSS','PUSH','VOID','UNRESOLVED') then raise exception 'invalid completion';end if;
  stamp:=public.performance_time_v1(p_settlement->>'sourceUpdatedAt');
  if prior.source_updated_at is not null and (stamp is null or stamp<prior.source_updated_at) then return jsonb_build_object('accepted',false,'reason','STALE_SOURCE_RESULT');end if;
  p_settlement:=p_settlement||jsonb_build_object('source',coalesce(p_settlement->>'source','unavailable'),'ruleVersion',coalesce(p_settlement->>'ruleVersion','unknown'));
  outcome:=p_settlement->>'outcome';
  -- Retrieval timestamps are not source revisions. Compare semantic evidence only.
  s:=p_settlement-'revision'-'supersedesRevision'-'settledAt'-'retrievedAt';
  if prior.id is null or s is distinct from (prior.payload-'revision'-'supersedesRevision'-'settledAt'-'retrievedAt') then
   s:=p_settlement||jsonb_build_object('revision',coalesce(prior.revision,0)+1,'supersedesRevision',prior.revision,'settledAt',clock_timestamp(),'source',coalesce(p_settlement->>'source','unavailable'),'ruleVersion',coalesce(p_settlement->>'ruleVersion','unknown'));
   perform public.append_settlement_v1(s);appended:=true;
  end if;
 else outcome:='UNRESOLVED';end if;
 minutes:=case least(q.attempts,3) when 0 then 1 when 1 then 5 when 2 then 15 else 60 end;
 if p_error is not null and p_cooldown_seconds>0 then
 insert into public.performance_provider_cooldowns values(q.sport,q.provider,clock_timestamp()+make_interval(secs=>least(p_cooldown_seconds,2592000)),left(p_error,100))
 on conflict(sport,provider) do update set cooldown_until=greatest(public.performance_provider_cooldowns.cooldown_until,excluded.cooldown_until),reason=excluded.reason;
 end if;
 update public.performance_settlement_queue set lease_token=null,lease_expires_at=null,
 attempts=case when outcome='UNRESOLVED' then attempts+1 else 0 end,
 next_attempt_at=clock_timestamp()+make_interval(mins=>case when outcome='UNRESOLVED' then minutes else 5 end),
 first_final_at=case when outcome<>'UNRESOLVED' then coalesce(first_final_at,clock_timestamp()) else first_final_at end,
 last_error=left(coalesce(p_error,p_settlement->>'reason'),100),last_success_at=case when p_error is null then clock_timestamp() else last_success_at end
 where prediction_id=p_prediction;
 return jsonb_build_object('accepted',true,'outcome',outcome,'appended',appended);
end $$;
revoke all on function public.claim_performance_settlements_v1(text,integer),public.renew_performance_settlement_v1(uuid,uuid),public.complete_performance_settlement_v1(uuid,uuid,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.claim_performance_settlements_v1(text,integer),public.renew_performance_settlement_v1(uuid,uuid),public.complete_performance_settlement_v1(uuid,uuid,jsonb,text,integer) to service_role;
-- Separate dispatcher uses a service credential, never the existing publishable-key enqueue.
create function public.dispatch_performance_job_v1(p_component text,p_body jsonb default '{}') returns bigint
language plpgsql security definer set search_path='' as $$
declare endpoint text; project_url text; service_key text;request_id bigint;dependency text;
begin
 select endpoint_path into endpoint from public.pipeline_component_registry where component_key=p_component and enabled and component_key like 'performance_%';
 if endpoint is null then return null;end if;
 if p_component like 'performance_mlb_publish_%' then
  perform public.reconcile_performance_http_v1();
  dependency:=replace(p_component,'publish','capture');
  if not exists(select from public.pipeline_component_registry r join lateral (select response_ok,responded_at,enqueued_at from public.pipeline_http_request_log l where l.component_key=r.component_key order by enqueued_at desc limit 1) h on true where r.component_key=dependency and r.enabled and h.response_ok and h.responded_at>=clock_timestamp()-interval '6 minutes' and h.enqueued_at>=clock_timestamp()-interval '6 minutes') then raise exception 'Performance capture dependency not ready';end if;
 end if;
 -- The scheduler never forces upstream refresh or quota bypass. Eligible near-game windows
 -- are evaluated by the capture source/publishers; only existing saved observations are reused.
 select decrypted_secret into project_url from vault.decrypted_secrets where name='snapshot_project_url' limit 1;
 select decrypted_secret into service_key from vault.decrypted_secrets where name='performance_service_role_key' limit 1;
 if project_url is null or service_key is null then raise exception 'Performance service credentials unavailable';end if;
 select net.http_post(url:=project_url||endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||service_key,'apikey',service_key),body:=p_body,timeout_milliseconds:=90000) into request_id;
 insert into public.pipeline_http_request_log(request_id,component_key) values(request_id,p_component);
 return request_id;
end $$;
revoke all on function public.dispatch_performance_job_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.dispatch_performance_job_v1(text,jsonb) to service_role;
-- Disabled registry entries and actual inactive cron jobs. Missing model/result adapters remain explicit.
do $$
declare sport text; kind text; key text; endpoint text;body jsonb;job_id bigint;
begin
 foreach sport in array array['MLB','NFL','NBA','CFB','NHL','TENNIS','SOCCER'] loop
  foreach kind in array array['capture_team','capture_props','settle'] loop
   key:='performance_'||lower(sport)||'_'||kind;
   endpoint:=case when kind='settle' then '/functions/v1/settle-sport-predictions' when sport='MLB' and kind='capture_props' then '/functions/v1/capture-player-props' when sport='MLB' then '/functions/v1/capture-model-audit' else '/functions/v1/capture-sport-predictions' end;
   body:=jsonb_build_object('sport',sport,'limit',100,'scheduled',true,'kind',case when sport='MLB' then case when kind='capture_props' then 'player_prop_observations' else 'market_grade_observations' end else case when kind='capture_props' then 'props' else 'team' end end);
   insert into public.pipeline_component_registry(component_key,display_name,subsystem,sport,job_name,runner_type,endpoint_path,expected_interval_minutes,stale_after_minutes,critical,enabled,notes)
   values(key,sport||' performance '||kind,'Performance',sport,replace(key,'_','-')||'-5min','HTTP',endpoint,5,12,true,false,'Default disabled. Requires verified model/source/book policy and performance_service_role_key Vault secret. ATP+WTA and all supported soccer leagues are scoped by their saved source contracts; unavailable adapters remain unresolved.') on conflict do nothing;
   if to_regprocedure('cron.schedule(text,text,text)') is not null then
    execute 'select cron.schedule($1,$2,$3)' into job_id using replace(key,'_','-')||'-5min','*/5 * * * *',format('select public.dispatch_performance_job_v1(%L,%s);',key,quote_literal(body::text)||'::jsonb'||case when kind='settle' then '' else ' || jsonb_build_object(''requestId'','||quote_literal(key)||'||'':''||floor(extract(epoch from now())/300)::text)' end);
    execute 'select cron.alter_job($1,active := false)' using job_id;
   end if;
  end loop;
 end loop;
 foreach kind in array array['team','props'] loop
  key:='performance_mlb_publish_'||kind;endpoint:=case when kind='team' then '/functions/v1/market-card' else '/functions/v1/player-prop-card' end;
  insert into public.pipeline_component_registry(component_key,display_name,subsystem,sport,job_name,runner_type,endpoint_path,expected_interval_minutes,stale_after_minutes,critical,enabled,notes)
  values(key,'MLB qualified publication '||kind,'Performance','MLB',replace(key,'_','-')||'-5min','HTTP',endpoint,5,12,true,false,'Authenticated POST after source/sharp/context refresh; final evaluator enforces bounded pregame freshness. Publication flag disabled by default. Health must verify enabled publication, zero faults and persisted tracked PLAYs.') on conflict do nothing;
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
   execute 'select cron.schedule($1,$2,$3)' into job_id using replace(key,'_','-')||'-5min','1-59/5 * * * *',format('select public.dispatch_performance_job_v1(%L);',key);
   execute 'select cron.alter_job($1,active := false)' using job_id;
  end if;
 end loop;
end $$;
-- HTTP status alone cannot establish recording/coverage/publication health.
create function public.reconcile_performance_http_v1() returns integer
language plpgsql security definer set search_path='' as $$
declare entry record;body jsonb;good boolean;counted integer:=0;
begin
 for entry in select l.request_id,l.component_key,r.status_code,r.content,r.error_msg,r.timed_out,r.created
 from public.pipeline_http_request_log l join net._http_response r on r.id=l.request_id
 where l.component_key like 'performance_%' loop
  good:=entry.status_code between 200 and 299 and not coalesce(entry.timed_out,false) and entry.error_msg is null;
  begin body:=entry.content::jsonb;exception when others then body:=null;end;
  if entry.component_key like '%_publish_%' then
   good:=good and body#>'{publication,enabled}'='true'::jsonb and body#>'{publication,faults}'='[]'::jsonb and jsonb_typeof(body->'plays')='array'
    and not exists(select from jsonb_array_elements(case when jsonb_typeof(body->'plays')='array' then body->'plays' else '[]' end) p where p#>'{tracking,tracked}' is distinct from 'true'::jsonb or nullif(p#>>'{tracking,decisionId}','') is null or nullif(p#>>'{tracking,predictionId}','') is null);
  elsif entry.component_key like '%_settle' then
   good:=good and body->'ok'='true'::jsonb and body->'faults'='[]'::jsonb and coalesce(public.performance_number_v1(body->'retries'),1)=0 and body#>>'{coverage,state}' not in ('ERROR','UNRESOLVED','DISABLED');
  else
   good:=good and body->'ok'='true'::jsonb and coalesce(body->'faults',body#>'{tracking,faults}')='[]'::jsonb
    and (body#>'{tracking,enabled}'='true'::jsonb or body#>'{coverage,complete}'='true'::jsonb);
  end if;
  update public.pipeline_http_request_log set response_ok=coalesce(good,false),reconciled_at=clock_timestamp(),responded_at=entry.created,error_msg=case when coalesce(good,false) then null else 'PERFORMANCE_RECORDING_OR_COVERAGE_FAILED' end where request_id=entry.request_id;
  counted:=counted+1;
 end loop;
 return counted;
end $$;
revoke all on function public.reconcile_performance_http_v1() from public,anon,authenticated;
grant execute on function public.reconcile_performance_http_v1() to service_role;
-- Run after generic HTTP reconciliation so semantic faults override its HTTP-only result.
do $$ declare job_id bigint;begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  execute 'select cron.schedule($1,$2,$3)' into job_id using 'performance-health-5min','*/5 * * * *','select public.reconcile_pipeline_http_requests_v1();select public.reconcile_performance_http_v1();';
  execute 'select cron.alter_job($1,active := false)' using job_id;
 end if;
end $$;
