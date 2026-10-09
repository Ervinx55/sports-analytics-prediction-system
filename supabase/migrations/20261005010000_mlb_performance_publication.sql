-- Use wall-clock future validation when a caller records an actual issuance after locks.
-- All other Task 1 decision validation and immutable/idempotent behavior is unchanged.
create or replace function public.record_decision_v1(payload jsonb) returns uuid language plpgsql security invoker set search_path = '' as $$
declare p jsonb := payload; prediction public.performance_predictions; existing public.performance_decisions; result uuid;
 issued timestamptz := public.performance_time_v1(p->>'issuedAt'); qualified boolean := coalesce(p->>'qualified' = 'true',false);
 first_play boolean := false; legacy boolean := coalesce(p->>'legacyReconstructed' = 'true',false); minutes numeric; max_age integer;
begin
 if nullif(p->>'sourceKey','') is null or issued is null then raise exception 'decision identity/time required' using errcode='23514'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('decision:' || (p->>'sourceKey'),0));
 select * into existing from public.performance_decisions where source_key = p->>'sourceKey';
 if found then if existing.payload <> p then raise exception 'decision sourceKey conflict' using errcode='23505'; end if; return existing.id; end if;
 select * into strict prediction from public.performance_predictions where id = (p->>'predictionId')::uuid;
 minutes := extract(epoch from (prediction.eligibility_starts_at-issued))/60;
 max_age := case when minutes <=20 then 2 when minutes <=90 then 5 when minutes <=360 then 15 else 30 end;
 if p->>'status' = 'PLAY' and (prediction.odds is null or abs(prediction.odds) < 100 or nullif(prediction.book,'') is null or not prediction.valid or issued < prediction.captured_at or issued >= prediction.eligibility_starts_at or issued > clock_timestamp() or prediction.quote_at is null or prediction.quote_at > issued or issued - prediction.quote_at > make_interval(mins => max_age) or p#>>'{evidence,finalQualification}' is distinct from 'true') then raise exception 'PLAY lacks contemporaneous complete qualification' using errcode='23514'; end if;
 if qualified and (p->>'status' <> 'PLAY' or prediction.model_mode <> 'LIVE') then raise exception 'qualified PLAY requires LIVE model' using errcode='23514'; end if;
 if p->>'status' = 'PLAY' and qualified and not legacy then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portfolio:' || prediction.market_key,0));
  select d.id into result from public.performance_decisions d where d.market_key = prediction.market_key and d.status='PLAY' and d.qualified and not d.legacy_reconstructed;
  first_play := not found;
 end if;
 insert into public.performance_decisions(source_key,prediction_id,market_key,issued_at,status,qualified,evidence,legacy_reconstructed,first_issued,payload)
 values(p->>'sourceKey',prediction.id,prediction.market_key,issued,p->>'status',qualified,coalesce(p->'evidence','{}'),legacy,first_play,p) returning id into result;
 return result;
end $$;
-- Publication and import are service-only transactions. No GET writes.
create function public.publish_mlb_performance_v1(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare prediction_id uuid; decision_id uuid; prediction_row public.performance_predictions;
 publication_at timestamptz; publication_iso text; minutes numeric; max_age integer; qualification_expires timestamptz; existing public.performance_decisions; source_identity text := payload#>>'{prediction,sourceKey}';
begin
 if payload#>>'{prediction,sport}' is distinct from 'MLB' or payload#>>'{evidence,finalQualification}' is distinct from 'true' or payload#>>'{evidence,status}' is distinct from 'PLAY' then raise exception 'complete MLB final qualification required' using errcode='23514'; end if;
 prediction_id := public.ingest_prediction_v1(payload->'prediction');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('decision:' || source_identity || ':final',0));
 select * into existing from public.performance_decisions where performance_decisions.source_key = source_identity || ':final';
 if found then
  if existing.prediction_id <> prediction_id or not existing.qualified or existing.legacy_reconstructed then raise exception 'publication conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',existing.id,'prediction_id',existing.prediction_id,'issued_at',existing.issued_at,'status',existing.status,'qualified',existing.qualified,'legacy_reconstructed',existing.legacy_reconstructed);
 end if;
 -- record_decision_v1 also acquires the portfolio lock. Take it now so no lock
 -- wait can move a NEW issuance past the guards below. Existing retries returned above.
 select * into strict prediction_row from public.performance_predictions where id=prediction_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portfolio:' || prediction_row.market_key,0));
 publication_at := clock_timestamp();
 if prediction_row.eligibility_starts_at is null or publication_at >= prediction_row.eligibility_starts_at then
  raise exception 'publication time reached event start' using errcode='23514';
 end if;
 minutes := extract(epoch from (prediction_row.eligibility_starts_at-publication_at))/60;
 max_age := case when minutes <=20 then 2 when minutes <=90 then 5 when minutes <=360 then 15 else 30 end;
 if prediction_row.quote_at is null or prediction_row.quote_at > publication_at or publication_at-prediction_row.quote_at > make_interval(mins=>max_age) then
  raise exception 'publication quote freshness expired' using errcode='23514';
 end if;
 qualification_expires := public.performance_time_v1(payload#>>'{evidence,qualificationExpiresAt}');
 if payload#>'{evidence,freshness}' is not null and (qualification_expires is null or publication_at >= qualification_expires) then
  raise exception 'publication final-check freshness expired' using errcode='23514';
 end if;
 publication_iso := to_char(publication_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 decision_id := public.record_decision_v1(jsonb_build_object(
  'sourceKey',source_identity || ':final','predictionId',prediction_id,'issuedAt',publication_iso,
  'status','PLAY','qualified',true,
  'evidence',(payload->'evidence') || jsonb_build_object('publicationClockAt',publication_iso,'quoteAgeMinutes',extract(epoch from (publication_at-prediction_row.quote_at))/60),
  'legacyReconstructed',false));
 select * into strict existing from public.performance_decisions where id=decision_id;
 return jsonb_build_object('id',existing.id,'prediction_id',existing.prediction_id,'issued_at',existing.issued_at,'status',existing.status,'qualified',existing.qualified,'legacy_reconstructed',existing.legacy_reconstructed);
end $$;
create table public.performance_import_cursors (
 source_table text primary key check(source_table in ('model_audit_observations','market_grade_observations','player_prop_observations')),
 last_id bigint not null default 0, imported_count bigint not null default 0, complete boolean not null default false,
 updated_at timestamptz not null default current_timestamp
);
alter table public.performance_import_cursors enable row level security;
revoke all on public.performance_import_cursors from public,anon,authenticated,service_role;
grant select,insert,update on public.performance_import_cursors to service_role;
create function public.import_mlb_performance_page_v1(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare table_name text := payload->>'table'; checkpoint public.performance_import_cursors; p jsonb; count_rows integer := 0; page_last_id bigint := (payload->>'cursor')::bigint;
begin
 if table_name not in ('model_audit_observations','market_grade_observations','player_prop_observations') or jsonb_typeof(payload->'predictions') is distinct from 'array' or jsonb_array_length(payload->'predictions') > 500 then raise exception 'invalid import page' using errcode='23514'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mlb-import:' || table_name,0));
 insert into public.performance_import_cursors(source_table) values(table_name) on conflict do nothing;
 select * into strict checkpoint from public.performance_import_cursors where source_table=table_name;
 if checkpoint.last_id <> page_last_id or checkpoint.complete then raise exception 'import cursor conflict' using errcode='23505'; end if;
 for p in select value from jsonb_array_elements(payload->'predictions') loop
  if p->>'sourceKey' is distinct from table_name || ':' || (p#>>'{sourceIds,observation}') or p#>>'{sourceIds,table}' is distinct from table_name or (p#>>'{sourceIds,observation}')::bigint <= page_last_id then raise exception 'invalid ordered observation' using errcode='23514'; end if;
  perform public.ingest_prediction_v1(p); page_last_id := (p#>>'{sourceIds,observation}')::bigint; count_rows := count_rows+1;
 end loop;
 if page_last_id <> (payload->>'nextCursor')::bigint or coalesce((payload->>'complete')::boolean,false) is distinct from (count_rows < 500) then raise exception 'invalid completion/cursor' using errcode='23514'; end if;
 update public.performance_import_cursors set last_id=page_last_id,imported_count=checkpoint.imported_count+count_rows,complete=(payload->>'complete')::boolean,updated_at=current_timestamp where source_table=table_name;
 return jsonb_build_object('table',table_name,'nextCursor',page_last_id,'count',count_rows,'importedCount',checkpoint.imported_count+count_rows,'complete',(payload->>'complete')::boolean);
end $$;
revoke all on function public.publish_mlb_performance_v1(jsonb),public.import_mlb_performance_page_v1(jsonb) from public,anon,authenticated;
grant execute on function public.publish_mlb_performance_v1(jsonb),public.import_mlb_performance_page_v1(jsonb) to service_role;
