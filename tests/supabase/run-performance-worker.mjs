import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
if(!['127.0.0.1','localhost','::1'].includes(process.env.PGHOST)||!process.env.PGPORT||!process.env.PGUSER||!process.env.PGPASSWORD_FILE)throw Error('Explicit loopback fixture only');
const {default:postgres}=await import(pathToFileURL(resolve(process.argv[2])).href);
const config={host:process.env.PGHOST,port:Number(process.env.PGPORT),username:process.env.PGUSER,password:readFileSync(process.env.PGPASSWORD_FILE,'utf8').trim(),max:5};
const admin=postgres({...config,database:'postgres'}),name=`worker_fixture_${process.pid}_${Date.now()}`;let db;
try{
 await admin`create database ${admin(name)}`;db=postgres({...config,database:name});
 await db.unsafe("do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end $$;",[],{prepare:false});
 for(const f of ['20261005000000_prediction_performance_ledger.sql','20261005010000_mlb_performance_publication.sql','20261006000000_sport_capture_receipts.sql','20261006010000_priority_sport_contracts.sql'])await db.unsafe(readFileSync('supabase/migrations/'+f,'utf8'),[],{prepare:false});
 const health=readFileSync('supabase/migrations/20260923213738_recover_pipeline_health.sql','utf8');await db.unsafe(health.slice(0,health.indexOf('CREATE OR REPLACE FUNCTION public.enqueue')),[],{prepare:false});
 // pg_cron is unavailable in this native fixture: validate scheduler contract using a catalog stub.
 await db.unsafe(`create schema cron;create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true);create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid$$;create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;`,[],{prepare:false});
 await db.unsafe(readFileSync('supabase/migrations/20261006020000_register_prediction_performance_jobs.sql','utf8'),[],{prepare:false});
 assert.equal((await db`select count(*)::int n from pipeline_component_registry where enabled`)[0].n,0);
 assert.equal((await db`select count(*)::int n from cron.job where active`)[0].n,0);assert.equal((await db`select count(*)::int n from cron.job`)[0].n,24);assert.equal((await db`select count(*)::int n from cron.job where jobname like '%-publish-%' and schedule='1-59/5 * * * *'`)[0].n,2);assert.equal((await db`select dispatch_performance_job_v1('performance_mlb_publish_team') result`)[0].result,null);
 const p={sport:'NFL',eventKey:'espn:nfl:1',marketType:'moneyline',side:'home',modelVersion:'v',modelMode:'SHADOW',modelAvailable:true,capturedAt:'2000-01-01T00:00:00Z',startsAt:'2000-01-01T01:00:00Z',quoteAt:'2000-01-01T00:00:00Z',modelProbability:.6,marketProbability:.5,probabilityBasis:'CONDITIONAL_NO_PUSH',sourceIds:{provider:'espn',event:'1'},settlementRule:{version:'fixture'},eligibilityReasons:[]};
 for(let i=0;i<250;i++)await db`select ingest_prediction_v1(${db.json({...p,sourceKey:'backlog:'+i})}::jsonb)`;
 const claim=async(session=db,n=100)=>(await session`select claim_performance_settlements_v1('NFL',${n}) result`)[0].result;
 const finish=async(row,settlement={},error=null,cooldown=0)=>(await db`select complete_performance_settlement_v1(${row.prediction_id},${row.lease_token},${db.json({predictionId:row.prediction_id,outcome:'UNRESOLVED',source:'espn',sourceUpdatedAt:null,ruleVersion:'fixture',sourceRevision:'facts:1',retrievedAt:'2026-10-06T10:00:00Z',...settlement})}::jsonb,${error},${cooldown}) result`)[0].result;
 const seedA=await db.reserve(),seedB=await db.reserve();
 try{await seedA`begin`;await seedB`begin`;const initial=await claim(seedA);assert.equal(initial.length,100);const started=Date.now();assert.deepEqual(await claim(seedB),[]);assert.ok(Date.now()-started<2000,'first seed race blocked');await seedA`rollback`;await seedB`rollback`;}finally{seedA.release();seedB.release();}
 const pages=[];
 for(const expected of [100,100,50]){const rows=await claim();assert.equal(rows.length,expected);pages.push(...rows);for(const row of rows)assert.equal((await finish(row)).accepted,true);}
 assert.equal((await claim()).length,0);assert.equal((await db`select count(*)::int n from performance_settlements`)[0].n,250);
 const first=pages[0];await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute' where prediction_id=${first.prediction_id}`;
 const [recheck]=await claim();assert.equal((await finish(recheck,{retrievedAt:'2026-10-06T11:00:00Z'})).appended,false);
 assert.equal((await db`select source_updated_at,payload->>'retrievedAt' retrieved from performance_settlements where prediction_id=${first.prediction_id}`)[0].source_updated_at,null);
 // Crash/expired lease recovery, stale in-flight completion rejected, new claim corrects once.
 await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute' where prediction_id=${first.prediction_id}`;const [crashed]=await claim();
 await db`update performance_settlement_queue set lease_expires_at=now()-interval '1 second' where prediction_id=${first.prediction_id}`;
 const [recovered]=await claim();assert.notEqual(crashed.lease_token,recovered.lease_token);assert.equal((await finish(crashed,{outcome:'WIN',sourceRevision:'stale'})).accepted,false);
 assert.equal((await finish(recovered,{outcome:'WIN',sourceRevision:'facts:2'})).appended,true);
 assert.equal((await finish(recovered,{outcome:'LOSS',sourceRevision:'facts:3'})).accepted,false);
 // Missing ruleVersion is normalized once, never repeated as spurious revisions.
 const missing=pages[2];await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute' where prediction_id=${missing.prediction_id}`;const [nullRule]=await claim();await finish(nullRule,{ruleVersion:null});await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute' where prediction_id=${missing.prediction_id}`;const [sameNullRule]=await claim();assert.equal((await finish(sameNullRule,{ruleVersion:null})).appended,false);
 // Older provider timestamps cannot supersede a verified correction.
 await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute' where prediction_id=${first.prediction_id}`;const [newer]=await claim();await finish(newer,{outcome:'WIN',sourceRevision:'dated:1',sourceUpdatedAt:'2026-10-06T11:00:00Z'});
 await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute' where prediction_id=${first.prediction_id}`;const [stale]=await claim();assert.equal((await finish(stale,{outcome:'LOSS',sourceRevision:'dated:old',sourceUpdatedAt:'2026-10-06T10:00:00Z'})).accepted,false);
 await db`update performance_settlement_queue set lease_token=null,lease_expires_at=null where prediction_id=${first.prediction_id}`;
 // Independent open transactions prove SKIP LOCKED overlapping pages do not duplicate.
 await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute'`;
 const a=await db.reserve(),b=await db.reserve();try{await a`begin`;await b`begin`;await a`set local role service_role`;await b`set local role service_role`;const ca=await claim(a),cb=await claim(b);assert.equal(ca.length,100);assert.equal(cb.length,100);assert.equal(ca.filter(x=>cb.some(y=>x.prediction_id===y.prediction_id)).length,0);await a`rollback`;await b`rollback`;}finally{a.release();b.release();}
 // Explicit final window, unresolved no expiry, retry ladder and provider shared cooldown.
 await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute',first_final_at=now()-interval '15 days' where prediction_id=${first.prediction_id}`;
 const oldRows=await claim();assert.ok(!oldRows.some(x=>x.prediction_id===first.prediction_id));for(const row of oldRows)await finish(row);
 await db`update performance_settlement_queue set next_attempt_at=now()+interval '1 day'`;
 await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute',attempts=0,first_final_at=now()-interval '15 days' where prediction_id=${pages[1].prediction_id}`;
 for(const minutes of [1,5,15,60,60]){const [row]=await claim();const before=Date.now();await finish(row,{},'PROVIDER_HTTP_429',0);const [q]=await db`select next_attempt_at from performance_settlement_queue where prediction_id=${row.prediction_id}`;assert.ok(Math.abs((Date.parse(q.next_attempt_at)-before)/60000-minutes)<.1);await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute' where prediction_id=${row.prediction_id}`;}
 const [quota]=await claim();await finish(quota,{},'PROVIDER_HTTP_429',3600);await db`update performance_settlement_queue set next_attempt_at=now()-interval '1 minute'`;assert.equal((await claim()).length,0);
 const roles=await db.reserve();try{await roles`set role anon`;await assert.rejects(claim(roles),/permission denied/);await roles`reset role`;await roles`set role authenticated`;await assert.rejects(roles`select * from performance_settlement_queue`,/permission denied/);await roles`reset role`;}finally{roles.release();}
 await db.unsafe('create schema net;create table net.http_request_queue(id bigint primary key);create table net._http_response(id bigint primary key,status_code integer,content text,error_msg text,timed_out boolean,created timestamptz default now());',[],{prepare:false});
 for(const [i,body] of [{publication:{enabled:true,faults:[]},plays:[{tracking:{tracked:false}}]},{publication:{enabled:true,faults:['WRITE_FAILED']},plays:[]},'<html>',{publication:{enabled:false,faults:[]},plays:[]},{publication:{enabled:true,faults:[]},plays:[{tracking:{tracked:true,decisionId:'d',predictionId:'p'}}]}].entries()){await db`insert into pipeline_http_request_log(request_id,component_key) values(${i},'performance_mlb_publish_team')`;await db`insert into net._http_response(id,status_code,content) values(${i},200,${typeof body==='string'?body:JSON.stringify(body)})`;}
 await db`insert into pipeline_component_registry(component_key,display_name,subsystem,sport,job_name,runner_type,expected_interval_minutes,stale_after_minutes) values('existing_transport','Existing','Context','MLB','existing-test','HTTP',5,12)`;
 await db`insert into pipeline_http_request_log(request_id,component_key) values(1000,'existing_transport')`;await db`insert into net._http_response(id,status_code,content) values(1000,200,'<html>')`;
 const recoveredHealth=readFileSync('supabase/migrations/20260923213738_recover_pipeline_health.sql','utf8');const start=recoveredHealth.indexOf('CREATE OR REPLACE FUNCTION public.reconcile_pipeline_http_requests_v1()');const end=recoveredHealth.indexOf('CREATE OR REPLACE FUNCTION public.pipeline_health_snapshot_v1()',start);
 // Load the real recovered generic implementation only until the forward migration replaces it.
 if(!(await db`select to_regprocedure('public.reconcile_pipeline_http_requests_v1()') present`)[0].present)await db.unsafe(recoveredHealth.slice(start,end),[],{prepare:false});
 await db`select reconcile_pipeline_http_requests_v1()`;
 const beforeSemantic=await db`select response_ok from pipeline_http_request_log where component_key='performance_mlb_publish_team' order by request_id`;assert.ok(beforeSemantic.every(x=>x.response_ok!==true),'generic reconciliation promoted unvalidated performance responses');
 assert.equal((await db`select response_ok from pipeline_http_request_log where request_id=1000`)[0].response_ok,true,'existing transport behavior changed');
 await db`select reconcile_performance_http_v1()`;const healthy=await db`select response_ok from pipeline_http_request_log where component_key='performance_mlb_publish_team' order by request_id`;assert.deepEqual(healthy.map(x=>x.response_ok),[false,false,false,false,true]);
 const transport=await db`select status_code,timed_out,response_preview from pipeline_http_request_log where request_id=2`;assert.equal(transport[0].status_code,200);assert.equal(transport[0].timed_out,false);assert.equal(transport[0].response_preview,'<html>');
 await db`select reconcile_pipeline_http_requests_v1()`;assert.equal((await db`select response_ok from pipeline_http_request_log where request_id=2`)[0].response_ok,false,'later generic pass replaced semantic failure');
 await db`update pipeline_component_registry set enabled=true where component_key='performance_mlb_publish_team'`;await assert.rejects(db`select dispatch_performance_job_v1('performance_mlb_publish_team')`,/capture dependency not ready/);
 console.log('Native queue: 250 rows/three pages, null source chronology, revisions, crash leases, overlap, correction window, retry/cooldown and role/disabled-job checks passed');
}finally{if(db)await db.end();await admin`drop database if exists ${admin(name)}`;await admin.end();}
