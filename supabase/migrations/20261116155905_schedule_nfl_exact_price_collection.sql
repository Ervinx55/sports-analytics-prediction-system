-- Scheduled evidence capture only: no model fitting, approval, or outcome writes.
select cron.schedule('nfl-exact-price-collection-30min','12,42 * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='snapshot_project_url')||'/functions/v1/collect-nfl-prices',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='performance_service_role_key')),
  body:='{}'::jsonb,timeout_milliseconds:=150000)
 where current_date<'2027-02-15';
$job$);
