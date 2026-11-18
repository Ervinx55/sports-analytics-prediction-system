-- Synthetic fixtures only; run the whole transaction and always roll back.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
create temporary table study_results(check_name text primary key,passed boolean not null) on commit drop;
create function pg_temp.study_reject(statement text, expected text) returns void language plpgsql as $$
declare denied boolean:=false;
begin
 begin execute statement;
 exception when others then
  if position(expected in sqlerrm)=0 then raise exception 'Unexpected rejection: %, expected %',sqlerrm,expected; end if;
  denied:=true;
 end;
 if not denied then raise exception 'Expected rejection: %',expected; end if;
end;
$$;
do $$
#variable_conflict use_variable
declare
 tag text:='__study_'||txid_current(); policy_text text; policy_hash text;
 sport_name text; market_name text; model_hash text; doc jsonb; body text;
 requests jsonb:='[]'; changed jsonb; result_doc jsonb; audit jsonb;
 baseline text; stored text; n integer; before_time timestamptz:=clock_timestamp();
begin
 perform 1 from public.winner_validation_study_requests limit 1;
 select md5(coalesce(string_agg(to_jsonb(f)::text,'' order by sport,event_id,model_hash,capture_window),'')) into baseline from public.winner_prospective_forecasts f;
 policy_text:=jsonb_build_object('id',tag,'purpose','OFFLINE_CONFIRMATION_CRITERIA_NOT_PRODUCTION_AUTHORIZATION','authority',jsonb_build_object('productionEligible',false,'productionWeight',0,'automaticPlayEnabled',false))::text;
 policy_hash:=encode(sha256(convert_to(policy_text,'UTF8')),'hex');
 foreach sport_name in array array['NBA','NFL'] loop
  model_hash:=repeat(md5(tag||sport_name),2);
  insert into public.winner_model_manifests(model_hash,sport,model_version,manifest) values(model_hash,sport_name,tag,jsonb_build_object('sport',sport_name,'modelVersion',tag,'manifestHash',model_hash,'productionEligible',false,'productionWeight',0));
  foreach market_name in array array['WINNER','SPREAD'] loop
   doc:=jsonb_build_object('studyId',tag||sport_name||market_name,'familyId',tag,'sport',sport_name,'market',market_name,'period','FULL_GAME','seasonPhase','REGULAR_SEASON','sideRule','HOME','protocolId',tag,'policyHash',policy_hash,'incumbentHash',model_hash,'familySize',4,'status','RECORDED_NOT_ENROLLING','confirmationStatus','NOT_STARTED','enrollmentEnabled',false,'registration',null,'productionEligible',false,'productionWeight',0,'automaticPlayEnabled',false,'blockers',jsonb_build_array('FIXTURE_NOT_ELIGIBLE'));
   body:=doc::text;
   requests:=requests||jsonb_build_array(jsonb_build_object('request_body',body,'request_hash',encode(sha256(convert_to(body,'UTF8')),'hex')));
  end loop;
 end loop;
 result_doc:=public.winner_record_study_requests(policy_text,policy_hash,requests);
 if result_doc->>'recorded'<>'4' or result_doc->>'enrollmentEnabled'<>'false' or result_doc->'registration' is distinct from 'null'::jsonb then raise exception 'Study receipts not pending'; end if;
 select count(*) into n from public.winner_validation_study_requests where family_id=tag and recorded_at>=before_time and recorded_at<=clock_timestamp();
 if n<>4 then raise exception 'Server receipts missing'; end if;
 result_doc:=public.winner_record_study_requests(policy_text,policy_hash,requests);
 if result_doc->>'recorded'<>'0' then raise exception 'Replay not idempotent'; end if;
 insert into study_results values('four private pending receipts; server clock; idempotent replay',true);
 perform pg_temp.study_reject(format('select public.winner_record_study_requests(%L,%L,%L::jsonb)',policy_text,policy_hash,requests-3),'Expected exactly four pending studies');
 changed:=jsonb_set(requests,'{1}',requests->0);
 perform pg_temp.study_reject(format('select public.winner_record_study_requests(%L,%L,%L::jsonb)',policy_text,policy_hash,changed),'Duplicate validation study scopes');
 changed:=jsonb_set(requests,'{0,request_hash}',to_jsonb(repeat('0',64)));
 perform pg_temp.study_reject(format('select public.winner_record_study_requests(%L,%L,%L::jsonb)',policy_text,policy_hash,changed),'Invalid pending validation study request');
 foreach doc in array array[
  ((requests->0)->>'request_body')::jsonb||'{"status":"ACTIVE","enrollmentEnabled":true}'::jsonb,
  ((requests->0)->>'request_body')::jsonb||'{"registration":{}}'::jsonb,
  ((requests->0)->>'request_body')::jsonb||'{"productionEligible":true}'::jsonb,
  ((requests->0)->>'request_body')::jsonb||jsonb_build_object('registeredAt',before_time)
 ] loop
  body:=doc::text;changed:=jsonb_set(requests,'{0}',jsonb_build_object('request_body',body,'request_hash',encode(sha256(convert_to(body,'UTF8')),'hex')));
  perform pg_temp.study_reject(format('select public.winner_record_study_requests(%L,%L,%L::jsonb)',policy_text,policy_hash,changed),'Invalid pending validation study request');
 end loop;
 insert into study_results values('bad scope/hash and fabricated enrollment/promotion/timestamps rejected',true);
 body:=((((requests->0)->>'request_body')::jsonb)||'{"note":"changed"}'::jsonb)::text;
 changed:=jsonb_set(requests,'{0}',jsonb_build_object('request_body',body,'request_hash',encode(sha256(convert_to(body,'UTF8')),'hex')));
 perform pg_temp.study_reject(format('select public.winner_record_study_requests(%L,%L,%L::jsonb)',policy_text,policy_hash,changed),'Immutable study request mismatch');
 perform pg_temp.study_reject(format('update public.winner_validation_study_requests set request_body=''{}'' where family_id=%L',tag),'append-only');
 perform pg_temp.study_reject(format('delete from public.winner_validation_study_requests where family_id=%L',tag),'append-only');
 perform pg_temp.study_reject(format('delete from public.winner_validation_policy_documents where policy_hash=%L',policy_hash),'append-only');
 insert into study_results values('policy/request receipts cannot be overwritten or deleted',true);
 audit:=jsonb_build_object('generatedAt',before_time,'action','refresh','coverage',jsonb_build_object('spreads',jsonb_build_object('fixture',true)),'excludedEvents',jsonb_build_array(jsonb_build_object('eventID',tag,'reason','FIXTURE')),'productionEligible',false,'productionWeight',0);
 perform public.winner_research_append(p_status=>audit);
 perform public.winner_research_append(p_status=>audit);
 select count(*) into n from public.winner_collection_audits where observed_at=before_time and action='refresh';
 if n<>1 then raise exception 'Collection audit not idempotent'; end if;
 perform pg_temp.study_reject(format('select public.winner_research_append(p_status=>%L::jsonb)',audit||'{"different":true}'),'Collection audit collision');
 perform pg_temp.study_reject(format('select public.winner_research_append(p_status=>%L::jsonb)',audit||jsonb_build_object('generatedAt',before_time+interval '1 day')),'violates check constraint');
 perform pg_temp.study_reject(format('update public.winner_collection_audits set payload=''{}'' where observed_at=%L',before_time),'append-only');
 insert into study_results values('collection audit retains exclusions, rejects collisions/future/mutation',true);
 foreach body in array array['winner_validation_policy_documents','winner_validation_study_requests','winner_collection_audits'] loop
  if has_table_privilege('anon','public.'||body,'SELECT') or has_table_privilege('authenticated','public.'||body,'INSERT') or has_table_privilege('service_role','public.'||body,'UPDATE') then raise exception 'Excess grants on %',body; end if;
  if not (select relrowsecurity from pg_class where oid=('public.'||body)::regclass) then raise exception 'Missing RLS on %',body; end if;
 end loop;
 if has_function_privilege('anon','public.winner_record_study_requests(text,text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.winner_record_study_requests(text,text,jsonb)','EXECUTE') then raise exception 'Registration RPC public'; end if;
 select md5(coalesce(string_agg(to_jsonb(f)::text,'' order by sport,event_id,model_hash,capture_window),'')) into stored from public.winner_prospective_forecasts f;
 if stored is distinct from baseline then raise exception 'Forecasts changed'; end if;
 insert into study_results values('RLS/private grants and original forecasts preserved',true);
end;
$$;
select * from study_results order by check_name;
rollback;
