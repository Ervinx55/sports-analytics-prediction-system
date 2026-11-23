-- Coordinate these scheduler credentials before deploying the four service-role
-- handler guards. One DO statement makes every preflight/replacement/postflight
-- atomic. This migration sends no HTTP requests, changes no schedules and
-- enables no registry entries. Existing successful gateway-verified service-role
-- scheduler calls establish credential authenticity; the checks below are
-- fail-closed configuration validation, not JWT signature verification.
DO $migration$
DECLARE
  v_expected jsonb := $expected$[
  {
    "identity": "public.trigger_closing_snapshot()",
    "before_sha256": "0241062ecde28075b4ec24dd63cd9f2f62aa36259d470b1619a09a4ff52abdc7",
    "after_sha256": "21a58a096f7437214a6bc80b58c694a172acbb2a4f7091565e43c63bf658335a"
  },
  {
    "identity": "public.trigger_league_snapshot(text,text,integer)",
    "before_sha256": "cf3b377d0eb8afb4c9a3252fb47d65a979b6cce1dfb35d9cde2d401dee114f95",
    "after_sha256": "53ffbae5f25966a1677717dbeb206b3eb741c877b43c1dd7df260ef2319f0dd1"
  },
  {
    "identity": "public.trigger_market_snapshot(text)",
    "before_sha256": "4f0944b3760afbab0ffb8cf6ec00022db4800a76af14bb0b6f535dbde9daba5a",
    "after_sha256": "4a13425c754b94c45c7581f5373b432e8d27d0bad1a7b1dfa942969ae31dc94f"
  },
  {
    "identity": "public.trigger_model_grading()",
    "before_sha256": "8257aa27d1a04c2d5305b7b93c43cd180b32ffb44312b49d9b43142acaccc0f1",
    "after_sha256": "1eebf5f7b1f7e7356764b186c649aa32794e3854bfb1dca6a9905d8f0a52c6f9"
  },
  {
    "identity": "public.trigger_pitchmix_feature_capture()",
    "before_sha256": "b834cc838cb51bd4bcfabfa577ef102e1759959c3674958a3697a7e5caf14acd",
    "after_sha256": "dcb61e0cd0b3a64c4cbe1b801ff24c3d4ad1c4827947e1ce1a82b7a163142dfa"
  },
  {
    "identity": "public.trigger_sharp_disagreement_shadow()",
    "before_sha256": "249b205cc9f12ac4f1b1eb2629e31dc3d9f887238ec8f566c184d5ebf16b7adb",
    "after_sha256": "5a1f7b405186308d18649e36d8effce73045badc2358d4552706bbbf11109265"
  }
]$expected$::jsonb;
  v_entry jsonb;
  v_current record;
  v_oid oid;
  v_count bigint;
  v_origin text;
  v_key text;
  v_segment text;
  v_header jsonb;
  v_claims jsonb;
BEGIN
  perform pg_advisory_xact_lock(hashtextextended('edge-lab:active-scheduler-authorization', 0));

  select count(*), min(decrypted_secret) into v_count, v_origin
  from vault.decrypted_secrets where name = 'snapshot_project_url';
  if v_count <> 1 or v_origin is null or v_origin not in (
    'https://yeoxroijaptomomshdii.supabase.co',
    'https://yeoxroijaptomomshdii.supabase.co/'
  ) then
    raise exception 'Scheduler origin preflight refused';
  end if;

  select count(*), min(decrypted_secret) into v_count, v_key
  from vault.decrypted_secrets where name = 'performance_service_role_key';
  if v_count <> 1 or v_key is null or length(v_key) > 8192
     or v_key !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
    raise exception 'Scheduler service credential preflight refused';
  end if;
  begin
    v_segment := translate(split_part(v_key, '.', 1), '-_', '+/');
    v_header := convert_from(decode(rpad(v_segment, ((length(v_segment)+3)/4)*4, '='), 'base64'), 'UTF8')::jsonb;
    v_segment := translate(split_part(v_key, '.', 2), '-_', '+/');
    v_claims := convert_from(decode(rpad(v_segment, ((length(v_segment)+3)/4)*4, '='), 'base64'), 'UTF8')::jsonb;
  exception when others then
    raise exception 'Scheduler service credential encoding preflight refused';
  end;
  if jsonb_typeof(v_header) is distinct from 'object'
     or jsonb_typeof(v_claims) is distinct from 'object'
     or coalesce(v_header->>'alg', '') <> all(array['HS256','ES256','RS256'])
     or v_claims->>'role' is distinct from 'service_role'
     or v_claims->>'ref' is distinct from 'yeoxroijaptomomshdii'
     or v_claims->>'iss' is distinct from 'supabase'
     or jsonb_typeof(v_claims->'exp') is distinct from 'number'
     or not coalesce((v_claims->>'exp') ~ '^[0-9]{1,12}$', false) then
    raise exception 'Scheduler service credential claims preflight refused';
  end if;
  if (v_claims->>'exp')::numeric <= extract(epoch from clock_timestamp()) + 86400 then
    raise exception 'Scheduler service credential expiry preflight refused';
  end if;
  v_key := null; v_header := null; v_claims := null; v_segment := null;

  if to_regprocedure('public.edge_lab_scheduler_origin_v1()') is not null then
    raise exception 'Scheduler origin helper already exists; review required';
  end if;
  -- All six definitions and their complete ACLs are checked before any DDL.
  for v_entry in select value from jsonb_array_elements(v_expected) loop
    v_oid := to_regprocedure(v_entry->>'identity');
    if v_oid is null then raise exception 'Scheduler wrapper preflight refused: missing function'; end if;
    select encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') as source_hash,
      pg_get_userbyid(proowner) as owner_name, proacl::text as acl,
      prosecdef, proconfig into v_current from pg_proc where oid = v_oid;
    if v_current.source_hash is distinct from v_entry->>'before_sha256'
       or v_current.owner_name is distinct from 'postgres'
       or v_current.acl is distinct from '{postgres=X/postgres,service_role=X/postgres}'
       or v_current.prosecdef is distinct from true
       or v_current.proconfig is distinct from array['search_path=public, extensions, net, vault, pg_catalog']::text[]
       or has_function_privilege('anon',v_oid,'EXECUTE')
       or has_function_privilege('authenticated',v_oid,'EXECUTE')
       or not has_function_privilege('service_role',v_oid,'EXECUTE') then
      raise exception 'Scheduler wrapper source or privilege preflight refused';
    end if;
  end loop;

  execute $origin_definition$
CREATE FUNCTION public.edge_lab_scheduler_origin_v1()
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'vault'
AS $origin$
DECLARE
  origin_count bigint;
  configured_origin text;
BEGIN
  select count(*), min(decrypted_secret) into origin_count, configured_origin
  from vault.decrypted_secrets where name = 'snapshot_project_url';
  if origin_count <> 1 or configured_origin is null or configured_origin not in (
    'https://yeoxroijaptomomshdii.supabase.co',
    'https://yeoxroijaptomomshdii.supabase.co/'
  ) then
    raise exception 'Scheduler origin refused';
  end if;
  return 'https://yeoxroijaptomomshdii.supabase.co';
END;
$origin$
  $origin_definition$;
  alter function public.edge_lab_scheduler_origin_v1() owner to postgres;
  revoke execute on function public.edge_lab_scheduler_origin_v1() from public, anon, authenticated;
  grant execute on function public.edge_lab_scheduler_origin_v1() to service_role;

  execute $wrapper_definition$
CREATE OR REPLACE FUNCTION public.trigger_closing_snapshot()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'vault', 'pg_catalog'
AS $function$
  select net.http_post(
    url := public.edge_lab_scheduler_origin_v1() || '/functions/v1/capture-market-snapshot',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'performance_service_role_key'
        limit 1
      ),
      'Authorization','Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'performance_service_role_key'
        limit 1
      )
    ),
    body := jsonb_build_object(
      'label','closing-window',
      'leagues',jsonb_build_array('MLB'),
      'books',jsonb_build_array('draftkings','fanduel','betmgm','caesars'),
      'startsAfter', now()::text,
      'startsBefore', (now() + interval '75 minutes')::text
    ),
    timeout_milliseconds := 60000
  );
$function$
  $wrapper_definition$;

  execute $wrapper_definition$
CREATE OR REPLACE FUNCTION public.trigger_league_snapshot(p_league text, p_label text, p_window_hours integer)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'vault', 'pg_catalog'
AS $function$
  select net.http_post(
    url := public.edge_lab_scheduler_origin_v1() || '/functions/v1/capture-market-snapshot',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'performance_service_role_key'
        limit 1
      ),
      'Authorization','Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'performance_service_role_key'
        limit 1
      )
    ),
    body := jsonb_build_object(
      'label', p_label,
      'leagues', jsonb_build_array(p_league),
      'books', jsonb_build_array('draftkings','fanduel','betmgm','caesars'),
      'startsAfter', now()::text,
      'startsBefore', (now() + make_interval(hours => p_window_hours))::text
    ),
    timeout_milliseconds := 60000
  );
$function$
  $wrapper_definition$;

  execute $wrapper_definition$
CREATE OR REPLACE FUNCTION public.trigger_market_snapshot(p_label text)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'vault', 'pg_catalog'
AS $function$
  select net.http_post(
    url := public.edge_lab_scheduler_origin_v1() || '/functions/v1/capture-market-snapshot',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'performance_service_role_key'
        limit 1
      ),
      'Authorization','Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'performance_service_role_key'
        limit 1
      )
    ),
    body := jsonb_build_object(
      'label', p_label,
      'leagues', jsonb_build_array('MLB'),
      'books', jsonb_build_array('draftkings','fanduel','betmgm','caesars'),
      'startsAfter',
        (date_trunc('day', now() at time zone 'America/Chicago')
          at time zone 'America/Chicago')::text,
      'startsBefore',
        ((date_trunc('day', now() at time zone 'America/Chicago') + interval '1 day')
          at time zone 'America/Chicago')::text
    ),
    timeout_milliseconds := 30000
  );
$function$
  $wrapper_definition$;

  execute $wrapper_definition$
CREATE OR REPLACE FUNCTION public.trigger_model_grading()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'vault', 'pg_catalog'
AS $function$
  select net.http_post(
    url := public.edge_lab_scheduler_origin_v1() || '/functions/v1/grade-model-audit',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'performance_service_role_key'
        limit 1
      ),
      'Authorization','Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'performance_service_role_key'
        limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$function$
  $wrapper_definition$;

  execute $wrapper_definition$
CREATE OR REPLACE FUNCTION public.trigger_pitchmix_feature_capture()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'vault', 'pg_catalog'
AS $function$
  select net.http_post(
    url := public.edge_lab_scheduler_origin_v1() || '/functions/v1/capture-pitchmix-features',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'performance_service_role_key'
        limit 1
      ),
      'Authorization','Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'performance_service_role_key'
        limit 1
      )
    ),
    body := '{"limit":4}'::jsonb,
    timeout_milliseconds := 60000
  );
$function$
  $wrapper_definition$;

  execute $wrapper_definition$
CREATE OR REPLACE FUNCTION public.trigger_sharp_disagreement_shadow()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'vault', 'pg_catalog'
AS $function$
  select net.http_post(
    url := public.edge_lab_scheduler_origin_v1() || '/functions/v1/refresh-sharp-disagreement-shadow',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(
        select decrypted_secret from vault.decrypted_secrets
        where name='performance_service_role_key' limit 1
      ),
      'Authorization','Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name='performance_service_role_key' limit 1
      )
    ),
    body := '{"hours":48}'::jsonb,
    timeout_milliseconds := 60000
  );
$function$
  $wrapper_definition$;

  -- POSTFLIGHT: all six replacements must preserve privileges.
  for v_entry in select value from jsonb_array_elements(v_expected) loop
    v_oid := to_regprocedure(v_entry->>'identity');
    select encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') as source_hash,
      pg_get_userbyid(proowner) as owner_name, proacl::text as acl,
      prosecdef, proconfig into v_current from pg_proc where oid = v_oid;
    if v_current.source_hash is distinct from v_entry->>'after_sha256'
       or v_current.owner_name is distinct from 'postgres'
       or v_current.acl is distinct from '{postgres=X/postgres,service_role=X/postgres}'
       or v_current.prosecdef is distinct from true
       or v_current.proconfig is distinct from array['search_path=public, extensions, net, vault, pg_catalog']::text[]
       or has_function_privilege('anon',v_oid,'EXECUTE')
       or has_function_privilege('authenticated',v_oid,'EXECUTE')
       or not has_function_privilege('service_role',v_oid,'EXECUTE') then
      raise exception 'Scheduler wrapper postflight refused';
    end if;
  end loop;
  if has_function_privilege('anon','public.edge_lab_scheduler_origin_v1()','EXECUTE')
     or has_function_privilege('authenticated','public.edge_lab_scheduler_origin_v1()','EXECUTE')
     or not has_function_privilege('service_role','public.edge_lab_scheduler_origin_v1()','EXECUTE') then
    raise exception 'Scheduler origin helper privilege postflight refused';
  end if;
END;
$migration$;
