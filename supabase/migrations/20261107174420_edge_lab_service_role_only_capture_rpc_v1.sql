create or replace function public.edge_lab_prop_ingest_v1(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_count integer;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
  if v_role is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    raise exception 'INVALID_ARCHIVE_BATCH' using errcode = '22023';
  end if;
  with validated as (
    select * from jsonb_to_recordset(p_rows) as r(
      sport text, event_id text, event_starts_at timestamptz,
      player_id text, player_name text, stat_id text, side text,
      line numeric, book text, american_odds integer, source text,
      source_quote_at timestamptz, model_version text,
      pregame_model_probability numeric, prediction_observed_at timestamptz,
      is_production_model boolean, provenance text, raw jsonb)
    where event_starts_at > now()
      and source_quote_at <= now()
      and source_quote_at > now() - interval '15 minutes'
      and event_id is not null and player_id is not null
      and length(event_id)>0 and length(player_id)>0
      and line >= 0 and (american_odds <= -100 or american_odds>=100)
      and sport in ('NBA','NFL')
      and side in ('over','under')
  ), inserted as (
    insert into edge_lab.prop_market_capture(
      sport,event_id,event_starts_at,player_id,player_name,stat_id,
      side,line,book,american_odds,source,source_quote_at,
      model_version,pregame_model_probability,prediction_observed_at,
      is_production_model,provenance,raw
    )
    select sport,event_id,event_starts_at,player_id,player_name,stat_id,
      side,line,book,american_odds,source,source_quote_at,
      null,null,null,false,coalesce(provenance,'LIVE_PROVIDER_OBSERVATION'),
      coalesce(raw,'{}'::jsonb)
    from validated
    on conflict do nothing returning 1
  )
  select count(*) into v_count from inserted;
  return jsonb_build_object('inserted',v_count);
end;
$$;
revoke all on function public.edge_lab_prop_ingest_v1(jsonb) from public, anon,authenticated;
grant execute on function public.edge_lab_prop_ingest_v1(jsonb) to service_role;