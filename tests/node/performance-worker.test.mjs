import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchResultResponse,resultRequest,runSettlementPage} from '../../supabase/functions/_shared/performance-worker.mjs';
test('exact result IDs only and unavailable sports remain distinct',()=>{
 assert.equal(resultRequest({sport:'NFL',sourceIds:{provider:'nfl-model-provider',event:'123'}}),null);
 assert.equal(resultRequest({sport:'NHL',sourceIds:{provider:'espn',event:'123'}}),null);
 assert.equal(resultRequest({sport:'NBA',eventKey:'espn:nba:123',sourceIds:{provider:'espn',event:'123'}}).url,'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=123');
});
test('429 retries once per lease and obeys cooldown; HTML and timeouts incomplete',async()=>{
 let calls=0;const limited=await fetchResultResponse('https://fixture',{fetchImpl:async()=>{calls++;return new Response('quota',{status:429,headers:{'retry-after':'3600'}});}});
 assert.equal(calls,1);assert.equal(limited.ok,false);assert.equal(limited.cooldownSeconds,3600);
 assert.equal((await fetchResultResponse('https://fixture',{fetchImpl:async()=>new Response('<html>')})).error,'MALFORMED_JSON');
 const timeout=await fetchResultResponse('https://fixture',{timeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort'))))});assert.equal(timeout.error,'PROVIDER_TIMEOUT');
});
test('250 backlog pages, old unresolved and durable completion RPC only',async()=>{
 const pending=Array.from({length:250},(_,i)=>({prediction_id:String(i),lease_token:'token',prediction:{sport:'NHL',modelAvailable:false,startsAt:'2000-01-01T00:00:00Z'}}));let saved=0;
 const client={rpc:async(name,args)=>name==='claim_performance_settlements_v1'?{data:pending.splice(0,args.p_limit)}:name==='renew_performance_settlement_v1'?{data:true}:(saved++,{data:{accepted:true,outcome:'UNRESOLVED',appended:true}})};
 for(const n of [100,100,50]){const r=await runSettlementPage(client,{sport:'NHL'});assert.equal(r.processed,n);assert.equal(r.unresolved,n);assert.equal(r.coverage.complete,false);assert.equal(r.coverage.modelAvailable,false);}
 assert.equal(saved,250);
});
test('failed provider response records retry with no false coverage or settlement',async()=>{
 let receipt;const client={rpc:async(name,args)=>name==='claim_performance_settlements_v1'?{data:[{prediction_id:'p',lease_token:'t',prediction:{sport:'MLB',eventKey:'mlb:12',sourceIds:{provider:'mlb-statsapi',event:'12'},modelAvailable:true}}]}:name==='renew_performance_settlement_v1'?{data:true}:(receipt=args,{data:{accepted:true,outcome:'UNRESOLVED'}})};
 const r=await runSettlementPage(client,{sport:'MLB',fetchImpl:async()=>new Response('HTML',{status:503})});
 assert.equal(r.retries,1);assert.equal(r.settled,0);assert.equal(r.coverage.complete,false);assert.equal(receipt.p_error,'PROVIDER_HTTP_503');assert.equal(receipt.p_settlement,null);
});
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {serviceAuthorized} from '../../supabase/functions/_shared/performance-mlb-adapter.mjs';
import * as worker from '../../supabase/functions/_shared/performance-worker.mjs';
test('authenticated HTTP worker defaults disabled and rejects invalid limits',async()=>{
 let handler;let enabled=false;let writes=0;
 const source=stripTypeScriptTypes(readFileSync('supabase/functions/settle-sport-predictions/index.ts','utf8').replace(/^import .*;\r?\n/gm,''));
 vm.runInNewContext(source,{...worker,serviceAuthorized,createClient:()=>({rpc:async()=>{writes++;return {data:[]};}}),Response,JSON,Deno:{serve:f=>{handler=f;},env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'secret':k==='PERFORMANCE_SETTLEMENT_ENABLED'?String(enabled):'fixture'}}});
 const req=(body,auth='Bearer secret')=>new Request('https://fixture',{method:'POST',headers:{authorization:auth},body:JSON.stringify(body)});
 assert.equal((await handler(req({sport:'NFL'},'Bearer anon'))).status,401);
 assert.equal((await handler(req({sport:'NFL',limit:101}))).status,400);
 assert.equal((await handler(req({sport:'NFL'}))).status,503);assert.equal(writes,0);
 enabled=true;const result=await handler(req({sport:'NHL'}));assert.equal(result.status,200);assert.equal((await result.json()).coverage.modelAvailable,false);
});
test('malformed/incomplete/quota bodies remain failed fetches',async()=>{
 for(const body of [null,[],{nextPage:2},{complete:false},{quotaBlocked:true}])assert.equal((await fetchResultResponse('https://fixture',{fetchImpl:async()=>Response.json(body)})).ok,false);
});
test('same-event page fetches once and keeps null provider chronology distinct from retrieval',async()=>{
 const fixture=JSON.parse(readFileSync('tests/fixtures/performance/nfl-final-result.json','utf8'));let calls=0;const settlements=[];
 const prediction={sport:'NFL',eventKey:'espn:nfl:401671789',sourceIds:{provider:'espn',event:'401671789'},marketType:'moneyline',side:'home',book:'fixture',settlementRule:{version:'fixture',book:'fixture',period:'INCLUDING_OVERTIME',tie:'PUSH',cancelled:'VOID',shortened:'UNRESOLVED',nonparticipant:'VOID',appearance:'ANY_APPEARANCE'}};
 const rows=Array.from({length:25},(_,i)=>({prediction_id:String(i),lease_token:'t',prediction}));
 const client={rpc:async(name,args)=>name==='claim_performance_settlements_v1'?{data:rows}:name==='renew_performance_settlement_v1'?{data:true}:(settlements.push(args.p_settlement),{data:{accepted:true,outcome:args.p_settlement.outcome}})};
 const result=await runSettlementPage(client,{sport:'NFL',fetchImpl:async()=>{calls++;return Response.json(fixture.payload);}});
 assert.equal(calls,1);assert.equal(result.settled,25);assert.equal(settlements[0].sourceUpdatedAt,null);assert.match(settlements[0].retrievedAt,/Z$/);assert.equal(new Set(settlements.map(x=>x.retrievedAt)).size,1);
});
