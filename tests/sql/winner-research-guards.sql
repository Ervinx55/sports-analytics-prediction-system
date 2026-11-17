-- Execute this entire file as one transaction after the winner migration.
-- Every row is synthetic and rolled back. Never execute individual seed sections.
-- The brief trigger disable is transaction-local and takes a table lock; it only
-- simulates an already-enrolled historical forecast for positive outcome tests.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
create temporary table winner_guard_results(check_name text primary key,passed boolean not null) on commit drop;

create function pg_temp.winner_expect_rejection(statement text,expected text) returns void
language plpgsql as $$
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
 tag text:='__winner_guard_'||txid_current();
 model_hash text:=repeat(md5('__winner_guard_model_'||txid_current()),2);
 input_hash text:=repeat(md5('__winner_guard_input_'||txid_current()),2);
 old_input_hash text:=repeat(md5('__winner_guard_old_input_'||txid_current()),2);
 final_hash text:=repeat(md5('__winner_guard_final_'||txid_current()),2);
 evidence_hash text:=repeat(md5('__winner_guard_outcome_'||txid_current()),2);
 later_hash text:=repeat(md5('__winner_guard_later_'||txid_current()),2);
 version text:='SYNTHETIC_ROLLBACK_ONLY';
 manifest jsonb; identity_doc jsonb; forecast_doc jsonb; candidate jsonb;
 old_identity jsonb; old_forecast jsonb; old_candidate jsonb;
 source_doc jsonb; final_doc jsonb; outcome_doc jsonb; outcome_row jsonb;
 changed jsonb; result_doc jsonb; table_name text; privilege_name text;
 count_value integer; stored_time timestamptz;
begin
 manifest:=jsonb_build_object('sport','NBA','modelVersion',version,'manifestHash',model_hash,
  'productionWeight',0,'productionEligible',false,'fixture',true);
 identity_doc:=jsonb_build_object('eventID','espn:'||tag,'startsAt',at_time+interval '2 hours',
  'home',jsonb_build_object('id','fixture-home','abbreviation','FIXH'),
  'away',jsonb_build_object('id','fixture-away','abbreviation','FIXA'),
  'sourceIds',jsonb_build_object('espn',tag),'season',2026,'week',null,'gameDate',null,'neutralSite',false);
 forecast_doc:=jsonb_build_object('sport','NBA','eventID','espn:'||tag,'identity',identity_doc,
  'manifestHash',model_hash,'issuedAt',at_time-interval '10 seconds','startsAt',at_time+interval '2 hours',
  'homeProbability',0.6,'awayProbability',0.4,'productionEligible',false,'productionWeight',0,
  'fullFeatureEligible',false,'lineupVerified',false,'quoteComparisonEligible',false,'fixture',true);
 candidate:=jsonb_build_object('sport','NBA','event_id','espn:'||tag,'model_hash',model_hash,
  'model_version',version,'starts_at',at_time+interval '2 hours','input_hash',input_hash,'forecast',forecast_doc);
 source_doc:=jsonb_build_object('source_hash',input_hash,'source_url','urn:edge-lab:winner-inputs',
  'fetched_at',at_time-interval '1 minute','body',jsonb_build_object('fixture',true,'identity',identity_doc));
 result_doc:=public.winner_research_append(
  jsonb_build_array(jsonb_build_object('model_hash',model_hash,'sport','NBA','model_version',version,'manifest',manifest)),
  jsonb_build_array(source_doc),jsonb_build_array(candidate),'[]','{}');
 if result_doc->>'captured' is distinct from '1' then raise exception 'Initial append did not capture exactly one'; end if;
 select captured_at into stored_time from public.winner_prospective_forecasts p where p.model_hash=model_hash and p.event_id='espn:'||tag;
 if stored_time<at_time or stored_time>clock_timestamp() then raise exception 'Capture timestamp was not stamped by database'; end if;
 if not exists(select 1 from public.winner_prospective_forecasts p where p.model_hash=model_hash and p.event_id='espn:'||tag and capture_window='EARLY') then raise exception 'Wrong capture window'; end if;
 result_doc:=public.winner_research_append(p_forecasts=>jsonb_build_array(candidate));
 if result_doc->>'captured' is distinct from '0' then raise exception 'Forecast replay was not idempotent'; end if;
 insert into winner_guard_results values('append, clock, cohort and idempotence',true);

 result_doc:=public.winner_research_append(p_sources=>jsonb_build_array(jsonb_set(source_doc,'{fetched_at}',to_jsonb(at_time-interval '30 seconds'))));
 select count(*) into count_value from public.winner_source_snapshots s where s.source_hash=input_hash;
 if count_value<>1 then raise exception 'Content duplicated on later receipt'; end if;
 select count(*) into count_value from public.winner_source_receipts s where s.source_hash=input_hash;
 if count_value<>2 then raise exception 'Later receipt was not retained'; end if;
 select fetched_at into stored_time from public.winner_source_snapshots s where s.source_hash=input_hash;
 if stored_time<>at_time-interval '1 minute' then raise exception 'Original source receipt changed'; end if;
 insert into winner_guard_results values('content deduplication preserves separate actual receipts',true);

 perform pg_temp.winner_expect_rejection('select public.winner_research_append(p_forecasts=>null)','Winner batch limit');
 foreach changed in array array[
  jsonb_set(candidate,'{forecast,identity}','null'),
  jsonb_set(candidate,'{forecast,productionEligible}','true'),
  candidate#-'{forecast,homeProbability}',
  jsonb_set(candidate,'{forecast,sport}','"NFL"')
 ] loop
  perform pg_temp.winner_expect_rejection(format('select public.winner_research_append(p_forecasts=>%L::jsonb)',jsonb_build_array(changed)),'Invalid winner forecast provenance');
 end loop;
 -- Use a separate event to avoid ON CONFLICT suppressing a future-issue insert.
 changed:=jsonb_set(candidate,'{event_id}',to_jsonb('espn:'||tag||'_future_issue'));
 changed:=jsonb_set(changed,'{forecast,eventID}',to_jsonb('espn:'||tag||'_future_issue'));
 changed:=jsonb_set(changed,'{forecast,identity,eventID}',to_jsonb('espn:'||tag||'_future_issue'));
 changed:=jsonb_set(changed,'{forecast,issuedAt}',to_jsonb(at_time+interval '1 hour'));
 perform pg_temp.winner_expect_rejection(format('select public.winner_research_append(p_forecasts=>%L::jsonb)',jsonb_build_array(changed)),'violates check constraint');
 changed:=jsonb_set(candidate,'{forecast,identity,home,id}','"different-home"');
 perform pg_temp.winner_expect_rejection(format('select public.winner_research_append(p_forecasts=>%L::jsonb)',jsonb_build_array(changed)),'Winner event identity changed');
 perform pg_temp.winner_expect_rejection(format('select public.winner_research_append(p_sources=>%L::jsonb)',jsonb_build_array(jsonb_set(source_doc,'{body}','{"fixture":"different"}'))),'Winner source hash collision');
 changed:=jsonb_build_array(jsonb_build_object('model_hash',model_hash,'sport','NBA','model_version',version,'manifest',manifest||'{"different":true}'::jsonb));
 perform pg_temp.winner_expect_rejection(format('select public.winner_research_append(p_manifests=>%L::jsonb)',changed),'Frozen winner manifest mismatch');
 perform pg_temp.winner_expect_rejection(format('insert into public.winner_source_receipts(source_hash,fetched_at) values(%L,%L)',input_hash,at_time+interval '1 day'),'violates check constraint');
 insert into winner_guard_results values('null, identity, model, source and future timestamp guards',true);

 -- A real historical/backdated capture must fail through both writer paths.
 changed:=candidate||jsonb_build_object('starts_at',at_time-interval '1 hour');
 result_doc:=public.winner_research_append(p_forecasts=>jsonb_build_array(changed));
 if result_doc->>'captured' is distinct from '0' then raise exception 'Backdated capture admitted'; end if;
 perform pg_temp.winner_expect_rejection(format(
  'insert into public.winner_prospective_forecasts(sport,event_id,model_hash,model_version,starts_at,capture_window,captured_at,issued_at,input_hash,forecast) values(''NBA'',%L,%L,%L,%L,''EARLY'',%L,%L,%L,%L::jsonb)',
  'espn:'||tag||'_past',model_hash,version,at_time-interval '3 hours',at_time-interval '4 hours',at_time-interval '5 hours',input_hash,forecast_doc),
  'Outside winner capture window');
 insert into winner_guard_results values('historical captures rejected through RPC and direct insert',true);

 -- Positive final-result tests need a simulated forecast lifecycle. This seed is
 -- explicitly synthetic, holds the table lock, and can only exist until ROLLBACK.
 old_identity:=jsonb_set(identity_doc,'{eventID}',to_jsonb('espn:'||tag||'_past'));
 old_identity:=jsonb_set(old_identity,'{sourceIds,espn}',to_jsonb(tag||'_past'));
 old_identity:=jsonb_set(old_identity,'{startsAt}',to_jsonb(at_time-interval '3 hours'));
 old_forecast:=forecast_doc||jsonb_build_object('eventID','espn:'||tag||'_past','identity',old_identity,
  'startsAt',at_time-interval '3 hours','issuedAt',at_time-interval '5 hours');
 perform public.winner_research_append(p_sources=>jsonb_build_array(jsonb_build_object('source_hash',old_input_hash,
  'source_url','urn:edge-lab:winner-inputs','fetched_at',at_time-interval '6 hours','body',jsonb_build_object('fixture',true,'identity',old_identity))));
 execute 'alter table public.winner_prospective_forecasts disable trigger winner_forecast_clock';
 insert into public.winner_prospective_forecasts(sport,event_id,model_hash,model_version,starts_at,capture_window,captured_at,issued_at,input_hash,forecast)
 values('NBA','espn:'||tag||'_past',model_hash,version,at_time-interval '3 hours','EARLY',at_time-interval '4 hours',at_time-interval '5 hours',old_input_hash,old_forecast);
 execute 'alter table public.winner_prospective_forecasts enable trigger winner_forecast_clock';
 final_doc:=jsonb_build_object('source_hash',final_hash,'source_url','https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20000101',
  'fetched_at',at_time-interval '2 hours','body','{"fixture":true,"homeScore":110,"awayScore":100}'::jsonb);
 perform public.winner_research_append(p_sources=>jsonb_build_array(final_doc));
 outcome_doc:=jsonb_build_object('identity',old_identity,'status','FINAL','homeScore',110,'awayScore',100,'result','HOME_WIN','final',true,
  'source','ESPN_SCOREBOARD','sourceAuthority','PROVIDER_REPORTED_FINAL','leagueOfficialVerified',false,
  'sourceUrl',final_doc->>'source_url','sourceHash',final_hash,'sourceFetchedAt',at_time-interval '2 hours','productionEligible',false,'fixture',true);
 outcome_row:=jsonb_build_object('sport','NBA','event_id','espn:'||tag||'_past','evidence_hash',evidence_hash,'observed_at',at_time-interval '2 hours','outcome',outcome_doc);
 result_doc:=public.winner_research_append(p_outcomes=>jsonb_build_array(outcome_row));
 if result_doc->>'outcomeRevisions' is distinct from '1' then raise exception 'Valid exact final not stored'; end if;
 result_doc:=public.winner_research_append(p_outcomes=>jsonb_build_array(outcome_row));
 if result_doc->>'outcomeRevisions' is distinct from '0' then raise exception 'Outcome replay not idempotent'; end if;
 perform public.winner_research_append(p_sources=>jsonb_build_array(jsonb_set(final_doc,'{fetched_at}',to_jsonb(at_time-interval '1 hour'))));
 changed:=outcome_row||jsonb_build_object('evidence_hash',later_hash,'observed_at',at_time-interval '1 hour',
  'outcome',outcome_doc||jsonb_build_object('sourceFetchedAt',at_time-interval '1 hour'));
 result_doc:=public.winner_research_append(p_outcomes=>jsonb_build_array(changed));
 if result_doc->>'outcomeRevisions' is distinct from '1' then raise exception 'Same-content later receipt final was rejected'; end if;
 select count(*) into count_value from public.winner_source_snapshots s where s.source_hash=final_hash;
 if count_value<>1 then raise exception 'Final content repeated'; end if;
 select count(*) into count_value from public.winner_source_receipts s where s.source_hash=final_hash;
 if count_value<>2 then raise exception 'Final retrieval receipts lost'; end if;
 select observed_at into stored_time from public.winner_outcome_revisions o where o.event_id='espn:'||tag||'_past' order by observed_at desc,recorded_at desc limit 1;
 if stored_time<>at_time-interval '1 hour' then raise exception 'Latest actual source observation lost'; end if;
 insert into winner_guard_results values('valid final, idempotence and same-content later retrieval',true);

 foreach changed in array array[
  outcome_doc-'homeScore',outcome_doc-'sourceFetchedAt',
  outcome_doc||'{"status":"LIVE"}',outcome_doc||'{"homeScore":100,"result":"TIE","status":"TIE"}',
  outcome_doc||'{"result":"AWAY_WIN"}',outcome_doc||'{"final":false}',
  outcome_doc||'{"sourceUrl":"https://wrong.example/final"}',
  outcome_doc||jsonb_build_object('sourceFetchedAt',at_time-interval '90 minutes'),
  jsonb_set(outcome_doc,'{identity,home,id}','"wrong-home"')
 ] loop
  perform pg_temp.winner_expect_rejection(format(
   'insert into public.winner_outcome_revisions(sport,event_id,evidence_hash,observed_at,outcome) values(''NBA'',%L,%L,%L,%L::jsonb)',
   'espn:'||tag||'_past',repeat(md5(changed::text),2),at_time-interval '2 hours',changed),'Invalid winner final outcome provenance');
 end loop;
 insert into winner_guard_results values('direct outcome insert enforces identity, receipts, scores and status',true);

 perform pg_temp.winner_expect_rejection(format('update public.winner_model_manifests set manifest=manifest where model_hash=%L',model_hash),'append-only');
 perform pg_temp.winner_expect_rejection(format('delete from public.winner_source_snapshots where source_hash=%L',input_hash),'append-only');
 perform pg_temp.winner_expect_rejection(format('update public.winner_source_receipts set fetched_at=fetched_at where source_hash=%L',input_hash),'append-only');
 perform pg_temp.winner_expect_rejection(format('delete from public.winner_prospective_forecasts where model_hash=%L',model_hash),'append-only');
 perform pg_temp.winner_expect_rejection(format('update public.winner_outcome_revisions set outcome=outcome where event_id=%L','espn:'||tag||'_past'),'append-only');
 insert into winner_guard_results values('all evidence tables reject mutations',true);

 foreach table_name in array array['winner_model_manifests','winner_source_snapshots','winner_source_receipts','winner_prospective_forecasts','winner_outcome_revisions','winner_research_state','winner_outcome_checks'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||table_name)::regclass) then raise exception 'RLS missing on %',table_name; end if;
  foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE'] loop
   if has_table_privilege('anon','public.'||table_name,privilege_name) or has_table_privilege('authenticated','public.'||table_name,privilege_name) then raise exception 'Public grant on %',table_name; end if;
  end loop;
 end loop;
 if has_function_privilege('anon','public.winner_research_append(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') then raise exception 'Public writer RPC grant'; end if;
 result_doc:=public.winner_research_status();
 if result_doc->>'productionWeight' is distinct from '0' or result_doc->>'productionEligible' is distinct from 'false' then raise exception 'Research status claims production influence'; end if;
 insert into winner_guard_results values('RLS, grants and zero-influence status',true);
end;
$$;
select check_name,passed from winner_guard_results order by check_name;
rollback;
