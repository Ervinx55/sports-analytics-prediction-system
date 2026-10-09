import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import * as model from '../../supabase/functions/_shared/performance-model-adapters.mjs';
import * as mlb from '../../supabase/functions/_shared/performance-mlb-adapter.mjs';
function load({enabled=true,db={},fetchImpl=()=>{},secret='secret'}={}){
 let handler;const source=stripTypeScriptTypes(readFileSync('supabase/functions/capture-sport-predictions/index.ts','utf8').replace(/^import .*;\r?\n/gm,''));
 vm.runInNewContext(source,{...model,...mlb,fetchModelResponse:url=>model.fetchModelResponse(url,{fetchImpl}),createClient:()=>db,fetch:fetchImpl,Response,URL,Date,JSON,AbortController,setTimeout,clearTimeout,Deno:{serve:f=>{handler=f;},env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?secret:key==='PERFORMANCE_SPORT_CAPTURE_ENABLED'?String(enabled):key==='PERFORMANCE_MODEL_BASE_URL'?'https://fixture':'fixture'}}});return handler;
}
const request=(body={},authorization='Bearer secret')=>new Request('https://fixture/capture',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify(body)});
test('worker requires service auth, validates input and defaults disabled',async()=>{
 const h=load();assert.equal((await h(request({sport:'NFL',kind:'team',requestId:'r'},'Bearer anon'))).status,401);
 assert.equal((await h(request({sport:'NFL',kind:'bad',requestId:'r'}))).status,400);
 assert.equal((await load({enabled:false})(request({sport:'NFL',kind:'team',requestId:'r'}))).status,503);
});
test('NBA/CFB coverage is honest without fetch or writes',async()=>{
 const h=load({fetchImpl:()=>{throw Error('unexpected fetch');}});
 for(const sport of ['NBA','CFB']){const r=await h(request({sport,kind:'team',requestId:'r'}));const b=await r.json();assert.equal(r.status,200);assert.equal(b.coverage.modelAvailable,false);assert.equal(b.captured,0);}
});
test('NFL fetches configured source only, stores shadow predictions and exposes ingest faults',async()=>{
 const calls=[],urls=[];const at=new Date().toISOString();const db={rpc:async(name,{payload})=>{calls.push({name,payload});return {error:{message:'secret connection string'}};}};
 const h=load({db,fetchImpl:async url=>{urls.push(url);return new Response(JSON.stringify({sport:'FOOTBALL',league:'NFL',version:'v',forecastAt:at,markets:[{eventID:'e',marketType:'moneyline',side:'home',modelProbability:.6,marketFairProbability:.5,startsAt:new Date(Date.now()+3600000).toISOString(),shadowStatus:'PLAY'}]}));}});
 const r=await h(request({sport:'NFL',kind:'team',requestId:'r',url:'https://attacker'})),b=await r.json();assert.equal(urls[0],'https://fixture/api/nflmodel');assert.equal(calls[0].name,'ingest_prediction_v1');assert.equal(calls[0].payload.modelMode,'SHADOW');assert.equal(calls[0].payload.provenance.productionWeight,0);assert.equal(b.ok,false);assert.equal(b.captured,0);assert.equal(b.faults[0].reason,'LEDGER_WRITE_FAILED');assert.equal(JSON.stringify(b).includes('secret connection'),false);
});
test('provider error produces no records or successful coverage',async()=>{
 const h=load({fetchImpl:async()=>new Response('HTML secrets',{status:500})});const r=await h(request({sport:'NFL',kind:'props',requestId:'r'})),b=await r.json();assert.equal(r.status,502);assert.equal(b.coverage.complete,false);assert.equal(b.error,'PROVIDER_HTTP_500');
});
test('MLB reads existing observation page and missing pages never mean completion',async()=>{
 const calls=[];const db={from(table){calls.push(table);const q={select:()=>q,gt:()=>q,order:()=>q,limit:()=>q,then:resolve=>Promise.resolve({data:null,error:null}).then(resolve)};return q;}};
 const r=await load({db})(request({sport:'MLB',kind:'player_prop_observations',requestId:'r'})),b=await r.json();assert.equal(r.status,502);assert.equal(b.coverage.complete,false);assert.equal(calls[0],'player_prop_observations');
});
test('MLB replay keeps failed page cursor and uses original saved observation keys',async()=>{
 const at=new Date().toISOString(),row={id:5,game_pk:22,captured_at:at,starts_at:new Date(Date.now()+3600000).toISOString(),model_version:'mlb',market_type:'moneyline',market_side:'home',model_probability:.6,market_fair_probability:.5};
 const payloads=[];let failed=true;
 const db={from(){const q={select:()=>q,gt:()=>q,order:()=>q,limit:()=>q,then:resolve=>Promise.resolve({data:[row],error:null}).then(resolve)};return q;},rpc:async(_name,{payload})=>{payloads.push(payload);return failed?{error:{message:'down'}}:{data:'id',error:null};}};
 const h=load({db});const first=await(await h(request({sport:'MLB',kind:'market_grade_observations',requestId:'r',cursor:3}))).json();
 assert.equal(first.nextCursor,3);assert.equal(first.coverage.complete,false);failed=false;
 const second=await(await h(request({sport:'MLB',kind:'market_grade_observations',requestId:'r',cursor:3}))).json();assert.equal(second.nextCursor,5);assert.equal(second.coverage.complete,true);assert.equal(payloads[0].sourceKey,'market_grade_observations:5');assert.deepEqual(payloads[0],payloads[1]);
});
