import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as adapter from '../../supabase/functions/_shared/performance-mlb-adapter.mjs';
import * as qualification from '../../supabase/functions/_shared/performance-mlb-qualification.mjs';
const now=new Date(),capture=now.toISOString(),start=new Date(+now+15*60000).toISOString();
const team={id:22,game_pk:900,event_id:'event',starts_at:start,captured_at:capture,model_version:'fixture',market_type:'moneyline',market_side:'home',non_sharp_status:'READY_FOR_SHARP_CHECK',model_probability:.6,market_fair_probability:.5,best_odds:110,best_book:'book',raw:{performanceCapture:true,quoteAt:capture,probabilityBasis:'CONDITIONAL_NO_PUSH',settlementRule:{version:'fixture'}}};
const prop={...team,id:23,status:'PLAY',mlb_player_id:55,player_id:'provider55',stat_id:'batting_hits',side:'over',line:.5,push_probability:0};
function fixtureDB(route) {
 const data={performance_decisions:[],market_grade_latest:[team],sharp_gate_latest:[{event_id:'event',market_type:'moneyline',market_side:'home',checked_at:capture,final_status:'FINAL_PLAY',raw:{sources:{trusted:{valid:true,updatedAt:capture}}}}],team_market_verification_latest:[{observation_id:22,evaluated_at:capture}],team_market_weather_latest:[{observation_id:22,evaluated_at:capture}],player_prop_latest:[prop],player_prop_verification_latest:[{observation_id:23,evaluated_at:capture}],player_prop_weather_latest:[{observation_id:23,evaluated_at:capture}]};
 const calls=[];let fault=false;
 return {calls,setFault:()=>{fault=true;},from(table){let rows=data[table]??[];const q={select(){return q;},eq(){return q;},gte(){return q;},gt(){return q;},order(){return q;},limit(){return q;},in(){return q;},then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve);}};return q;},async rpc(name,{payload}){calls.push({name,payload});return fault?{error:{message:'recording offline'}}:{data:{id:'persisted',prediction_id:'snapshot',issued_at:payload.issuedAt,status:'PLAY',qualified:true,legacy_reconstructed:false},error:null};}};
}
function loadHandler(route,db,enabled=true,fetchImpl=()=>{}) {
 let handler;
 let source=readFileSync('supabase/functions/'+route+'/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
 source=stripTypeScriptTypes(source);
 const context={...adapter,...qualification,createClient:()=>db,fetch:fetchImpl,Response,Request,URL,URLSearchParams,Date,Map,Set,console,Deno:{env:{get:name=>name==='SUPABASE_SERVICE_ROLE_KEY'?'service-secret':name.startsWith('PERFORMANCE_MLB_')?String(enabled):'fixture'},serve:fn=>{handler=fn;}}};
 vm.runInNewContext(source,context);return handler;
}
for(const [route,key] of [['market-card','markets'],['player-prop-card','props']]) {
 test(route+' rejects anonymous publisher, GET stays read only, POST records before tracked response',async()=>{
  const db=fixtureDB(route),handler=loadHandler(route,db);
  const anon=await handler(new Request('https://fixture/'+route,{method:'POST',headers:{authorization:'Bearer anon'}}));assert.equal(anon.status,401);assert.equal(db.calls.length,0);
  const read=await handler(new Request('https://fixture/'+route));const body=await read.json();assert.equal(body[key][0].status,'PASS');assert.equal(body[key][0].tracking.tracked,false);assert.equal(db.calls.length,0);
  const response=await handler(new Request('https://fixture/'+route,{method:'POST',headers:{authorization:'Bearer service-secret'}}));
  const result=await response.json();assert.equal(result[key][0].status,'PLAY');assert.equal(result[key][0].tracking.tracked,true);assert.equal(result[key][0].tracking.predictionId,'snapshot');assert.equal(db.calls.length,1);assert.equal(db.calls[0].name,'publish_mlb_performance_v1');
 });
 test(route+' recording fault cannot return tracked PLAY, disabled flag retains GET behavior',async()=>{
  const db=fixtureDB(route);db.setFault();const handler=loadHandler(route,db);
  const response=await handler(new Request('https://fixture/'+route,{method:'POST',headers:{authorization:'Bearer service-secret'}}));
  const body=await response.json();assert.equal(body[key][0].status,'PASS');assert.equal(body[key][0].tracking.tracked,false);assert.match(body.publication.faults[0].error,/offline/);
  const disabled=loadHandler(route,fixtureDB(route),false);
  const read=await disabled(new Request('https://fixture/'+route));assert.equal((await read.json())[key][0].status,'PLAY');
  const write=await disabled(new Request('https://fixture/'+route,{method:'POST',headers:{authorization:'Bearer service-secret'}}));assert.equal(write.status,503);
 });
}

test('capture persists original IDs before ledger call and reports added recording faults',async()=>{
 const persisted=[],calls=[];
 const db={from:table=>({insert:rows=>({select:async()=>{persisted.push(...rows);return {data:rows.map((r,i)=>({...r,id:i+1})),error:null};}})}),rpc:async(name,args)=>{calls.push({name,args});return {error:{message:'capture offline'}};}};
 const model={version:'fixture',props:[{eventID:'event',gamePk:900,startsAt:start,playerID:'provider55',mlbPlayerId:55,playerName:'Fixture',statID:'batting_hits',line:.5,side:'over',modelProbability:.6,marketFairProbability:.5,bestOdds:110,bestBook:'book',quoteAt:capture,status:'PLAY'}]};
 const handler=loadHandler('capture-player-props',db,true,async()=>new Response(JSON.stringify(model),{headers:{'content-type':'application/json'}}));
 const response=await handler(new Request('https://fixture/capture',{method:'POST',headers:{authorization:'Bearer service-secret','content-type':'application/json'},body:'{}'}));
 const body=await response.json();assert.equal(persisted.length,1);assert.equal(calls.length,1);assert.equal(body.ok,false);assert.equal(body.rowCount,1);assert.equal(body.tracking.faults[0].sourceKey,'player_prop_observations:1');assert.match(body.tracking.faults[0].error,/offline/);
});
test('history endpoint defaults to read-only dry run and rejects missing page data',async()=>{
 const calls=[];
 const db={from(table){const q={select:()=>q,eq:()=>q,gt:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:null,error:null}),then(resolve){return Promise.resolve({data:null,error:{message:'missing page'}}).then(resolve);}};return q;},rpc:async()=>{calls.push('write');return {};}};
 const handler=loadHandler('import-performance-history',db);
 const response=await handler(new Request('https://fixture/import',{method:'POST',headers:{authorization:'Bearer service-secret','content-type':'application/json'},body:JSON.stringify({table:'market_grade_observations'})}));
 const body=await response.json();assert.equal(response.status,500);assert.equal(body.complete,false);assert.match(body.error,/missing page/);assert.equal(calls.length,0);
});
