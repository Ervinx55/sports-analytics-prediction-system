-- Contemporaneous final PASS, one immutable final disposition per saved snapshot.
-- New observations can get a new disposition; history import/raw candidate status never calls this RPC.
create function public.publish_mlb_pass_v1(payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare pid uuid; did uuid; p public.performance_predictions; d public.performance_decisions;
 at timestamptz; evaluated timestamptz; expires timestamptz; source text:=payload#>>'{prediction,sourceKey}';
begin
 if payload#>>'{prediction,sport}' is distinct from 'MLB' or payload#>>'{prediction,provenance,legacyReconstructed}' is distinct from 'false'
 or payload#>>'{evidence,status}' is distinct from 'PASS' or payload#>>'{evidence,finalDecision}' is distinct from 'true'
 or payload#>>'{evidence,qualificationVersion}' is distinct from 'mlb-existing-final-gates-v1' then raise exception 'final prospective PASS required';end if;
 pid:=public.ingest_prediction_v1(payload->'prediction');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('decision:'||source||':final',0));
 select * into d from public.performance_decisions where source_key=source||':final';
 if found then
  if d.prediction_id<>pid or d.status<>'PASS' or d.legacy_reconstructed then raise exception 'publication conflict';end if;
 else
  select * into strict p from public.performance_predictions where id=pid;
  at:=clock_timestamp();evaluated:=public.performance_time_v1(payload#>>'{evidence,evaluatedAt}');expires:=public.performance_time_v1(payload#>>'{evidence,decisionExpiresAt}');
  if not p.valid or p.model_mode<>'LIVE' or p.captured_at>at or p.eligibility_starts_at is null or at>=p.eligibility_starts_at or at<p.eligibility_starts_at-interval '20 minutes'
   or evaluated is null or evaluated>at or evaluated<p.captured_at or expires is null or at>=expires or expires>evaluated+interval '30 seconds'
   then raise exception 'PASS lacks contemporary final evaluation';end if;
  did:=public.record_decision_v1(jsonb_build_object('sourceKey',source||':final','predictionId',pid,'issuedAt',at,'status','PASS','qualified',false,'legacyReconstructed',false,'evidence',payload->'evidence'));
  select * into strict d from public.performance_decisions where id=did;
 end if;
 return jsonb_build_object('id',d.id,'prediction_id',d.prediction_id,'issued_at',d.issued_at,'status',d.status,'qualified',d.qualified,'legacy_reconstructed',d.legacy_reconstructed);
end $$;
revoke all on function public.publish_mlb_pass_v1(jsonb) from public,anon,authenticated;
grant execute on function public.publish_mlb_pass_v1(jsonb) to service_role;
