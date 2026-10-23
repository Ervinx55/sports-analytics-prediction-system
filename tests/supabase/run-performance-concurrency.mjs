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
 await db.unsafe(readFileSync(new URL('../../supabase/migrations/20261005010000_mlb_performance_publication.sql',import.meta.url),'utf8'),[],{prepare:false});
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
  // Different canonical events must serialize on their shared external identity.
  const mapped={...p,sourceKey:'mapping-race:a',eventKey:'mapping-race:event-a',sourceIds:{provider:'fixture',event:'shared-external-id'}};
  transactionsOpen=true; await a`begin`; await b`begin`;
  await a`set local role service_role`; await b`set local role service_role`;
  const [mapA]=await a`select public.ingest_prediction_v1(${db.json(mapped)}::jsonb) as id`;
  const mapRetry=b`select public.ingest_prediction_v1(${db.json({...mapped,sourceKey:'mapping-race:b',eventKey:'mapping-race:event-b'})}::jsonb) as id`.then(x=>x);
  await waitForLock(); await a`commit`; const [mapB]=await mapRetry; await b`commit`; transactionsOpen=false;
  const [winner]=await db`select valid from public.performance_predictions where id=${mapA.id}`;
  const [loser]=await db`select valid,event_key,eligibility_reasons,payload from public.performance_predictions where id=${mapB.id}`;
  assert.equal(winner.valid,true);
  assert.equal(loser.valid,false,'conflicting external identity became a valid prediction');
  assert.equal(loser.event_key,null,'conflicting diagnostic acquired canonical event identity');
  assert.ok(loser.eligibility_reasons.includes('AMBIGUOUS_SOURCE_MAPPING'));
  assert.equal(loser.payload.eventKey,'mapping-race:event-b','diagnostic source provenance lost');
  const [canonical]=await db`select count(*)::int as n from public.performance_events where event_key like 'mapping-race:%'`;
  assert.equal(canonical.n,1,'conflicting diagnostic created canonical event state');
  const [mapping]=await db`select event_key from public.performance_event_mappings where sport='NFL' and provider='fixture' and source_event_id='shared-external-id'`;
  assert.equal(mapping.event_key,'mapping-race:event-a');
  // Actual MLB publisher retries return the immutable first timestamp and snapshot.
  const stamp=new Date(Date.now()-60000).toISOString(),start=new Date(Date.now()+15*60000).toISOString();
  const mlb={...p,sourceKey:'market_grade_observations:901',sport:'MLB',eventKey:'mlb:901',capturedAt:stamp,startsAt:start,quoteAt:stamp,sourceIds:{event:'901'}};
  const publication={prediction:mlb,issuedAt:new Date().toISOString(),evidence:{status:'PLAY',finalQualification:true}};
  transactionsOpen=true;await a`begin`;await b`begin`;await a`set local role service_role`;await b`set local role service_role`;
  const [pubA]=await a`select public.publish_mlb_performance_v1(${db.json(publication)}::jsonb) as result`;
  const pubRetry=b`select public.publish_mlb_performance_v1(${db.json({...publication,issuedAt:new Date().toISOString()})}::jsonb) as result`.then(x=>x);
  await waitForLock();await a`commit`;const [pubB]=await pubRetry;await b`commit`;transactionsOpen=false;
  assert.deepEqual(pubA.result,pubB.result,'publisher retry changed immutable issuance');
  const nextPublication={...publication,prediction:{...mlb,sourceKey:'market_grade_observations:902',odds:120}};
  const [audit]=await db`select public.publish_mlb_performance_v1(${db.json(nextPublication)}::jsonb) as result`;
  assert.notEqual(audit.result.id,pubA.result.id);
  const [entry]=await db`select p.odds,d.prediction_id from public.performance_decisions d join public.performance_predictions p on p.id=d.prediction_id where d.first_issued and p.sport='MLB'`;
  assert.equal(Number(entry.odds),-110);assert.equal(entry.prediction_id,pubA.result.prediction_id);
  // Wall-clock publication must survive waits on every lock, including portfolio.
  async function blockedPublication({key,startOffsetMs,quoteAgeMs,lockKind,existing=false,qualificationOffsetMs=null}) {
   const beginAt=Date.now(),eventKey=`mlb:${key}`;
   const prediction={...mlb,sourceKey:`market_grade_observations:${key}`,eventKey,
    capturedAt:new Date(beginAt-500).toISOString(),startsAt:new Date(beginAt+startOffsetMs).toISOString(),
    quoteAt:new Date(beginAt-quoteAgeMs).toISOString(),sourceIds:{event:String(key)}};
   const candidate={prediction,issuedAt:new Date(beginAt).toISOString(),evidence:{status:'PLAY',finalQualification:true,...(qualificationOffsetMs===null?{}:{freshness:{score:100},qualificationExpiresAt:new Date(beginAt+qualificationOffsetMs).toISOString()})}};
   const [savedPrediction]=await db`select public.ingest_prediction_v1(${db.json(prediction)}::jsonb) as id`;
   const [stored]=await db`select market_key from public.performance_predictions where id=${savedPrediction.id}`;
   const alreadyIssued=existing?(await db`select public.publish_mlb_performance_v1(${db.json(candidate)}::jsonb) as result`)[0].result:null;
   transactionsOpen=true;await a`begin`;await b`begin`;await a`set local role service_role`;await b`set local role service_role`;
   const lockKey=lockKind==='portfolio'?`portfolio:${stored.market_key}`:`decision:${prediction.sourceKey}:final`;
   await a`select pg_advisory_xact_lock(hashtextextended(${lockKey},0))`;
   const waiting=b`select public.publish_mlb_performance_v1(${db.json(candidate)}::jsonb) as result`.then(rows=>({rows}),error=>({error}));
   await waitForLock();
   const expiration=qualificationOffsetMs!==null?beginAt+qualificationOffsetMs:lockKind==='portfolio'&&startOffsetMs>5000?beginAt+(120000-quoteAgeMs):beginAt+startOffsetMs;
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiration-Date.now()+100)));
   await a`commit`;const result=await waiting;await b`rollback`;transactionsOpen=false;
   if(existing) assert.deepEqual(result.rows?.[0]?.result,alreadyIssued,'post-start retry changed the existing issuance');
   else {
    assert.ok(result.error,'new publication was accepted after lock wait crossed its deadline');
    assert.match(result.error.message,/publication.*(?:start|quote|freshness)/i);
    const [count]=await db`select count(*)::int as n from public.performance_decisions where prediction_id=${savedPrediction.id}`;
    assert.equal(count.n,0);
   }
  }
  await blockedPublication({key:903,startOffsetMs:1000,quoteAgeMs:500,lockKind:'decision'});
  await blockedPublication({key:904,startOffsetMs:1000,quoteAgeMs:500,lockKind:'portfolio'});
  await blockedPublication({key:905,startOffsetMs:15*60000,quoteAgeMs:119500,lockKind:'portfolio'});
  await blockedPublication({key:907,startOffsetMs:15*60000,quoteAgeMs:500,lockKind:'portfolio',qualificationOffsetMs:500});
  await blockedPublication({key:906,startOffsetMs:1000,quoteAgeMs:500,lockKind:'decision',existing:true});
  console.log('Native PostgreSQL races passed, including actual decision/portfolio waits crossing start, quote/final-check expiry, and post-start immutable retry.');
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
