-- Offset first invocation to the next minute; repeats every 15 minutes thereafter.
-- Existing paused legacy jobs are not changed. No credentials are embedded.
select cron.schedule('nba-prop-research-15min',
 format('%s-59/15 * * * *',(extract(minute from now())::integer+1)%15),
 $job$select net.http_post(
 url:=(select decrypted_secret from vault.decrypted_secrets where name='snapshot_project_url')||'/functions/v1/collect-nba-props',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='performance_service_role_key')),
 body:='{}'::jsonb,timeout_milliseconds:=150000);$job$);


