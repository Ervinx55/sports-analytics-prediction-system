-- Run using the generated schedule-migration-rollback.sql wrapper. It begins and
-- rolls back the whole migration/test transaction, with real archived official
-- source fixtures supplied via winner.schedule_registration_fixture. Forecasts
-- and fresh quote receipts below are explicitly synthetic and never committed.
create temporary table winner_schedule_results(check_name text primary key,passed boolean not null) on commit drop;
create function pg_temp.schedule_expect_rejection(statement text) returns void language plpgsql as $$
declare failed boolean:=false;
begin
 begin execute statement; exception when others then failed:=true; end;
 if not failed then raise exception 'Expected schedule rejection did not occur'; end if;
end;
$$;
do $$
#variable_conflict use_variable
declare
 payload jsonb:=current_setting('winner.schedule_registration_fixture')::jsonb;
 r jsonb; changed jsonb; result_doc jsonb; before_captures text; after_captures text; before_flags text; after_flags text;
 original public.winner_prospective_forecasts; candidate jsonb; forecast_doc jsonb; identity_doc jsonb; agreement jsonb;
 at_time timestamptz:=clock_timestamp(); receipt timestamptz:=clock_timestamp()-interval '5 seconds';
 input_hash text:=repeat(md5('__schedule_input_'||txid_current()),2); quote_hash text:=repeat(md5('__schedule_quote_'||txid_current()),2);
 count_value integer; role_name text; privilege_name text;
begin
 select md5(string_agg(to_jsonb(f)::text,'' order by sport,event_id,model_hash,capture_window)) into before_captures from public.winner_prospective_forecasts f;
 select md5(string_agg(to_jsonb(q)::text,'' order by sport,event_id,reason)) into before_flags from public.winner_event_quality_flags q;
 result_doc:=public.winner_register_schedule_revisions(payload->'p_sources',payload->'p_revisions');
 if result_doc->>'registered' is distinct from '2' then raise exception 'Expected two first registrations inside rollback'; end if;
 result_doc:=public.winner_register_schedule_revisions(payload->'p_sources',payload->'p_revisions');
 if result_doc->>'registered' is distinct from '0' then raise exception 'Registration is not idempotent'; end if;
 select md5(string_agg(to_jsonb(f)::text,'' order by sport,event_id,model_hash,capture_window)) into after_captures from public.winner_prospective_forecasts f;
 select md5(string_agg(to_jsonb(q)::text,'' order by sport,event_id,reason)) into after_flags from public.winner_event_quality_flags q;
 if before_captures is distinct from after_captures or before_flags is distinct from after_flags then raise exception 'Registration rewrote existing evidence'; end if;
 insert into winner_schedule_results values('two official registrations and idempotence preserve all original captures and flags',true);

 r:=payload#>'{p_revisions,0}';
 foreach changed in array array[r-'revisionHash',r||'{"home":"DAL"}'::jsonb,r||'{"sourceEventId":"different-game"}'::jsonb,r||jsonb_build_object('announcementFetchedAt',r->>'startsAt')] loop
  perform pg_temp.schedule_expect_rejection(format('select public.winner_register_schedule_revisions(''[]'',%L::jsonb)',jsonb_build_array(changed)));
 end loop;
 perform pg_temp.schedule_expect_rejection('select public.winner_register_schedule_revisions(null,''[]'')');
 insert into winner_schedule_results values('forged hash, wrong team, crossgame ID, poststart receipt and null batch reject',true);

 select * into strict original from public.winner_prospective_forecasts where sport='NFL' and event_id=r->>'baseEventID' order by captured_at limit 1;
 identity_doc:=original.forecast->'identity';
 identity_doc:=identity_doc||jsonb_build_object('eventID',r->>'eventID','providerEventID',r->>'baseEventID','scheduleRevisionHash',r->>'revisionHash','officialGameID',r->>'officialGameID','startsAt',r->>'startsAt');
 agreement:=jsonb_build_object('sourceEventId',r->>'sourceEventId','sourceHash',quote_hash,'fetchedAt',receipt,'startsAt',r->>'startsAt','home',r->>'home','away',r->>'away');
 forecast_doc:=original.forecast||jsonb_build_object('eventID',r->>'eventID','identity',identity_doc,'startsAt',r->>'startsAt','issuedAt',at_time,'generatedAt',at_time,'fixture','SYNTHETIC_ROLLBACK_ONLY','quoteComparisonEligible',true,
  'eventEvidence',jsonb_build_object('scheduleRevision',r,'scheduleAgreement',agreement),
  'quoteComparison',jsonb_build_object('eligible',true,'pairs',jsonb_build_array(jsonb_build_object('sourceHash',quote_hash,'sourceEventId',r->>'sourceEventId','fetchedAt',receipt))));
 candidate:=jsonb_build_object('sport','NFL','event_id',r->>'eventID','model_hash',original.model_hash,'model_version',original.model_version,'starts_at',r->>'startsAt','input_hash',input_hash,'forecast',forecast_doc);
 perform public.winner_research_append(p_sources=>jsonb_build_array(
  jsonb_build_object('source_hash',input_hash,'source_url','urn:edge-lab:winner-inputs','fetched_at',receipt,'body','{"fixture":"SYNTHETIC_ROLLBACK_ONLY"}'::jsonb),
  jsonb_build_object('source_hash',quote_hash,'source_url','https://api.sportsgameodds.com/v2/events?fixture=rollback','fetched_at',receipt,'body','{"fixture":"SYNTHETIC_ROLLBACK_ONLY"}'::jsonb)));
 result_doc:=public.winner_research_append(p_forecasts=>jsonb_build_array(candidate));
 if result_doc->>'captured' is distinct from '1' then raise exception 'Evidence-bound corrected identity was not captured'; end if;
 result_doc:=public.winner_research_append(p_forecasts=>jsonb_build_array(jsonb_build_object('sport',original.sport,'event_id',original.event_id,'model_hash',original.model_hash,'model_version',original.model_version,'starts_at',original.starts_at,'input_hash',original.input_hash,'forecast',original.forecast)));
 if result_doc->>'captured' is distinct from '0' then raise exception 'Resolution cleared original event quarantine'; end if;
 if not exists(select 1 from public.winner_event_quality_flags where event_id=original.event_id) then raise exception 'Original flag deleted'; end if;
 insert into winner_schedule_results values('corrected capture admitted while original identity stays quarantined',true);

 foreach changed in array array[
  jsonb_set(candidate,'{event_id}',to_jsonb((r->>'baseEventID')||':schedule:'||repeat('0',64))),
  jsonb_set(candidate,'{forecast,identity,home,id}','"DAL"'),
  jsonb_set(candidate,'{forecast,eventEvidence,scheduleAgreement,fetchedAt}',to_jsonb(at_time+interval '1 second')),
  jsonb_set(candidate,'{forecast,quoteComparisonEligible}','false'),
  candidate#-'{forecast,identity,scheduleRevisionHash}'
 ] loop
  perform pg_temp.schedule_expect_rejection(format('select public.winner_research_append(p_forecasts=>%L::jsonb)',jsonb_build_array(changed)));
 end loop;
 insert into winner_schedule_results values('fake version, crossgame capture, future agreement, missing pair and missing revision reject',true);

 perform pg_temp.schedule_expect_rejection('update public.winner_official_schedule_revisions set evidence=evidence');
 perform pg_temp.schedule_expect_rejection('delete from public.winner_event_quality_resolutions');
 foreach role_name in array array['anon','authenticated'] loop
  foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
   if has_table_privilege(role_name,'public.winner_official_schedule_revisions',privilege_name) or has_table_privilege(role_name,'public.winner_event_quality_resolutions',privilege_name) then raise exception 'Public revision privilege'; end if;
  end loop;
  if has_function_privilege(role_name,'public.winner_register_schedule_revisions(jsonb,jsonb)','EXECUTE') then raise exception 'Public registration RPC'; end if;
 end loop;
 if exists(select 1 from pg_class where oid in ('public.winner_official_schedule_revisions'::regclass,'public.winner_event_quality_resolutions'::regclass) and not relrowsecurity) then raise exception 'Revision RLS disabled'; end if;
 insert into winner_schedule_results values('official revision and resolution append-only with private RLS and RPC',true);
end;
$$;
select * from winner_schedule_results order by check_name;
