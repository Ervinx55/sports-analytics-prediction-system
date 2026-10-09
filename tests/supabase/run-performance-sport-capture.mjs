import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as model from '../../supabase/functions/_shared/performance-model-adapters.mjs';
import * as mlb from '../../supabase/functions/_shared/performance-mlb-adapter.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
const db=new PGlite();
try {
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 for(const f of ['20261005000000_prediction_performance_ledger.sql','20261005010000_mlb_performance_publication.sql','20261006000000_sport_capture_receipts.sql'])if(existsSync('supabase/migrations/'+f))await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 const capture=new Date(Date.now()-60000).toISOString(),start=new Date(Date.now()+250).toISOString();
 const p={sourceKey:'sport-receipt:pre',sport:'NFL',eventKey:'nfl:receipt',marketType:'moneyline',side:'home',modelVersion:'receipt-test',modelMode:'SHADOW',modelAvailable:true,capturedAt:capture,startsAt:start,eligibilityStartsAt:start,quoteAt:capture,book:'fixture',odds:-110,modelProbability:.6,marketProbability:.5,probabilityBasis:'CONDITIONAL_NO_PUSH',sourceIds:{provider:'fixture',event:'receipt'},settlementRule:{version:'fixture'},provenance:{productionWeight:0},eligibilityReasons:[]};
 const query=async(sql,params)=> (await db.query(sql,params)).rows[0];
 const write=async payload=>(await query('select ingest_sport_prediction_v1($1::jsonb) as result',[JSON.stringify(payload)])).result;
 const first=await write(p);await new Promise(r=>setTimeout(r,300));const retry=await write(p);assert.equal(retry.id,first.id);
 const saved=await query('select payload,valid from performance_predictions where id=$1',[first.id]);assert.equal(saved.valid,true);assert.equal(saved.payload.provenance.captureReceipt.postStart,false);assert.equal(saved.payload.eligibilityReasons.includes('POST_START_RECEIPT'),false);
 const post=await write({...p,sourceKey:'sport-receipt:post',eventKey:'nfl:post',sourceIds:{provider:'fixture',event:'post'}});
 const excluded=await query('select payload,valid from performance_predictions where id=$1',[post.id]);assert.equal(excluded.valid,false);assert.equal(excluded.payload.provenance.captureReceipt.postStart,true);assert.ok(excluded.payload.eligibilityReasons.includes('POST_START_RECEIPT'));
 assert.equal((await write({...p,sourceKey:'sport-receipt:post',eventKey:'nfl:post',sourceIds:{provider:'fixture',event:'post'}})).id,post.id);
 await assert.rejects(write({...p,odds:120}),/payload conflict/);
 await assert.rejects(write({...p,sourceKey:'sport-receipt:spoof',provenance:{captureReceipt:{postStart:false}}}),/reserved receipt/);
 await assert.rejects(write({...p,sourceKey:'sport-receipt:spoof-reason',eligibilityReasons:['POST_START_RECEIPT']}),/reserved receipt/);
 const foreign={...p,sourceKey:'sport-receipt:foreign-metadata',provenance:{...p.provenance,captureReceipt:{unrelated:'must stay immutable'}}};
 await query('select ingest_prediction_v1($1::jsonb)',[JSON.stringify(foreign)]);
 await assert.rejects(write({...p,sourceKey:foreign.sourceKey}),/payload conflict/);
 // A later source start cannot replace an already authoritative original cutoff.
 const reschedule={...p,sourceKey:'sport-receipt:rescheduled',startsAt:new Date(Date.now()+60000).toISOString(),eligibilityStartsAt:new Date(Date.now()+60000).toISOString()};
 const rescheduled=await write(reschedule);const authoritative=await query('select payload from performance_predictions where id=$1',[rescheduled.id]);assert.equal(authoritative.payload.provenance.captureReceipt.postStart,true);
 const before=(await query('select count(*)::int as n from performance_predictions')).n;
 await db.exec('begin');await write({...p,sourceKey:'sport-receipt:rolledback'});await db.exec('rollback');assert.equal((await query('select count(*)::int as n from performance_predictions')).n,before);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(write(p),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');assert.equal((await write(p)).id,first.id);await db.exec('reset role');
 // Actual HTTP handler -> pure adapter -> real SQL receipt wrapper, across kickoff.
 const sourceAt=new Date(Date.now()-60000).toISOString(),httpStart=new Date(Date.now()+500).toISOString();
 const source={sport:'FOOTBALL',league:'NFL',version:'http-sql',forecastAt:sourceAt,dataSourceComplete:true,markets:[{eventID:'http-pre',canonicalEventID:'http-pre',marketType:'moneyline',side:'home',startsAt:httpStart,quoteAt:sourceAt,modelProbability:.6,marketFairProbability:.5,effectiveIndependentWeight:1,probabilityBasis:'CONDITIONAL_NO_PUSH',settlementRule:{version:'fixture'}}]};
 let handler;
 const handlerSource=stripTypeScriptTypes(readFileSync('supabase/functions/capture-sport-predictions/index.ts','utf8').replace(/^import .*;\r?\n/gm,''));
 vm.runInNewContext(handlerSource,{...model,...mlb,fetchModelResponse:async()=>({ok:true,body:source}),createClient:()=>({rpc:async(name,{payload})=>{assert.equal(name,'ingest_sport_prediction_v1');return {data:await write(payload),error:null};}}),Response,URL,Date,Deno:{serve:fn=>{handler=fn;},env:{get:name=>name==='SUPABASE_SERVICE_ROLE_KEY'?'fixture-secret':name==='PERFORMANCE_SPORT_CAPTURE_ENABLED'?'true':'https://fixture'}}});
 const request=()=>new Request('https://fixture/capture',{method:'POST',headers:{authorization:'Bearer fixture-secret','content-type':'application/json'},body:JSON.stringify({sport:'NFL',kind:'team',requestId:'http-sql'})});
 await db.exec('set role service_role');
 const beforeHttp=await(await handler(request())).json();assert.equal(beforeHttp.captured,1);assert.equal(beforeHttp.excluded,0);
 await new Promise(r=>setTimeout(r,Math.max(0,Date.parse(httpStart)-Date.now()+50)));
 const afterHttp=await(await handler(request())).json();assert.equal(afterHttp.captured,1);assert.equal(afterHttp.excluded,0);assert.equal(afterHttp.faults.length,0);
 source.markets[0].eventID='http-late';source.markets[0].canonicalEventID='http-late';
 const lateHttp=await(await handler(request())).json();assert.equal(lateHttp.captured,1);assert.equal(lateHttp.excluded,1);assert.equal(lateHttp.reasons.POST_START_RECEIPT,1);
 await db.exec('reset role');
 console.log('Sport receipt SQL passed: immutable kickoff retry, post-start firstseen, source drift/reserved metadata rejection, canonical cutoff, rollback, roles.');
}catch(e){console.error(e.message,e.code,e.where??'');process.exitCode=1;}finally{await db.close();}
