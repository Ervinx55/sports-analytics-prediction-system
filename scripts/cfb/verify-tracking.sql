-- Transactional integration assertions. All fixture data is rolled back.
begin;
insert into public.cfb_capture_scope(espn_event_id,model_version,starts_at,game)
values('cfb-verify-missed','cfb-verify',now()-interval '1 hour','{}');
insert into public.cfb_prospective_forecasts(event_id,model_version,captured_at,starts_at,forecast,input_hash)
values('cfb-verify-event','cfb-verify',now()-interval '3 hours',now()-interval '2 hours',
'{"espnEventID":"cfb-verify-captured","homeProbability":0.7,"productionEligible":false}','test');
insert into public.cfb_outcome_revisions(event_id,evidence_hash,outcome)
values
('cfb-verify-event','A1',jsonb_build_object('homeScore',20,'awayScore',10,'valid',true,'fetchedAt',now()-interval '3 minutes')),
('cfb-verify-event','A2',jsonb_build_object('homeScore',20,'awayScore',10,'valid',true,'fetchedAt',now()-interval '1 minute')),
('cfb-verify-event','B',jsonb_build_object('homeScore',10,'awayScore',20,'valid',true,'fetchedAt',now()-interval '2 minutes'));
do $$ declare m jsonb; begin
 m:=public.cfb_research_performance('cfb-verify');
 assert (m->>'wins')::integer=1,'Newest source observation must win despite processing order';
 assert (m->'coverage'->>'missedClosedCaptureWindows')::integer=1,'Missed historical capture must remain in denominator';
 assert not has_table_privilege('anon','public.cfb_capture_scope','SELECT'),'Scope must remain private';
 assert not has_function_privilege('anon','public.record_cfb_capture_scope(text)','EXECUTE'),'Capture scope RPC must remain private';
end $$;
select public.cfb_research_performance('cfb-verify') verification;
rollback;
