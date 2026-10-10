-- Run against a disposable development database only. All fixture writes roll back.
begin;
set local role service_role;
do $$
declare p jsonb; prediction uuid; decision uuid; other uuid;
begin
 p := '{"sourceKey":"fixture:snapshot:1","sport":"NFL","eventKey":"fixture:nfl:1","marketType":"spread","side":"HOME","line":0,"modelVersion":"v1","modelMode":"LIVE","modelAvailable":true,"capturedAt":"2020-10-05T12:00:00Z","startsAt":"2020-10-05T12:15:00Z","eligibilityStartsAt":"2020-10-05T12:15:00Z","quoteAt":"2020-10-05T11:59:00Z","odds":-110,"book":"fixture-book","modelProbability":0.6,"marketProbability":0.5,"probabilityBasis":"CONDITIONAL_NO_PUSH","sourceIds":{"event":"1"},"settlementRule":{"version":"v1"},"provenance":{"source":"fixture"},"eligibilityReasons":[]}';
 prediction := public.ingest_prediction_v1(p);
 assert prediction = public.ingest_prediction_v1(p), 'duplicate ingest ID differs';
 begin
  perform public.ingest_prediction_v1(p || '{"odds":100}'::jsonb);
  raise exception 'conflicting source payload accepted';
 exception when unique_violation then null;
 end;
 assert (select line = 0 and valid from public.performance_predictions where id = prediction), 'zero line or valid eligibility lost';
 decision := public.record_decision_v1(jsonb_build_object('sourceKey','fixture:decision:1','predictionId',prediction,'issuedAt','2020-10-05T12:00:00Z','status','PLAY','qualified',true,'evidence',jsonb_build_object('finalQualification',true),'legacyReconstructed',false));
 other := public.ingest_prediction_v1(p || '{"sourceKey":"fixture:snapshot:2","capturedAt":"2020-10-05T12:01:00Z","odds":120}'::jsonb);
 perform public.record_decision_v1(jsonb_build_object('sourceKey','fixture:decision:2','predictionId',other,'issuedAt','2020-10-05T12:01:00Z','status','PLAY','qualified',true,'evidence',jsonb_build_object('finalQualification',true),'legacyReconstructed',false));
 assert (select count(*) = 1 from public.performance_decisions where first_issued), 'first PLAY portfolio duplicated';
 assert (select prediction_id = prediction from public.performance_decisions where id = decision), 'first price changed';
 begin
  perform public.record_decision_v1(jsonb_build_object('sourceKey','fixture:raw','predictionId',prediction,'issuedAt','2020-10-05T12:00:00Z','status','PLAY','qualified',true,'evidence','{}'::jsonb));
  raise exception 'raw candidate PLAY accepted';
 exception when check_violation then null;
 end;
 perform public.append_settlement_v1(jsonb_build_object('predictionId',prediction,'revision',1,'outcome','LOSS','source','official','sourceUpdatedAt','2020-10-05T16:00:00Z','settledAt','2020-10-05T17:00:00Z','ruleVersion','v1','actualValue',0));
 perform public.append_settlement_v1(jsonb_build_object('predictionId',prediction,'revision',2,'outcome','WIN','source','official','sourceUpdatedAt','2020-10-05T18:00:00Z','settledAt','2020-10-05T19:00:00Z','ruleVersion','v1','actualValue',7,'supersedesRevision',1));
 assert (select count(*) = 2 from public.performance_settlements where prediction_id = prediction), 'settlement revision lost';
 begin
  update public.performance_predictions set line = 1 where id = prediction;
  raise exception 'immutable prediction updated';
 exception when insufficient_privilege then null;
 end;
 begin
  delete from public.performance_predictions where id = prediction;
  raise exception 'immutable prediction deleted';
 exception when insufficient_privilege then null;
 end;
 -- Reschedule append cannot rewrite the original cutoff.
 perform public.ingest_prediction_v1(p || '{"sourceKey":"fixture:late","capturedAt":"2020-10-05T13:00:00Z","startsAt":"2020-10-06T12:00:00Z","eligibilityStartsAt":"2020-10-06T12:00:00Z","quoteAt":"2020-10-05T12:59:00Z"}'::jsonb);
 assert (select not valid and eligibility_starts_at = '2020-10-05T12:15:00Z'::timestamptz from public.performance_predictions where source_key = 'fixture:late'), 'reschedule admitted post-start capture';
 perform public.ingest_prediction_v1(p || '{"sourceKey":"fixture:invalid","modelProbability":null,"eligibilityReasons":[]}'::jsonb);
 assert (select not valid from public.performance_predictions where source_key = 'fixture:invalid'), 'invalid probability accepted';
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.ingest_prediction_v1('{}'); raise exception 'anon RPC allowed'; exception when insufficient_privilege then null; end;
 begin insert into public.performance_predictions(source_key,payload) values('anon','{}'); raise exception 'anon write allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform public.record_decision_v1('{}'); raise exception 'authenticated RPC allowed'; exception when insufficient_privilege then null; end;
 begin delete from public.performance_predictions; raise exception 'authenticated delete allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
do $$ begin assert not exists(select 1 from public.performance_predictions where source_key like 'fixture:%'), 'rollback did not restore fixtures'; end $$;
-- Additional security and preservation assertions; use a fresh transaction.
begin;
set local role service_role;
do $$
declare p jsonb; first uuid; later uuid; pred uuid; shadow uuid; candidate uuid; changed jsonb;
begin
 p := '{"sourceKey":"fixture:boundary:1","sport":"NBA","eventKey":"fixture:nba:1","marketType":"total","side":"OVER","line":220,"modelVersion":"v1","modelMode":"LIVE","modelAvailable":true,"capturedAt":"2020-10-05T12:00:00Z","startsAt":"2020-10-05T12:15:00Z","quoteAt":"2020-10-05T11:59:00Z","book":"fixture-book","odds":-110,"book":"fixture-book","modelProbability":0.6,"marketProbability":0.5,"probabilityBasis":"CONDITIONAL_NO_PUSH","sourceIds":{"event":"nba1","provider":"fixture"},"settlementRule":{"version":"v1"},"provenance":{},"eligibilityReasons":[]}';
 pred := public.ingest_prediction_v1(p);
 first := public.record_decision_v1(jsonb_build_object('sourceKey','fixture:first','predictionId',pred,'issuedAt','2020-10-05T12:00:00Z','status','PLAY','qualified',true,'evidence',jsonb_build_object('finalQualification',true)));
 later := public.record_decision_v1(jsonb_build_object('sourceKey','fixture:later','predictionId',pred,'issuedAt','2020-10-05T12:00:30Z','status','PLAY','qualified',true,'evidence',jsonb_build_object('finalQualification',true)));
 assert (select count(*) = 2 from public.performance_decisions where prediction_id=pred), 'later issuance audit was discarded';
 assert (select count(*) = 1 from public.performance_decisions where prediction_id=pred and first_issued), 'first issuance portfolio duplicated';
 assert first <> later, 'different issuance lost its ID';
 assert (select count(*) = 1 from public.performance_event_mappings where source_event_id='nba1'), 'canonical source mapping missing';
 shadow := public.ingest_prediction_v1(p || '{"sourceKey":"fixture:shadow","modelMode":"SHADOW"}'::jsonb);
 begin
 perform public.record_decision_v1(jsonb_build_object('sourceKey','fixture:shadow-play','predictionId',shadow,'issuedAt','2020-10-05T12:00:00Z','status','PLAY','qualified',true,'evidence',jsonb_build_object('finalQualification',true)));
 raise exception 'SHADOW became qualified'; exception when check_violation then null; end;
 -- Missing odds cannot become a priced PLAY even though predictive metrics may use this observation.
 candidate := public.ingest_prediction_v1(p || '{"sourceKey":"fixture:no-price","odds":null}'::jsonb);
 begin
 perform public.record_decision_v1(jsonb_build_object('sourceKey','fixture:no-price-play','predictionId',candidate,'issuedAt','2020-10-05T12:00:00Z','status','PLAY','qualified',true,'evidence',jsonb_build_object('finalQualification',true)));
 raise exception 'missing price PLAY accepted'; exception when check_violation then null; end;
 -- Fresh at capture is insufficient when issuance arrives after its quote window.
 begin
 perform public.record_decision_v1(jsonb_build_object('sourceKey','fixture:stale-play','predictionId',pred,'issuedAt','2020-10-05T12:02:00Z','status','PLAY','qualified',true,'evidence',jsonb_build_object('finalQualification',true)));
 raise exception 'stale issuance accepted'; exception when check_violation then null; end;
 changed := p || '{"sourceKey":"fixture:missing-line","line":null}'::jsonb;
 candidate := public.ingest_prediction_v1(changed);
 assert (select not valid from public.performance_predictions where id=candidate), 'missing exact line admitted';
end $$;
reset role;
rollback;
begin;
set local role service_role;
do $$
declare p jsonb; a uuid; b uuid; d uuid;
begin
 p := '{"sourceKey":"fixture:scale:1","sport":"NFL","eventKey":"fixture:scale","marketType":"spread","side":"HOME","line":0,"modelVersion":"v1","modelMode":"LIVE","modelAvailable":true,"capturedAt":"2020-10-05T12:00:00Z","startsAt":"2020-10-05T12:15:00Z","quoteAt":"2020-10-05T11:59:00Z","book":"book","odds":-110,"modelProbability":0.6,"marketProbability":0.5,"probabilityBasis":"CONDITIONAL_NO_PUSH","sourceIds":{"event":"scale"},"settlementRule":{"version":"v1"},"provenance":{},"eligibilityReasons":[]}';
 a := public.ingest_prediction_v1(p);
 b := public.ingest_prediction_v1(p || '{"sourceKey":"fixture:scale:2","line":"0.0"}'::jsonb);
 assert (select market_key from public.performance_predictions where id=a) = (select market_key from public.performance_predictions where id=b), 'numeric scale duplicated exact market';
 d := public.ingest_prediction_v1(p || '{"sourceKey":"fixture:notfinite","line":"NaN"}'::jsonb);
 assert (select not valid from public.performance_predictions where id=d), 'nonfinite line valid';
 d := public.ingest_prediction_v1(p || '{"sourceKey":"fixture:null-metadata","sourceIds":null,"provenance":null,"modelAvailable":null}'::jsonb);
 assert (select not valid from public.performance_predictions where id=d), 'null metadata valid';
end $$;
reset role;
rollback;
begin;
set local role service_role;
do $$
declare p jsonb; diagnostic uuid; later uuid;
begin
 p := '{"sourceKey":"fixture:poison:1","sport":"NFL","eventKey":"fixture:poison","marketType":"spread","side":"HOME","line":0,"modelVersion":"v1","modelMode":"LIVE","modelAvailable":true,"capturedAt":"2020-10-05T12:00:00Z","startsAt":"2020-10-06T12:15:00Z","quoteAt":"2020-10-05T11:59:00Z","book":"book","odds":-110,"modelProbability":null,"marketProbability":0.5,"probabilityBasis":"CONDITIONAL_NO_PUSH","sourceIds":{"event":"poison","provider":"fixture"},"settlementRule":{"version":"v1"},"provenance":{},"eligibilityReasons":[]}';
 diagnostic := public.ingest_prediction_v1(p);
 assert not exists(select 1 from public.performance_events where event_key='fixture:poison'), 'diagnostic seeded canonical event cutoff';
 assert not exists(select 1 from public.performance_event_mappings where source_event_id='poison'), 'diagnostic seeded source mapping';
 later := public.ingest_prediction_v1(p || '{"sourceKey":"fixture:poison:2","modelProbability":0.6,"capturedAt":"2020-10-05T13:00:00Z","startsAt":"2020-10-05T12:15:00Z","quoteAt":"2020-10-05T12:59:00Z"}'::jsonb);
 assert (select not valid from public.performance_predictions where id=later), 'diagnostic cutoff admitted post-start capture';
 later := public.ingest_prediction_v1(p || '{"sourceKey":"fixture:delayed-original","eventKey":"fixture:delayed","modelProbability":0.6,"capturedAt":"2020-10-05T13:00:00Z","startsAt":"2020-10-05T12:15:00Z","eligibilityStartsAt":"2020-10-06T12:15:00Z","quoteAt":"2020-10-05T12:59:00Z"}'::jsonb);
 assert (select not valid from public.performance_predictions where id=later), 'caller delayed original start';
 assert (select count(*)=3 from public.performance_predictions where source_key in ('fixture:poison:1','fixture:poison:2','fixture:delayed-original')), 'diagnostic provenance lost';
end $$;
reset role;
rollback;
begin;
set local role service_role;
do $$
declare p jsonb; value text; pred uuid;
begin
 p := '{"sourceKey":"fixture:numeric:1","sport":"NFL","eventKey":"fixture:numeric","marketType":"spread","side":"HOME","line":0,"modelVersion":"v1","modelMode":"LIVE","modelAvailable":true,"capturedAt":"2020-10-05T12:00:00Z","startsAt":"2020-10-05T12:15:00Z","quoteAt":"2020-10-05T11:59:00Z","book":"book","odds":-110,"modelProbability":0.6,"marketProbability":0.5,"probabilityBasis":"CONDITIONAL_NO_PUSH","sourceIds":{"event":"numeric"},"settlementRule":{"version":"v1"},"provenance":{},"eligibilityReasons":[]}';
 foreach value in array array['nan','NAN','infinity','+Infinity','-infinity','+nan','-nan'] loop
  assert public.performance_number_v1(to_jsonb(value)) is null, 'nonfinite cast survived: ' || value;
  pred := public.ingest_prediction_v1(p || jsonb_build_object('sourceKey','fixture:nonfinite-line:'||value,'line',value));
  assert (select not valid and line is null from public.performance_predictions where id=pred), 'nonfinite line valid: ' || value;
  pred := public.ingest_prediction_v1(p || jsonb_build_object('sourceKey','fixture:nonfinite-odds:'||value,'odds',value));
  assert (select odds is null from public.performance_predictions where id=pred), 'nonfinite odds stored: ' || value;
  begin
   perform public.record_decision_v1(jsonb_build_object('sourceKey','fixture:nonfinite-play:'||value,'predictionId',pred,'issuedAt','2020-10-05T12:00:00Z','status','PLAY','qualified',true,'evidence',jsonb_build_object('finalQualification',true)));
   raise exception 'nonfinite price qualified';
  exception when check_violation then null; end;
 end loop;
end $$;
reset role;
rollback;
