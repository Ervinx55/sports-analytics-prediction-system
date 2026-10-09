import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicitly opt into a disposable local native PostgreSQL database.
// PGHOST=127.0.0.1 PGPORT=... PGUSER=... PGPASSWORD_FILE=... node this-file /path/to/postgres/src/index.js
if (!['127.0.0.1','localhost','::1'].includes(process.env.PGHOST)) throw new Error('Only an explicitly configured loopback PostgreSQL host is allowed.');
if (!process.env.PGPORT || !process.env.PGUSER || !process.env.PGPASSWORD_FILE || !process.argv[2]) throw new Error('Set PGPORT, PGUSER, PGPASSWORD_FILE and pass the installed postgres module path.');
const { default: postgres } = await import(pathToFileURL(resolve(process.argv[2])).href);
const config = {host:process.env.PGHOST,port:Number(process.env.PGPORT),username:process.env.PGUSER,password:readFileSync(process.env.PGPASSWORD_FILE,'utf8').trim(),max:4};
const admin = postgres({...config,database:process.env.PGDATABASE ?? 'postgres'});
const name = `performance_fixture_${process.pid}_${Date.now()}`;
let db;
try {
 await admin`create database ${admin(name)}`;
 db = postgres({...config,database:name});
 await db.unsafe("do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;",[],{prepare:false});
 await db.unsafe(readFileSync(new URL('../../supabase/migrations/20261005000000_prediction_performance_ledger.sql',import.meta.url),'utf8'),[],{prepare:false});
 const fixtures = await db.reserve();
 try { await fixtures.unsafe(readFileSync(new URL('./performance-ledger.sql',import.meta.url),'utf8'),[],{prepare:false}); } finally { fixtures.release(); }
 const p={sourceKey:'concurrent:1',sport:'NFL',eventKey:'concurrent:event',marketType:'spread',side:'HOME',line:0,modelVersion:'v1',modelMode:'LIVE',modelAvailable:true,capturedAt:'2020-10-05T12:00:00Z',startsAt:'2020-10-05T12:15:00Z',quoteAt:'2020-10-05T11:59:00Z',book:'fixture',odds:-110,modelProbability:.6,marketProbability:.5,probabilityBasis:'CONDITIONAL_NO_PUSH',sourceIds:{event:'concurrent:event'},settlementRule:{version:'v1'},provenance:{},eligibilityReasons:[]};
 const a=await db.reserve(), b=await db.reserve();
 let transactionsOpen=false;
 try {
  const [{pid:pidA}]=await a`select pg_backend_pid() as pid`, [{pid:pidB}]=await b`select pg_backend_pid() as pid`;
  assert.notEqual(pidA,pidB,'race requires independent connections');
  const waitForLock=async()=>{
   for(let i=0;i<100;i++) {
    const [state]=await db`select wait_event_type from pg_stat_activity where pid=${pidB}`;
    if(state?.wait_event_type==='Lock') return;
    await new Promise(r=>setTimeout(r,20));
   }
   throw new Error('second concurrent connection did not block on lock');
  };
  transactionsOpen=true; await a`begin`; await b`begin`;
  await a`set local role service_role`; await b`set local role service_role`;
  const [first]=await a`select public.ingest_prediction_v1(${db.json(p)}::jsonb) as id`;
  const retry=b`select public.ingest_prediction_v1(${db.json(p)}::jsonb) as id`.then(x=>x);
  await waitForLock(); await a`commit`;
  const [second]=await retry; await b`commit`; transactionsOpen=false;
  assert.equal(first.id,second.id,'concurrent duplicate changed identity');
  const [later]=await db`select public.ingest_prediction_v1(${db.json({...p,sourceKey:'concurrent:2',odds:120,capturedAt:'2020-10-05T12:01:00Z'})}::jsonb) as id`;
  const decision=(sourceKey,predictionId,issuedAt)=>({sourceKey,predictionId,issuedAt,status:'PLAY',qualified:true,evidence:{finalQualification:true},legacyReconstructed:false});
  transactionsOpen=true; await a`begin`; await b`begin`;
  await a`set local role service_role`; await b`set local role service_role`;
  const [issued]=await a`select public.record_decision_v1(${db.json(decision('concurrent:play:1',first.id,'2020-10-05T12:00:00Z'))}::jsonb) as id`;
  const challenger=b`select public.record_decision_v1(${db.json(decision('concurrent:play:2',later.id,'2020-10-05T12:01:00Z'))}::jsonb) as id`.then(x=>x);
  await waitForLock(); await a`commit`; await challenger; await b`commit`; transactionsOpen=false;
  const rows=await db`select d.id,p.odds from public.performance_decisions d join public.performance_predictions p on p.id=d.prediction_id where d.first_issued`;
  assert.equal(rows.length,1); assert.equal(rows[0].id,issued.id); assert.equal(Number(rows[0].odds),-110);
  const [count]=await db`select count(*)::int as n from public.performance_decisions where market_key=(select market_key from public.performance_predictions where id=${first.id})`;
  assert.equal(count.n,2,'later concurrent issuance audit missing');
  console.log('Native PostgreSQL fixtures and independent-session duplicate/first-PLAY races passed.');
 } finally {
  if(transactionsOpen) { await a`rollback`.catch(()=>{}); await b`rollback`.catch(()=>{}); }
  a.release(); b.release();
 }
} catch(error) {console.error(error.message,error.code ?? ''); process.exitCode=1;}
finally {
 if(db) await db.end();
 await admin`drop database if exists ${admin(name)}`;
 await admin.end();
}

