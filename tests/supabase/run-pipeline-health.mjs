import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const modulePath = process.argv[2];
if (!modulePath) throw new Error('Pass a local PGlite module path; no database URL is accepted.');
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
const recovered = readFileSync(new URL('../../supabase/migrations/20260923213738_recover_pipeline_health.sql', import.meta.url), 'utf8');
const oldView = recovered.slice(recovered.indexOf('create or replace view'), recovered.indexOf('insert into public.pipeline_component_registry'));
function historyScans(node, counts = []) {
  if (node['Relation Name'] === 'job_run_details') counts.push(node['Actual Loops']);
  for (const child of node.Plans ?? []) historyScans(child, counts);
  return counts;
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema cron; grant usage on schema cron to service_role;
    create table cron.job(jobid bigint primary key, jobname text, active boolean);
    create table cron.job_run_details(runid bigint primary key, jobid bigint, status text, start_time timestamptz, end_time timestamptz, return_message text);
    grant select on all tables in schema cron to service_role;`);
  await db.exec(recovered.slice(0, recovered.indexOf('CREATE OR REPLACE FUNCTION')));
  await db.exec(oldView);
  await db.exec(`begin;
    insert into public.pipeline_component_registry(component_key,display_name,subsystem,job_name,runner_type,expected_interval_minutes,stale_after_minutes,registered_at,enabled)
    select 'c'||i,'Component '||i,'Fixture','job'||i,case when i between 10 and 18 then 'HTTP' else 'DATABASE' end,5,12,
      now()-case when i in (5,10) then interval '1 minute' else interval '2 days' end,i<>1
    from generate_series(1,175) i;
    insert into cron.job select i,'job'||i,i<>3 from generate_series(1,175) i where i<>2;
    insert into cron.job_run_details
    select i*1000+k,i,case when k%10=0 then 'failed' else 'succeeded' end,
      now()-interval '2 days'-k*interval '1 minute',now()-interval '2 days',null
    from generate_series(1,175) i cross join generate_series(1,500) k;
    delete from cron.job_run_details where jobid in (4,5);
    insert into cron.job_run_details
    select 1000000+i,i,case when i=6 then 'failed' when i=7 then null else 'succeeded' end,
      now()-case when i=8 then interval '13 minutes' when i=22 then interval '12 minutes' else interval '1 minute' end,now(),null
    from generate_series(1,175) i where i not in (4,5);
    insert into cron.job_run_details values
      (2000001,20,'failed',now()-interval '24 hours',now(),null),
      (2000002,20,'failed',now()-interval '24 hours'-interval '1 microsecond',now(),null),
      (2000003,20,'success',now()-interval '24 hours'+interval '1 microsecond',now(),null),
      (2000004,21,'failed',null,null,null);
    insert into public.pipeline_http_request_log(request_id,component_key,enqueued_at,reconciled_at,response_ok,status_code,error_msg,timed_out)
    select i,'c'||i,now()-case when i=12 then interval '3 minutes' when i=13 then interval '3 minutes 1 microsecond' when i=16 then interval '13 minutes' when i=17 then interval '12 minutes' else interval '1 minute' end,
      case when i in (12,13) then null else now() end,case when i=14 then false when i=15 then null else true end,
      case when i=14 then 500 else 200 end,case when i=14 then 'fixture error' else null end,i=14
    from generate_series(12,18) i;
    analyze cron.job_run_details;
    create temp table expected as select * from public.pipeline_component_health_v1;`);
  const historyRows = (await db.query('select count(*)::int n from cron.job_run_details')).rows[0].n;
  const originalPlan = (await db.query('explain (analyze, format json) select * from public.pipeline_component_health_v1')).rows[0]['QUERY PLAN'][0].Plan;
  if (!process.argv.includes('--baseline')) await db.exec(readFileSync(new URL('../../supabase/migrations/20261009000000_pipeline_health_set_based.sql', import.meta.url), 'utf8'));
  const diff = await db.query(`select * from ((select * from expected except all select * from public.pipeline_component_health_v1) union all (select * from public.pipeline_component_health_v1 except all select * from expected)) d`);
  assert.equal(diff.rows.length, 0, 'all view columns and duplicate multiplicity must match');
  const statuses = new Set((await db.query('select health_status from expected')).rows.map(r=>r.health_status));
  for (const status of ['MISSING_JOB','CRON_DISABLED','WARMING_UP','NEVER_RAN','CRON_FAILED','CRON_STALE','HTTP_NOT_OBSERVED','HTTP_PENDING','HTTP_NO_RESPONSE','HTTP_FAILED','HTTP_STALE','HEALTHY']) assert.ok(statuses.has(status), status);
  assert.equal((await db.query("select count(*)::int n from expected where component_key='c1'")).rows[0].n,0);
  assert.equal((await db.query("select cron_runs_24h n from expected where component_key='c20'")).rows[0].n,3);
  for (const key of ['c17','c22']) assert.equal((await db.query('select health_status from expected where component_key=$1',[key])).rows[0].health_status,'HEALTHY', 'freshness boundary is inclusive');
  assert.equal((await db.query("select cron_failed_runs_24h n from expected where component_key='c20'")).rows[0].n,2, 'success alias remains a failure in the component view');
  const plan = (await db.query('explain (analyze, format json) select * from public.pipeline_component_health_v1')).rows[0]['QUERY PLAN'][0].Plan;
  assert.deepEqual(historyScans(plan), [1,1], 'history must be scanned once for latest and once for 24h stats');
  const security = (await db.query(`select reloptions, has_table_privilege('anon','public.pipeline_component_health_v1','select') a, has_table_privilege('authenticated','public.pipeline_component_health_v1','select') u, has_table_privilege('service_role','public.pipeline_component_health_v1','select') s from pg_class where oid='public.pipeline_component_health_v1'::regclass`)).rows[0];
  assert.ok(security.reloptions.includes('security_invoker=true')); assert.equal(security.a,false); assert.equal(security.u,false); assert.equal(security.s,true);
  await db.exec('set local role service_role');
  assert.equal((await db.query('select count(*)::int n from public.pipeline_component_health_v1')).rows[0].n,174);
  await db.exec('reset role; revoke select on cron.job_run_details from service_role; set local role service_role');
  await assert.rejects(db.query('select * from public.pipeline_component_health_v1'), e => e.code === '42501');
  await db.exec('rollback');
  console.log(JSON.stringify({historyRows,originalHistoryScanLoops:historyScans(originalPlan),repairedHistoryScanLoops:historyScans(plan),originalCost:originalPlan['Total Cost'],repairedCost:plan['Total Cost'],originalMs:originalPlan['Actual Total Time'],repairedMs:plan['Actual Total Time']}));
  console.log('Pipeline health equivalence, boundary, actual-plan and invoker/grant assertions passed.');
} catch (e) { console.error(e); process.exitCode=1; } finally { await db.close(); }
