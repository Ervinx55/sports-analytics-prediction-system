-- Hosted Supabase prerequisite recovered from production.
-- Local Supabase does not currently provision public.rls_auto_enable(), but the
-- exact historical migration chain expects it to exist before 20260923061150.
-- This file is loaded by the local stack before migrations and is not a
-- production migration.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
     if cmd.schema_name is not null
        and cmd.schema_name in ('public')
        and cmd.schema_name not in ('pg_catalog','information_schema')
        and cmd.schema_name not like 'pg_toast%'
        and cmd.schema_name not like 'pg_temp%'
     then
      begin
        execute format(
          'alter table if exists %s enable row level security',
          cmd.object_identity
        );
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
     else
        raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
          cmd.object_identity, cmd.schema_name;
     end if;
  end loop;
end;
$function$;


-- Application scheduler functions that existed in the hosted project before the
-- recorded migration history began. These signature-compatible stubs exist
-- only so the historical hardening migrations can revoke/grant EXECUTE.
-- Later catch-up migrations replace them with the exact current definitions.

create or replace function public.trigger_closing_snapshot()
returns bigint
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select 0::bigint;
$function$;

create or replace function public.trigger_league_snapshot(
  p_league text,
  p_label text,
  p_window_hours integer
)
returns bigint
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select 0::bigint;
$function$;

create or replace function public.trigger_market_snapshot(p_label text)
returns bigint
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select 0::bigint;
$function$;

create or replace function public.trigger_model_audit()
returns bigint
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select 0::bigint;
$function$;

create or replace function public.trigger_model_grading()
returns bigint
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select 0::bigint;
$function$;

create or replace function public.trigger_player_prop_capture()
returns bigint
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select 0::bigint;
$function$;

create or replace function public.trigger_player_prop_grading()
returns bigint
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select 0::bigint;
$function$;

create or replace function public.trigger_team_market_grading()
returns bigint
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select 0::bigint;
$function$;
