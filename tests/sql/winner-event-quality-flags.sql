-- Run the whole file after the quality migration. All synthetic fixtures roll back.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
create temporary table winner_quality_results(check_name text primary key,passed boolean not null) on commit drop;
create function pg_temp.quality_expect_rejection(statement text,expected text) returns void language plpgsql as $$
declare message text; failed boolean:=false;
begin
 begin execute statement;
 exception when others then
  get stacked diagnostics message=message_text;
  if position(expected in message)=0 then raise exception 'Unexpected rejection: %, expected %',message,expected; end if;
  failed:=true;
 end;
 if not failed then raise exception 'Expected rejection did not occur: %',expected; end if;
end;
$$;

do $$
#variable_conflict use_variable
declare
 at_time timestamptz:=clock_timestamp();
 start_time timestamptz:=(date_trunc('day',clock_timestamp() at time zone 'America/New_York') at time zone 'America/New_York')+interval '1 day 13 hours';
 tag text:='__winner_quality_'||txid_current();
 model_hash text:=repeat(md5('__winner_quality_model_'||txid_current()),2);
 model_two text:=repeat(md5('__winner_quality_model_two_'||txid_current()),2);
 schedule_hash text:=repeat(md5('__winner_quality_schedule_'||txid_current()),2);
 provider_hash text:=repeat(md5('__winner_quality_provider_'||txid_current()),2);
 input_hash text:=repeat(md5('__winner_quality_input_'||txid_current()),2);
 version text:='SYNTHETIC_QUALITY_ROLLBACK_ONLY';
 event text; manifest jsonb; identity_doc jsonb; forecast_doc jsonb; candidate jsonb;
 sources jsonb; forecasts jsonb:='[]'; conflict_doc jsonb; status_doc jsonb; changed jsonb;
 before_cohort jsonb; after_cohort jsonb; saved_forecast jsonb; saved_flag jsonb;
 result_doc jsonb; count_value integer; privilege_name text; role_name text; rejected boolean;
begin
 select value into before_cohort from jsonb_array_elements(public.winner_research_status()->'cohorts') where value->>'sport'='NFL' and value->>'capture_window'='EARLY';
 manifest:=jsonb_build_object('sport','NFL','modelVersion',version,'manifestHash',model_hash,'productionWeight',0,'productionEligible',false,'fixture',true);
 sources:=jsonb_build_array(
  jsonb_build_object('source_hash',schedule_hash,'source_url','https://example.invalid/quality-schedule','fetched_at',at_time-interval '1 minute','body',jsonb_build_object('fixture',tag)),
  jsonb_build_object('source_hash',provider_hash,'source_url','https://example.invalid/quality-provider','fetched_at',at_time-interval '30 seconds','body',jsonb_build_object('fixture',tag)),
  jsonb_build_object('source_hash',input_hash,'source_url','urn:edge-lab:winner-inputs','fetched_at',at_time-interval '10 seconds','body',jsonb_build_object('fixture',tag)));
 foreach event in array array['nflverse:'||tag,'nflverse:'||tag||'_clean'] loop
  identity_doc:=jsonb_build_object('eventID',event,'startsAt',start_time,'home',jsonb_build_object('id','fixture-home','abbreviation','FIXH'),'away',jsonb_build_object('id','fixture-away','abbreviation','FIXA'),'sourceIds',jsonb_build_object('nflverse',tag));
  forecast_doc:=jsonb_build_object('sport','NFL','eventID',event,'identity',identity_doc,'manifestHash',model_hash,'issuedAt',at_time,'startsAt',start_time,'homeProbability',0.6,'awayProbability',0.4,'productionEligible',false,'productionWeight',0,'fullFeatureEligible',false,'lineupVerified',false,'quoteComparisonEligible',true,'fixture',true);
  candidate:=jsonb_build_object('sport','NFL','event_id',event,'model_hash',model_hash,'model_version',version,'starts_at',start_time,'input_hash',input_hash,'forecast',forecast_doc);
  forecasts:=forecasts||jsonb_build_array(candidate);
 end loop;
 conflict_doc:=jsonb_build_object('sport','NFL','eventID','nflverse:'||tag,'sourceEventId','fixture-sgo-'||tag,'reason','SCHEDULE_SOURCE_CONFLICT','home','FIXH','away','FIXA',
  'scheduleStartsAt',start_time,'providerStartsAt',start_time+interval '3 hours','scheduleSourceHash',schedule_hash,'providerSourceHash',provider_hash,
  'scheduleSourceFetchedAt',at_time-interval '1 minute','providerSourceFetchedAt',at_time-interval '30 seconds');
 status_doc:=jsonb_build_object('coverage',jsonb_build_object('scheduleSourceConflicts',jsonb_build_array(conflict_doc)));
 result_doc:=public.winner_research_append(jsonb_build_array(jsonb_build_object('model_hash',model_hash,'sport','NFL','model_version',version,'manifest',manifest)),sources,forecasts,'[]',status_doc);
 if result_doc->>'captured' is distinct from '2' then raise exception 'Fixture enrollment failed'; end if;
 select evidence into saved_flag from public.winner_event_quality_flags q where q.event_id='nflverse:'||tag;
 if saved_flag is distinct from conflict_doc then raise exception 'Flag did not retain exact evidence'; end if;
 select forecast into saved_forecast from public.winner_prospective_forecasts f where f.event_id='nflverse:'||tag;
 insert into winner_quality_results values('state trigger persists exact conflict and source receipts',true);

 perform public.winner_research_append(p_status=>status_doc);
 perform public.winner_research_append(p_status=>'{}'::jsonb||jsonb_build_object('coverage',jsonb_build_object('scheduleSourceConflicts','[]'::jsonb)));
 perform public.winner_research_append(p_status=>' {"sourceErrors":["SOURCE_UNAVAILABLE"]}'::jsonb);
 select count(*) into count_value from public.winner_event_quality_flags q where q.event_id='nflverse:'||tag;
 if count_value<>1 or not exists(select 1 from public.winner_event_quality_flags q where q.event_id='nflverse:'||tag and evidence=saved_flag) then raise exception 'Repeated or empty coverage changed durable flag'; end if;
 if not exists(select 1 from public.winner_prospective_forecasts f where f.event_id='nflverse:'||tag and forecast=saved_forecast) then raise exception 'Capture was rewritten'; end if;
 select value into after_cohort from jsonb_array_elements(public.winner_research_status()->'cohorts') where value->>'sport'='NFL' and value->>'capture_window'='EARLY';
 if (after_cohort->>'games')::int<>coalesce((before_cohort->>'games')::int,0)+2
  or (after_cohort->>'eligible_games')::int<>coalesce((before_cohort->>'eligible_games')::int,0)+1
  or (after_cohort->>'quarantined_games')::int<>coalesce((before_cohort->>'quarantined_games')::int,0)+1
  or (after_cohort->>'paired_prices')::int<>coalesce((before_cohort->>'paired_prices')::int,0)+1
  or (after_cohort->>'awaiting_outcome')::int<>coalesce((before_cohort->>'awaiting_outcome')::int,0)+1 then raise exception 'Status includes quarantined event in eligible metrics'; end if;
 insert into winner_quality_results values('quarantine survives repeated, empty and unavailable coverage; metrics exclude it',true);

 manifest:=jsonb_set(manifest,'{manifestHash}',to_jsonb(model_two));
 candidate:=forecasts->0;
 candidate:=jsonb_set(jsonb_set(candidate,'{model_hash}',to_jsonb(model_two)),'{forecast,manifestHash}',to_jsonb(model_two));
 result_doc:=public.winner_research_append(jsonb_build_array(jsonb_build_object('model_hash',model_two,'sport','NFL','model_version',version,'manifest',manifest)),'[]',jsonb_build_array(candidate));
 if result_doc->>'captured' is distinct from '0' then raise exception 'Quarantined event captured after source outage'; end if;
 if exists(select 1 from public.winner_prospective_forecasts f where f.model_hash=model_two) then raise exception 'Quarantine insert guard failed'; end if;
 insert into winner_quality_results values('known quarantine blocks later capture independently of current sources',true);

 changed:=conflict_doc||jsonb_build_object('eventID','nflverse:'||tag||'_missing_receipt','providerSourceFetchedAt',at_time-interval '20 seconds');
 perform pg_temp.quality_expect_rejection(format('select public.winner_research_append(p_status=>%L::jsonb)',jsonb_build_object('coverage',jsonb_build_object('scheduleSourceConflicts',jsonb_build_array(changed)))),'violates foreign key constraint');
 changed:=conflict_doc-'eventID';
 perform pg_temp.quality_expect_rejection(format('select public.winner_research_append(p_status=>%L::jsonb)',jsonb_build_object('coverage',jsonb_build_object('scheduleSourceConflicts',jsonb_build_array(changed)))),'null value');
 changed:=conflict_doc||jsonb_build_object('eventID','nflverse:'||tag||'_same_time','providerStartsAt',start_time);
 perform pg_temp.quality_expect_rejection(format('select public.winner_research_append(p_status=>%L::jsonb)',jsonb_build_object('coverage',jsonb_build_object('scheduleSourceConflicts',jsonb_build_array(changed)))),'violates check constraint');
 perform pg_temp.quality_expect_rejection('select public.winner_research_append(p_status=>''{"coverage":{"scheduleSourceConflicts":null}}'')','Invalid winner schedule conflict batch');
 insert into winner_quality_results values('missing exact receipt, missing identity, equal times and invalid batch reject',true);

 perform pg_temp.quality_expect_rejection(format('update public.winner_event_quality_flags set reason=reason where event_id=%L','nflverse:'||tag),'append-only');
 perform pg_temp.quality_expect_rejection(format('delete from public.winner_event_quality_flags where event_id=%L','nflverse:'||tag),'append-only');
 if not exists(select 1 from pg_class where oid='public.winner_event_quality_flags'::regclass and relrowsecurity) then raise exception 'Quality RLS disabled'; end if;
 foreach role_name in array array['anon','authenticated'] loop
  foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
   if has_table_privilege(role_name,'public.winner_event_quality_flags',privilege_name) then raise exception 'Unexpected % grant for %',privilege_name,role_name; end if;
  end loop;
 end loop;
 foreach privilege_name in array array['UPDATE','DELETE','TRUNCATE'] loop
  if has_table_privilege('service_role','public.winner_event_quality_flags',privilege_name) then raise exception 'Unexpected service mutation grant: %',privilege_name; end if;
 end loop;
 insert into winner_quality_results values('evidence immutable with private RLS and least-privilege grants',true);

 foreach role_name in array array['anon','authenticated'] loop
  execute format('set local role %I',role_name);
  rejected:=false;
  begin execute 'select count(*) from public.winner_event_quality_flags'; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Unauthorized role read quality flags'; end if;
  rejected:=false;
  begin execute 'insert into public.winner_event_quality_flags(sport) values (''NFL'')'; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Unauthorized role inserted quality flags'; end if;
  reset role;
 end loop;
 insert into winner_quality_results values('anonymous and authenticated actual reads/inserts denied',true);
end;
$$;
select * from winner_quality_results order by check_name;
rollback;
