
create or replace function public.cleanup_sharp_source_quotes()
returns bigint
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  deleted_count bigint;
begin
  delete from public.sharp_source_quotes
  where observed_at < now() - interval '14 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

revoke execute on function public.cleanup_sharp_source_quotes() from public, anon, authenticated;
grant execute on function public.cleanup_sharp_source_quotes() to service_role;

select cron.schedule(
  'sharp-source-retention-daily',
  '15 9 * * *',
  'select public.cleanup_sharp_source_quotes();'
);
