-- Forward-only receipt ownership. Source payloads stay immutable across kickoff retries.
create function public.ingest_sport_prediction_v1(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
 p jsonb := payload;
 existing public.performance_predictions;
 expected jsonb;
 receipt timestamptz;
 cutoff timestamptz;
 canonical_start timestamptz;
 source_sport text := p->>'sport';
 source_event text := p->>'eventKey';
 reasons jsonb;
 post_start boolean;
 result uuid;
begin
 if jsonb_typeof(p) <> 'object' or nullif(btrim(p->>'sourceKey'),'') is null then raise exception 'sourceKey required' using errcode='23514'; end if;
 if (p->'provenance') ? 'captureReceipt' or (p->'eligibilityReasons') @> '["POST_START_RECEIPT"]'::jsonb then raise exception 'reserved receipt metadata' using errcode='23514'; end if;
 if jsonb_typeof(p->'provenance') is distinct from 'object' or jsonb_typeof(p->'eligibilityReasons') is distinct from 'array' then raise exception 'normalized source metadata required' using errcode='23514'; end if;
 if source_sport is distinct from 'NFL' or p->>'modelMode' is distinct from 'SHADOW' then raise exception 'unsupported sport capture source' using errcode='23514'; end if;
 -- Same lock and source identity as the unchanged canonical ingestion contract.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prediction:' || (p->>'sourceKey'),0));
 select * into existing from public.performance_predictions where source_key=p->>'sourceKey';
 if found then
  expected := existing.payload;
  if expected#>>'{provenance,captureReceipt,owner}' = 'ingest_sport_prediction_v1' then
   if expected#>>'{provenance,captureReceipt,postStart}' = 'true' then
    select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into reasons
     from jsonb_array_elements(expected->'eligibilityReasons') with ordinality where value <> '"POST_START_RECEIPT"'::jsonb;
    expected := jsonb_set(expected,'{eligibilityReasons}',reasons);
   end if;
   expected := expected #- '{provenance,captureReceipt}';
  end if;
  if expected <> p then raise exception 'sourceKey payload conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',existing.id,'eligibilityReasons',existing.eligibility_reasons,'captureReceipt',existing.provenance->'captureReceipt');
 end if;
 -- Preserve lock order source -> external mapping -> canonical event.
 if nullif(p#>>'{sourceIds,provider}','') is not null and nullif(p#>>'{sourceIds,event}','') is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mapping:' || jsonb_build_array(source_sport,p#>>'{sourceIds,provider}',p#>>'{sourceIds,event}')::text,0));
 end if;
 if nullif(source_event,'') is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('event:' || source_sport || ':' || source_event,0));
  select eligibility_starts_at into canonical_start from public.performance_events where performance_events.sport=source_sport and event_key=source_event;
 end if;
 cutoff := least(public.performance_time_v1(p->>'startsAt'),public.performance_time_v1(p->>'eligibilityStartsAt'),canonical_start);
 receipt := clock_timestamp();
 post_start := cutoff is not null and receipt >= cutoff;
 reasons := coalesce(p->'eligibilityReasons','[]'::jsonb);
 if post_start then reasons := reasons || '["POST_START_RECEIPT"]'::jsonb; end if;
 p := jsonb_set(p,'{eligibilityReasons}',reasons);
 p := jsonb_set(p,'{provenance}',coalesce(p->'provenance','{}'::jsonb) || jsonb_build_object('captureReceipt',jsonb_build_object('owner','ingest_sport_prediction_v1','receivedAt',receipt,'cutoffAt',cutoff,'postStart',post_start)));
 result := public.ingest_prediction_v1(p);
 select * into existing from public.performance_predictions where id=result;
 return jsonb_build_object('id',existing.id,'eligibilityReasons',existing.eligibility_reasons,'captureReceipt',existing.provenance->'captureReceipt');
end $$;
revoke all on function public.ingest_sport_prediction_v1(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_sport_prediction_v1(jsonb) to service_role;
