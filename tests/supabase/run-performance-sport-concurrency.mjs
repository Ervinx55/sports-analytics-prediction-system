import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
if(!['127.0.0.1','localhost','::1'].includes(process.env.PGHOST)||!process.env.PGPORT||!process.env.PGUSER||!process.env.PGPASSWORD_FILE||!process.argv[2])throw Error('Explicit loopback PostgreSQL fixture configuration required');
const {default:postgres}=await import(pathToFileURL(resolve(process.argv[2])).href);
const config={host:process.env.PGHOST,port:Number(process.env.PGPORT),username:process.env.PGUSER,password:readFileSync(process.env.PGPASSWORD_FILE,'utf8').trim(),max:4};
const admin=postgres({...config,database:'postgres'}),name=`sport_receipt_fixture_${process.pid}_${Date.now()}`;let db;
try {
 await admin`create database ${admin(name)}`;db=postgres({...config,database:name});
 await db.unsafe("do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;",[],{prepare:false});
 for(const file of ['20261005000000_prediction_performance_ledger.sql','20261005010000_mlb_performance_publication.sql','20261006000000_sport_capture_receipts.sql','20261006010000_priority_sport_contracts.sql'])await db.unsafe(readFileSync('supabase/migrations/'+file,'utf8'),[],{prepare:false});
 const a=await db.reserve(),b=await db.reserve();
 try {
  const [{pid:pidA}]=await a`select pg_backend_pid() as pid`,[{pid:pidB}]=await b`select pg_backend_pid() as pid`;assert.notEqual(pidA,pidB);
  const waitLock=async()=>{for(let i=0;i<100;i++){const [s]=await db`select wait_event_type from pg_stat_activity where pid=${pidB}`;if(s?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error('expected independent source lock wait');};
  const waitStart=async start=>{const ms=Date.parse(start)-Date.now()+30;if(ms>0)await new Promise(r=>setTimeout(r,ms));};
  const fixture=(key,start)=>({sourceKey:key,sport:'NFL',eventKey:key,marketType:'moneyline',side:'home',modelVersion:'receipt-native',modelMode:'SHADOW',modelAvailable:true,capturedAt:new Date(Date.now()-60000).toISOString(),startsAt:start,eligibilityStartsAt:start,quoteAt:new Date(Date.now()-60000).toISOString(),book:'fixture',odds:-110,modelProbability:.6,marketProbability:.5,probabilityBasis:'CONDITIONAL_NO_PUSH',sourceIds:{provider:'fixture',event:key},settlementRule:{version:'fixture'},provenance:{productionWeight:0},eligibilityReasons:[]});
  const p=fixture('receipt:prestart',new Date(Date.now()+400).toISOString());
  await a`begin`;await b`begin`;await a`set local role service_role`;await b`set local role service_role`;
  const [first]=await a`select ingest_sport_prediction_v1(${db.json(p)}::jsonb)->>'id' as id`;
  const pending=b`select ingest_sport_prediction_v1(${db.json(p)}::jsonb)->>'id' as id`.then(x=>x);await waitLock();await waitStart(p.startsAt);await a`commit`;const [retry]=await pending;await b`commit`;assert.equal(retry.id,first.id);
  const [saved]=await db`select valid,payload from performance_predictions where id=${first.id}`;assert.equal(saved.valid,true);assert.equal(saved.payload.provenance.captureReceipt.postStart,false);
  // No saved observation yet: a held source lock carries first ingestion across kickoff.
  const late=fixture('receipt:firstseen-late',new Date(Date.now()+250).toISOString());
  await a`begin`;await b`begin`;await b`set local role service_role`;
  await a`select pg_advisory_xact_lock(hashtextextended(${'prediction:'+late.sourceKey},0))`;
  const waiting=b`select ingest_sport_prediction_v1(${db.json(late)}::jsonb)->>'id' as id`.then(x=>x);await waitLock();await waitStart(late.startsAt);await a`commit`;const [post]=await waiting;await b`commit`;
  const [excluded]=await db`select valid,payload from performance_predictions where id=${post.id}`;assert.equal(excluded.valid,false);assert.equal(excluded.payload.provenance.captureReceipt.postStart,true);assert.ok(excluded.payload.eligibilityReasons.includes('POST_START_RECEIPT'));
  // Two post-start first-seen callers still serialize to one excluded original.
  const both=fixture('receipt:both-post',new Date(Date.now()-100).toISOString());
  await a`begin`;await b`begin`;await a`set local role service_role`;await b`set local role service_role`;
  const [postA]=await a`select ingest_sport_prediction_v1(${db.json(both)}::jsonb)->>'id' as id`;
  const other=b`select ingest_sport_prediction_v1(${db.json(both)}::jsonb)->>'id' as id`.then(x=>x);await waitLock();await a`commit`;const [postB]=await other;await b`commit`;assert.equal(postA.id,postB.id);
  await assert.rejects(db`select ingest_sport_prediction_v1(${db.json({...p,odds:120})}::jsonb)`,/payload conflict/);
  const [count]=await db`select count(*)::int as n from performance_predictions`;assert.equal(count.n,3);
  console.log('Native sport receipt concurrency passed: pre/post immutable retry; source-lock wait crossing kickoff excluded; concurrent post-start duplicate; source drift rejected.');
 }finally{try{await a`rollback`;await b`rollback`;}finally{a.release();b.release();}}
}catch(e){console.error(e.message,e.code??'');process.exitCode=1;}finally{if(db)await db.end();await admin`drop database if exists ${admin(name)} with (force)`;await admin.end();}

