-- Publication and import are service-only transactions. No GET writes.
create function public.publish_mlb_performance_v1(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare prediction_id uuid; decision_id uuid; existing public.performance_decisions; source_identity text := payload#>>'{prediction,sourceKey}';
begin
 if payload#>>'{prediction,sport}' is distinct from 'MLB' or payload#>>'{evidence,finalQualification}' is distinct from 'true' or payload#>>'{evidence,status}' is distinct from 'PLAY' then raise exception 'complete MLB final qualification required' using errcode='23514'; end if;
 prediction_id := public.ingest_prediction_v1(payload->'prediction');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('decision:' || source_identity || ':final',0));
 select * into existing from public.performance_decisions where performance_decisions.source_key = source_identity || ':final';
 if found then
  if existing.prediction_id <> prediction_id or not existing.qualified or existing.legacy_reconstructed then raise exception 'publication conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',existing.id,'prediction_id',existing.prediction_id,'issued_at',existing.issued_at,'status',existing.status,'qualified',existing.qualified,'legacy_reconstructed',existing.legacy_reconstructed);
 end if;
 decision_id := public.record_decision_v1(jsonb_build_object('sourceKey',source_identity || ':final','predictionId',prediction_id,'issuedAt',payload->>'issuedAt','status','PLAY','qualified',true,'evidence',payload->'evidence','legacyReconstructed',false));
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
