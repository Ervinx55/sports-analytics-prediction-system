
create or replace function public.trigger_sharp_clv_capture()
returns bigint
language sql
security definer
set search_path to 'public','extensions','net','vault','pg_catalog'
as $function$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'snapshot_project_url'
      limit 1
    ) || '/functions/v1/capture-sharp-clv',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'snapshot_publishable_key'
        limit 1
      ),
      'Authorization','Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'snapshot_publishable_key'
        limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$function$;

revoke execute on function public.trigger_sharp_clv_capture() from public, anon, authenticated;
grant execute on function public.trigger_sharp_clv_capture() to service_role;

select cron.schedule(
  'mlb-sharp-clv-10min',
  '*/10 * * * *',
  'select public.trigger_sharp_clv_capture();'
);
