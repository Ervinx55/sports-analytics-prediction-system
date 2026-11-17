-- Stage inactive; activate only after the validated collector is promoted.
select cron.schedule('winner-research-collection-10min','3,13,23,33,43,53 * * * *',$job$
 select net.http_post(
 url:='https://sports-analytics-prediction-system-tau.vercel.app/api/dashboard?winnerCapture=1',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
 (select decrypted_secret from vault.decrypted_secrets where name='performance_service_role_key')),
 body:='{"action":"refresh"}'::jsonb,timeout_milliseconds:=35000);
$job$);
select cron.alter_job(jobid,active:=false) from cron.job where jobname='winner-research-collection-10min';
