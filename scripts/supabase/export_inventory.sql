-- Read-only Supabase production/local inventory export.
-- Never query vault.decrypted_secrets here.
-- Run the component queries below and assemble the JSON manifest deterministically.

-- Public table structure hashes.
select c.relname as name,
       encode(extensions.digest(convert_to((
         select jsonb_agg(jsonb_build_object(
           'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
           'not_null',a.attnotnull,'default',pg_get_expr(ad.adbin,ad.adrelid)
         ) order by a.attnum)::text
         from pg_attribute a
         left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
         where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
       ),'UTF8'),'sha256'),'hex') as structure_sha256
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
order by c.relname;

-- Views and security-invoker state.
select v.viewname as name,
       encode(extensions.digest(convert_to(pg_get_viewdef(format('%I.%I',v.schemaname,v.viewname)::regclass,true),'UTF8'),'sha256'),'hex') as definition_sha256,
       coalesce((select option_value='true' from pg_options_to_table(c.reloptions) where option_name='security_invoker'),false) as security_invoker
from pg_views v
join pg_class c on c.oid=format('%I.%I',v.schemaname,v.viewname)::regclass
where v.schemaname='public'
order by v.viewname;

-- SQL functions.
select p.proname as name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       p.prosecdef as security_definer,
       encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') as definition_sha256
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
order by p.proname,pg_get_function_identity_arguments(p.oid);

-- Indexes.
select tablename,indexname,
       encode(extensions.digest(convert_to(indexdef,'UTF8'),'sha256'),'hex') as definition_sha256
from pg_indexes
where schemaname='public'
order by tablename,indexname;

-- Extensions.
select extname,extversion from pg_extension order by extname;

-- RLS state.
select c.relname as table_name,c.relrowsecurity as enabled,c.relforcerowsecurity as forced
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
order by c.relname;

-- Grants: compare a deterministic hash, not secret material.
with g as (
 select 'TABLE' object_type,table_schema||'.'||table_name object_identity,grantee,privilege_type privilege
 from information_schema.role_table_grants
 where table_schema='public' and grantee in ('anon','authenticated','service_role')
 union all
 select 'ROUTINE',routine_schema||'.'||routine_name||'('||specific_name||')',grantee,privilege_type
 from information_schema.role_routine_grants
 where routine_schema='public' and grantee in ('anon','authenticated','service_role')
)
select object_type,object_identity,
       encode(extensions.digest(convert_to(string_agg(grantee||':'||privilege,',' order by grantee,privilege),'UTF8'),'sha256'),'hex') as grant_sha256
from g
group by object_type,object_identity
order by object_type,object_identity;

-- Cron: hash command text so credentials/secret lookups never enter Git.
select jobname,schedule,active,
       encode(extensions.digest(convert_to(command,'UTF8'),'sha256'),'hex') as command_sha256
from cron.job
order by jobname;
