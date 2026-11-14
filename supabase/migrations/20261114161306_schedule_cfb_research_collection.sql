-- Stage inactive; activate only after the validated collector is promoted.
select cron.schedule('cfb-research-collection-10min','8,18,28,38,48,58 * * * *',$job$
 with sent as (
 select net.http_post(
 url:='https://sports-analytics-prediction-system-tau.vercel.app/api/dashboard?cfb=1',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
 (select decrypted_secret from vault.decrypted_secrets where name='performance_service_role_key')),
 body:='{"action":"refresh"}'::jsonb,timeout_milliseconds:=30000) request_id
 where current_date<'2027-02-01'
 ) insert into public.cfb_research_documents(doc_key,body,updated_at)
 select '_scheduled-request',jsonb_build_object('requestID',request_id,'requestedAt',now()),now() from sent
 on conflict(doc_key) do update set body=excluded.body,updated_at=excluded.updated_at;
$job$);
select cron.alter_job(jobid,active:=false) from cron.job where jobname='cfb-research-collection-10min';
