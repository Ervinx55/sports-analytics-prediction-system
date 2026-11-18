-- Durable study requests only. No confirmation enrollment or model promotion.
set lock_timeout='5s';
create table public.winner_validation_policy_documents (
 policy_hash text primary key check(policy_hash ~ '^[a-f0-9]{64}$'),
 protocol_id text not null,
 document_text text not null check(octet_length(document_text)<=100000),
 recorded_at timestamptz not null default clock_timestamp()
);
create table public.winner_validation_study_requests (
 study_id text primary key check(length(study_id) between 1 and 160),
 sport text not null check(sport in ('NBA','NFL')),
 market text not null check(market in ('WINNER','SPREAD')),
 family_id text not null check(length(family_id) between 1 and 160),
 policy_hash text not null references public.winner_validation_policy_documents(policy_hash),
 incumbent_hash text not null references public.winner_model_manifests(model_hash),
 request_body text not null check(octet_length(request_body)<=100000),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 unique(family_id,sport,market,policy_hash)
);
create table public.winner_collection_audits (
 observed_at timestamptz not null,
 action text not null check(action in ('refresh','settle')),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=2000000),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(observed_at,action),
 check(isfinite(observed_at) and observed_at<=recorded_at)
);
alter table public.winner_validation_policy_documents enable row level security;
alter table public.winner_validation_study_requests enable row level security;
alter table public.winner_collection_audits enable row level security;
revoke all on public.winner_validation_policy_documents,public.winner_validation_study_requests,public.winner_collection_audits from public,anon,authenticated,service_role;
grant select,insert on public.winner_validation_policy_documents,public.winner_validation_study_requests,public.winner_collection_audits to service_role;
create trigger winner_policy_immutable before update or delete on public.winner_validation_policy_documents for each row execute function public.winner_reject_mutation();
create trigger winner_study_request_immutable before update or delete on public.winner_validation_study_requests for each row execute function public.winner_reject_mutation();
create trigger winner_collection_audit_immutable before update or delete on public.winner_collection_audits for each row execute function public.winner_reject_mutation();

create function public.winner_validation_record_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare doc jsonb; model public.winner_model_manifests; policy public.winner_validation_policy_documents;
begin
 new.recorded_at:=clock_timestamp();
 if tg_table_name='winner_validation_policy_documents' then
  doc:=new.document_text::jsonb;
  if encode(sha256(convert_to(new.document_text,'UTF8')),'hex') is distinct from new.policy_hash
   or doc->>'id' is distinct from new.protocol_id
   or doc->>'purpose' is distinct from 'OFFLINE_CONFIRMATION_CRITERIA_NOT_PRODUCTION_AUTHORIZATION'
   or doc#>>'{authority,productionEligible}' is distinct from 'false'
   or doc#>>'{authority,productionWeight}' is distinct from '0'
   or doc#>>'{authority,automaticPlayEnabled}' is distinct from 'false'
   then raise exception 'Invalid immutable validation policy'; end if;
 elsif tg_table_name='winner_validation_study_requests' then
  doc:=new.request_body::jsonb;
  select * into strict model from public.winner_model_manifests where model_hash=new.incumbent_hash;
  select * into strict policy from public.winner_validation_policy_documents where policy_hash=new.policy_hash;
  if encode(sha256(convert_to(new.request_body,'UTF8')),'hex') is distinct from new.request_hash
   or doc->>'studyId' is distinct from new.study_id or doc->>'sport' is distinct from new.sport
   or doc->>'market' is distinct from new.market or doc->>'familyId' is distinct from new.family_id
   or doc->>'policyHash' is distinct from new.policy_hash or doc->>'protocolId' is distinct from policy.protocol_id
   or doc->>'incumbentHash' is distinct from new.incumbent_hash or model.sport is distinct from new.sport
   or doc->>'familySize' is distinct from '4' or doc->>'period' is distinct from 'FULL_GAME'
   or doc->>'seasonPhase' is distinct from 'REGULAR_SEASON' or doc->>'sideRule' is distinct from 'HOME'
   or doc->>'status' is distinct from 'RECORDED_NOT_ENROLLING'
   or doc->>'confirmationStatus' is distinct from 'NOT_STARTED' or doc->>'enrollmentEnabled' is distinct from 'false'
   or doc->'registration' is distinct from 'null'::jsonb
   or doc->>'productionEligible' is distinct from 'false' or doc->>'productionWeight' is distinct from '0'
   or doc->>'automaticPlayEnabled' is distinct from 'false'
   or doc ? 'registeredAt' or doc ? 'createdAt'
   or jsonb_typeof(doc->'blockers') is distinct from 'array' or jsonb_array_length(doc->'blockers') not between 1 and 40
   or model.manifest->>'productionEligible' is distinct from 'false' or model.manifest->>'productionWeight' is distinct from '0'
   then raise exception 'Invalid pending validation study request'; end if;
 else
  if new.payload->>'generatedAt' is null or (new.payload->>'generatedAt')::timestamptz is distinct from new.observed_at
   or new.payload->>'action' is distinct from new.action
   or new.payload->>'productionEligible' is distinct from 'false' or new.payload->>'productionWeight' is distinct from '0'
   or new.payload_hash is distinct from encode(sha256(convert_to(new.payload::text,'UTF8')),'hex')
   then raise exception 'Invalid collection audit'; end if;
 end if;
 return new;
end;
$$;
revoke all on function public.winner_validation_record_guard() from public,anon,authenticated;
create trigger winner_policy_clock before insert on public.winner_validation_policy_documents for each row execute function public.winner_validation_record_guard();
create trigger winner_study_request_clock before insert on public.winner_validation_study_requests for each row execute function public.winner_validation_record_guard();
create trigger winner_collection_audit_clock before insert on public.winner_collection_audits for each row execute function public.winner_validation_record_guard();

create function public.winner_record_study_requests(p_policy_text text,p_policy_hash text,p_requests jsonb) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare row jsonb; doc jsonb; inserted integer:=0; n integer; family text; receipts jsonb;
begin
 if jsonb_typeof(p_requests) is distinct from 'array' or jsonb_array_length(p_requests)<>4 then raise exception 'Expected exactly four pending studies'; end if;
 if (select count(distinct (((value->>'request_body')::jsonb->>'sport')||':'||((value->>'request_body')::jsonb->>'market'))) from jsonb_array_elements(p_requests))<>4 then raise exception 'Duplicate validation study scopes'; end if;
 family:=((p_requests->0)->>'request_body')::jsonb->>'familyId';
 insert into public.winner_validation_policy_documents(policy_hash,protocol_id,document_text)
 values(p_policy_hash,p_policy_text::jsonb->>'id',p_policy_text) on conflict do nothing;
 if not exists(select 1 from public.winner_validation_policy_documents where policy_hash=p_policy_hash and document_text=p_policy_text) then raise exception 'Validation policy collision'; end if;
 for row in select value from jsonb_array_elements(p_requests) loop
  doc:=(row->>'request_body')::jsonb;
  if doc->>'policyHash' is distinct from p_policy_hash or doc->>'familyId' is distinct from family then raise exception 'Validation study family mismatch'; end if;
  insert into public.winner_validation_study_requests(study_id,sport,market,family_id,policy_hash,incumbent_hash,request_body,request_hash)
  values(doc->>'studyId',doc->>'sport',doc->>'market',family,p_policy_hash,doc->>'incumbentHash',row->>'request_body',row->>'request_hash') on conflict do nothing;
  get diagnostics n=row_count; inserted:=inserted+n;
  if not exists(select 1 from public.winner_validation_study_requests where study_id=doc->>'studyId' and request_body=row->>'request_body' and request_hash=row->>'request_hash') then raise exception 'Immutable study request mismatch'; end if;
 end loop;
 select jsonb_agg(jsonb_build_object('studyId',study_id,'requestHash',request_hash,'recordedAt',recorded_at,'status','RECORDED_NOT_ENROLLING','confirmationStatus','NOT_STARTED','enrollmentEnabled',false)) into receipts from public.winner_validation_study_requests where family_id=family and policy_hash=p_policy_hash;
 return jsonb_build_object('recorded',inserted,'receipts',receipts,'registration',null,'enrollmentEnabled',false,'productionEligible',false,'productionWeight',0);
end;
$$;
revoke all on function public.winner_record_study_requests(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.winner_record_study_requests(text,text,jsonb) to service_role;

create function public.winner_archive_collection_status() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare hash text; observed timestamptz;
begin
 -- Legacy partial diagnostic updates are not actual collection receipts.
 if not (new.payload ? 'generatedAt') and not (new.payload ? 'action') then return new; end if;
 observed:=(new.payload->>'generatedAt')::timestamptz;
 hash:=encode(sha256(convert_to(new.payload::text,'UTF8')),'hex');
 insert into public.winner_collection_audits(observed_at,action,payload_hash,payload)
 values(observed,new.payload->>'action',hash,new.payload) on conflict do nothing;
 if not exists(select 1 from public.winner_collection_audits where observed_at=observed and action=new.payload->>'action' and payload_hash=hash and payload=new.payload) then raise exception 'Collection audit collision'; end if;
 return new;
end;
$$;
revoke all on function public.winner_archive_collection_status() from public,anon,authenticated;
create trigger winner_state_collection_audit after insert or update of payload on public.winner_research_state for each row execute function public.winner_archive_collection_status();

create function public.winner_validation_study_status() returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('basis','REQUESTS_ONLY_NO_CONFIRMATION_ENROLLMENT','studies',coalesce(jsonb_agg(jsonb_build_object(
 'studyId',study_id,'sport',sport,'market',market,'recordedAt',recorded_at,'policyHash',policy_hash,'incumbentHash',incumbent_hash,
 'status','RECORDED_NOT_ENROLLING','confirmationStatus','NOT_STARTED','enrollmentEnabled',false,'registration',null,
 'blockers',(select coalesce(jsonb_agg(case when jsonb_typeof(b)='object' then b->'code' else b end),'[]') from jsonb_array_elements(request_body::jsonb->'blockers') b))),'[]')) from (select * from public.winner_validation_study_requests order by recorded_at desc,study_id limit 4) s;
$$;
revoke all on function public.winner_validation_study_status() from public,anon,authenticated;
grant execute on function public.winner_validation_study_status() to service_role;
create or replace function public.winner_research_status() returns jsonb language sql stable set search_path=pg_catalog,public as $$
 with latest as (select distinct on(sport,event_id) sport,event_id,outcome from public.winner_outcome_revisions order by sport,event_id,observed_at desc,recorded_at desc,evidence_hash),
 flagged as (select distinct sport,event_id from public.winner_event_quality_flags),
 readiness_latest as (
  select distinct on (r.sport,r.event_id,r.model_hash) r.*
  from public.winner_readiness_observations r
  where r.starts_at>clock_timestamp() and r.captured_at>clock_timestamp()-interval '7 days'
   and not exists(select 1 from flagged q where q.sport=r.sport and q.event_id=r.event_id)
  order by r.sport,r.event_id,r.model_hash,r.issued_at desc,r.captured_at desc,r.input_hash
 ), readiness_events as (
  select sport,event_id,starts_at,issued_at as observed_at,captured_at as recorded_at,issued_at,capture_window,
   issued_at<=clock_timestamp() and clock_timestamp()-issued_at<=interval '15 minutes' as observation_fresh,
   forecast->>'lineupVerified'='true' as lineup_verified_at_observation,
   forecast#>>'{lineup,status}' as lineup_status,forecast#>>'{lineup,reason}' as lineup_reason,
   forecast->>'quoteComparisonEligible'='true' as paired_prices_at_observation,
   jsonb_array_length(coalesce(forecast#>'{quoteComparison,pairs}','[]')) as pair_count,
   coalesce(forecast#>'{quoteComparison,reasons}','[]') as price_reasons
  from readiness_latest order by starts_at,sport,event_id limit 100
 ), report as (
 select f.sport,f.capture_window,count(*) as forecast_rows,count(distinct coalesce(r.base_event_id,f.event_id)) as games,
 count(distinct coalesce(r.base_event_id,f.event_id)) filter(where q.event_id is null) as eligible_games,
 count(distinct f.event_id) filter(where q.event_id is not null) as quarantined_games,
 count(distinct r.base_event_id) filter(where q.event_id is null) as schedule_resolved_games,
 count(*) filter(where q.event_id is null and f.forecast->>'lineupVerified'='true') as lineup_verified,
 count(*) filter(where q.event_id is null and f.forecast->>'quoteComparisonEligible'='true') as paired_prices,
 count(*) filter(where q.event_id is null and o.outcome->>'status'='FINAL') as final_results,
 count(*) filter(where q.event_id is null and o.outcome->>'status'='TIE') as ties,
 count(*) filter(where q.event_id is null and o.event_id is null) as awaiting_outcome
 from public.winner_prospective_forecasts f left join latest o using(sport,event_id) left join flagged q using(sport,event_id)
 left join public.winner_official_schedule_revisions r on r.event_id=f.event_id and r.sport=f.sport
 group by f.sport,f.capture_window
 ) select jsonb_build_object('status','RESEARCH_NOT_CLEARED','productionWeight',0,'productionEligible',false,
 'quarantined_games',(select count(*) from flagged q where exists(select 1 from public.winner_prospective_forecasts f where f.sport=q.sport and f.event_id=q.event_id)),
 'quality_flagged_events',(select count(*) from flagged),'schedule_resolutions',(select count(*) from public.winner_event_quality_resolutions),
 'validationStudies',public.winner_validation_study_status(),
 'readiness',jsonb_build_object('basis','LATEST_PREGAME_OBSERVATION_NOT_ORIGINAL_FORECAST','maxAgeSeconds',900,'events',coalesce((select jsonb_agg(to_jsonb(readiness_events)) from readiness_events),'[]')),
 'cohorts',coalesce((select jsonb_agg(to_jsonb(report)) from report),'[]'),
 'latest',(select payload from public.winner_research_state where id='latest'));
$$;
reset lock_timeout;
