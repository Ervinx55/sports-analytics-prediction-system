-- Synthetic transactional tests. Execute the entire file; every fixture rolls back.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
create temporary table readiness_guard_results(check_name text primary key, passed boolean not null) on commit drop;
do $$
#variable_conflict use_variable
declare
 t timestamptz:=clock_timestamp(); tag text:='espn:__readiness_'||txid_current();
 mh text:=repeat(md5('readiness-model-'||txid_current()),2); ih text:=repeat(md5('readiness-input-'||txid_current()),2);
 manifest jsonb; identity_doc jsonb; forecast_doc jsonb; candidate jsonb; result_doc jsonb;
 original_digest text; current_digest text; n integer; denied boolean; pk_columns text[]; readiness_row jsonb;
 old_tag text:=tag||'_delayed'; old_ih text:=repeat(md5('readiness-delayed-input-'||txid_current()),2);
 old_forecast jsonb; old_candidate jsonb; conflict_doc jsonb;
begin
 -- This statement fails before the migration; no partial fixture writes occur.
 perform 1 from public.winner_readiness_observations limit 1;
 manifest:=jsonb_build_object('sport','NBA','modelVersion','SYNTHETIC_ROLLBACK_ONLY','manifestHash',mh,'productionWeight',0,'productionEligible',false);
 identity_doc:=jsonb_build_object('eventID',tag,'startsAt',t+interval '2 hours','home',jsonb_build_object('id','TOR'),'away',jsonb_build_object('id','WAS'));
 forecast_doc:=jsonb_build_object('sport','NBA','eventID',tag,'identity',identity_doc,'manifestHash',mh,'issuedAt',t-interval '5 seconds','startsAt',t+interval '2 hours','homeProbability',0.6,'awayProbability',0.4,'productionEligible',false,'productionWeight',0,'fullFeatureEligible',false,'lineupVerified',false,'quoteComparisonEligible',false);
 candidate:=jsonb_build_object('sport','NBA','event_id',tag,'model_hash',mh,'model_version','SYNTHETIC_ROLLBACK_ONLY','starts_at',t+interval '2 hours','input_hash',ih,'forecast',forecast_doc);
 result_doc:=public.winner_research_append(jsonb_build_array(jsonb_build_object('model_hash',mh,'sport','NBA','model_version','SYNTHETIC_ROLLBACK_ONLY','manifest',manifest)),jsonb_build_array(jsonb_build_object('source_hash',ih,'source_url','urn:edge-lab:winner-inputs','fetched_at',t-interval '1 minute','body','{"synthetic":true}'::jsonb)),jsonb_build_array(candidate));
 if result_doc->>'captured'<>'1' or result_doc->>'readinessObservations'<>'1' then raise exception 'Initial evidence not saved'; end if;
 select md5(to_jsonb(f)::text) into original_digest from public.winner_prospective_forecasts f where event_id=tag;
 -- A later observation changes readiness, never the original probability or evidence.
 candidate:=jsonb_set(candidate,'{forecast,issuedAt}',to_jsonb(t-interval '1 second'));
 candidate:=jsonb_set(candidate,'{forecast,quoteComparisonEligible}','true');
 result_doc:=public.winner_research_append(p_forecasts=>jsonb_build_array(candidate));
 if result_doc->>'captured'<>'0' or result_doc->>'readinessObservations'<>'1' then raise exception 'Later readiness lost'; end if;
 select md5(to_jsonb(f)::text) into current_digest from public.winner_prospective_forecasts f where event_id=tag;
 if current_digest is distinct from original_digest then raise exception 'Original forecast changed'; end if;
 select count(*) into n from public.winner_readiness_observations where event_id=tag;
 if n<>2 then raise exception 'Observation history missing'; end if;
 result_doc:=public.winner_research_append(p_forecasts=>jsonb_build_array(candidate));
 if result_doc->>'readinessObservations'<>'0' then raise exception 'Replay duplicated readiness'; end if;
 insert into readiness_guard_results values('later evidence retained; original immutable; replay idempotent',true);
 -- The server recomputes capture_window. Replay identity must not change when
 -- that clock crosses 90/30 minutes. Inspect the actual key instead of changing
 -- timestamps or disabling the chronology trigger to manufacture a past row.
 select array_agg(a.attname::text order by u.ordinality) into pk_columns
 from pg_constraint c cross join lateral unnest(c.conkey) with ordinality u(attnum,ordinality)
 join pg_attribute a on a.attrelid=c.conrelid and a.attnum=u.attnum
 where c.conrelid='public.winner_readiness_observations'::regclass and c.contype='p';
 if pk_columns is distinct from array['sport','event_id','model_hash','input_hash','issued_at']::text[] then raise exception 'Readiness replay key depends on capture window'; end if;
 insert into public.winner_readiness_observations(sport,event_id,model_hash,model_version,starts_at,capture_window,issued_at,input_hash,forecast)
 values('NBA',tag,mh,'SYNTHETIC_ROLLBACK_ONLY',t+interval '2 hours','PRE30_5',t-interval '1 second',ih,candidate->'forecast') on conflict do nothing;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Caller window duplicated readiness'; end if;
 insert into readiness_guard_results values('replay identity independent of server or caller capture window',true);
 -- A delayed insert may be recorded now, but its older observation is stale.
 old_forecast:=jsonb_set(jsonb_set(jsonb_set(forecast_doc,'{eventID}',to_jsonb(old_tag)),'{identity,eventID}',to_jsonb(old_tag)),'{issuedAt}',to_jsonb(t-interval '20 minutes'));
 old_candidate:=jsonb_set(jsonb_set(jsonb_set(candidate,'{event_id}',to_jsonb(old_tag)),'{input_hash}',to_jsonb(old_ih)),'{forecast}',old_forecast);
 result_doc:=public.winner_research_append(p_sources=>jsonb_build_array(jsonb_build_object('source_hash',old_ih,'source_url','urn:edge-lab:winner-inputs','fetched_at',t-interval '30 minutes','body','{"synthetic":"delayed"}'::jsonb)),p_forecasts=>jsonb_build_array(old_candidate));
 select value into readiness_row from jsonb_array_elements(public.winner_research_status()#>'{readiness,events}') where value->>'event_id'=old_tag;
 if readiness_row is null or readiness_row->>'observation_fresh' is distinct from 'false'
  or (readiness_row->>'observed_at')::timestamptz is distinct from t-interval '20 minutes'
  or (readiness_row->>'recorded_at')::timestamptz<t then raise exception 'Storage receipt refreshed old observation'; end if;
 denied:=false;
 begin
  insert into public.winner_readiness_observations(sport,event_id,model_hash,model_version,starts_at,capture_window,issued_at,input_hash,forecast)
  values('NBA',old_tag,mh,'SYNTHETIC_ROLLBACK_ONLY',t+interval '2 hours','EARLY',t+interval '1 hour',old_ih,jsonb_set(old_forecast,'{issuedAt}',to_jsonb(t+interval '1 hour')));
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Future issued readiness allowed'; end if;
 insert into readiness_guard_results values('old observed time remains stale; future issue is rejected',true);
 denied:=false;
 begin update public.winner_readiness_observations set forecast='{}' where event_id=tag; exception when others then denied:=position('append-only' in sqlerrm)>0; end;
 if not denied then raise exception 'Readiness update allowed'; end if;
 denied:=false;
 begin delete from public.winner_readiness_observations where event_id=tag; exception when others then denied:=position('append-only' in sqlerrm)>0; end;
 if not denied then raise exception 'Readiness delete allowed'; end if;
 insert into readiness_guard_results values('observation mutation forbidden',true);
 denied:=false;
 begin
  insert into public.winner_readiness_observations(sport,event_id,model_hash,model_version,starts_at,capture_window,issued_at,input_hash,forecast)
  values('NBA',tag,mh,'SYNTHETIC_ROLLBACK_ONLY',t-interval '1 hour','EARLY',t-interval '2 hours',ih,forecast_doc);
 exception when others then denied:=position('Outside winner capture window' in sqlerrm)>0; end;
 if not denied then raise exception 'Post-start observation allowed'; end if;
 denied:=false;
 begin
  insert into public.winner_readiness_observations(sport,event_id,model_hash,model_version,starts_at,capture_window,issued_at,input_hash,forecast)
  values('NBA',tag,mh,'SYNTHETIC_ROLLBACK_ONLY',t+interval '2 hours','EARLY',t-interval '5 seconds',ih,jsonb_set(forecast_doc,'{productionEligible}','true'));
 exception when others then denied:=position('Invalid winner forecast provenance' in sqlerrm)>0; end;
 if not denied then raise exception 'Readiness production bypass allowed'; end if;
 insert into readiness_guard_results values('server chronology and frozen provenance enforced',true);
 -- A newly flagged event cannot append a newer readiness observation, and an
 -- arbitrary schedule suffix cannot evade the registered-revision guard.
 conflict_doc:=jsonb_build_object('sport','NBA','eventID',tag,'reason','SCHEDULE_SOURCE_CONFLICT','sourceEventId','fixture-provider','home','TOR','away','WAS','scheduleSourceHash',ih,'providerSourceHash',old_ih,'scheduleStartsAt',t+interval '2 hours','providerStartsAt',t+interval '2 hours 1 minute','scheduleSourceFetchedAt',t-interval '1 minute','providerSourceFetchedAt',t-interval '30 minutes');
 insert into public.winner_event_quality_flags(sport,event_id,reason,source_event_id,home,away,schedule_starts_at,provider_starts_at,schedule_source_hash,schedule_source_fetched_at,provider_source_hash,provider_source_fetched_at,evidence)
 values('NBA',tag,'SCHEDULE_SOURCE_CONFLICT','fixture-provider','TOR','WAS',t+interval '2 hours',t+interval '2 hours 1 minute',ih,t-interval '1 minute',old_ih,t-interval '30 minutes',conflict_doc);
 result_doc:=public.winner_research_append(p_forecasts=>jsonb_build_array(jsonb_set(candidate,'{forecast,issuedAt}',to_jsonb(t))));
 if result_doc->>'captured'<>'0' or result_doc->>'readinessObservations'<>'0' then raise exception 'Quarantined readiness accepted'; end if;
 if exists(select 1 from jsonb_array_elements(public.winner_research_status()#>'{readiness,events}') r where r->>'event_id'=tag) then raise exception 'Quarantined readiness publicly counted'; end if;
 denied:=false;
 begin
  insert into public.winner_readiness_observations(sport,event_id,model_hash,model_version,starts_at,capture_window,issued_at,input_hash,forecast)
  values('NBA',tag||':schedule:'||repeat('f',64),mh,'SYNTHETIC_ROLLBACK_ONLY',t+interval '2 hours','EARLY',t-interval '1 second',ih,candidate->'forecast');
 exception when no_data_found then denied:=true; end;
 if not denied then raise exception 'Unregistered schedule identity accepted'; end if;
 insert into readiness_guard_results values('quarantine and official schedule guard apply to readiness',true);
 if has_table_privilege('anon','public.winner_readiness_observations','SELECT') or has_table_privilege('authenticated','public.winner_readiness_observations','INSERT') or has_table_privilege('service_role','public.winner_readiness_observations','UPDATE') then raise exception 'Readiness access too broad'; end if;
 if not (select relrowsecurity from pg_class where oid='public.winner_readiness_observations'::regclass) then raise exception 'RLS missing'; end if;
 if public.winner_research_status()->>'productionEligible'<>'false' then raise exception 'Status promoted model'; end if;
 insert into readiness_guard_results values('private access and research-only status preserved',true);
end;
$$;
select * from readiness_guard_results order by check_name;
rollback;
