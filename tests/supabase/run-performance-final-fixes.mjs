import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as adapter from '../../supabase/functions/_shared/performance-mlb-adapter.mjs';
import * as qualification from '../../supabase/functions/_shared/performance-mlb-qualification.mjs';
import {adaptModelResponse} from '../../supabase/functions/_shared/performance-model-adapters.mjs';
import {marketKey} from '../../supabase/functions/_shared/performance-contract.mjs';
import {resultRequest,runSettlementPage} from '../../supabase/functions/_shared/performance-worker.mjs';
import {normalizeFinalResult} from '../../supabase/functions/_shared/performance-result-sources.mjs';
import {settlePrediction} from '../../supabase/functions/_shared/performance-settlement.mjs';
import {readPerformance} from '../../supabase/functions/_shared/performance-read.mjs';
const runtime=await import(pathToFileURL(resolve(process.argv[2])).href);
let db;
if(runtime.PGlite)db=new runtime.PGlite();
else {
 if(!['127.0.0.1','localhost','::1'].includes(process.env.PGHOST)||!process.env.PGPORT||!process.env.PGUSER||!process.env.PGPASSWORD_FILE)throw Error('Explicit loopback fixture required');
 const postgres=runtime.default,config={host:process.env.PGHOST,port:Number(process.env.PGPORT),username:process.env.PGUSER,password:readFileSync(process.env.PGPASSWORD_FILE,'utf8').trim(),max:1};
 const admin=postgres({...config,database:'postgres'}),name=`final_fixes_${process.pid}_${Date.now()}`;
 await admin`create database ${admin(name)}`;const sql=postgres({...config,database:name});
 db={exec:s=>sql.unsafe(s,[],{prepare:false}),query:async(s,a)=>({rows:await sql.unsafe(s,a??[],{prepare:false})}),close:async()=>{await sql.end();await admin`drop database ${admin(name)}`;await admin.end();}};
}
const file=n=>readFileSync('supabase/migrations/'+n,'utf8');
const query=async(s,a)=>(await db.query(s,a)).rows;
const rpc=async(name,args)=>{try{return {data:(await query(`select ${name}($1::text::jsonb) value`,[JSON.stringify(args.payload)]))[0].value,error:null};}catch(error){return {data:null,error};}};
const ingest=async p=>(await query('select ingest_prediction_v1($1::text::jsonb) id',[JSON.stringify(p)]))[0].id;
const readClient={rpc:async(name,a)=>({data:(await query('select read_performance_v1($1::timestamptz,$2::timestamptz,$3::text) value',[a.p_from,a.p_to,a.p_sport]))[0].value,error:null})};
function handler(route,client,enabled,fetchImpl=async()=>new Response(JSON.stringify({version:'fixture',candidates:[],props:[]}))){
 let h;const source=stripTypeScriptTypes(readFileSync('supabase/functions/'+route+'/index.ts','utf8').replace(/^import .*;\r?\n/gm,''));
 vm.runInNewContext(source,{...adapter,...qualification,createClient:()=>client,fetch:fetchImpl,Response,Request,URL,URLSearchParams,Date,Map,Set,console,Deno:{env:{get:n=>n==='SUPABASE_SERVICE_ROLE_KEY'?'service-fixture':n.startsWith('PERFORMANCE_MLB_')?String(enabled):'fixture'},serve:fn=>h=fn}});return h;
}
try{
 await db.exec("do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end $$;");
 for(const n of ['20261005000000_prediction_performance_ledger.sql','20261005010000_mlb_performance_publication.sql','20261006000000_sport_capture_receipts.sql','20261006010000_priority_sport_contracts.sql'])await db.exec(file(n));
 // A genuinely pre-migration immutable row and first issuance must survive semantic key migration.
 const stamp=new Date(Date.now()-60000).toISOString(),start=new Date(Date.now()+15*60000).toISOString();
 const rule={version:'fixture-only',book:'book',period:'REGULATION',tie:'PUSH',cancelled:'VOID',shortened:'VOID',nonparticipant:'VOID',appearance:'ANY_APPEARANCE'};
 const old={sourceKey:'old',sport:'NFL',eventKey:'espn:nfl:123',marketType:'moneyline',side:'home',modelVersion:'v',modelMode:'LIVE',modelAvailable:true,capturedAt:stamp,startsAt:start,quoteAt:stamp,odds:100,book:'book',modelProbability:.6,marketProbability:.5,probabilityBasis:'CONDITIONAL_NO_PUSH',sourceIds:{provider:'espn',event:'123'},settlementRule:rule,eligibilityReasons:[]};
 const oldId=await ingest(old);
 await query('select record_decision_v1($1::text::jsonb)',[JSON.stringify({sourceKey:'old-final',predictionId:oldId,issuedAt:new Date().toISOString(),status:'PLAY',qualified:true,evidence:{finalQualification:true}})]);
 const before=(await query('select row_to_json(p) row from performance_predictions p where id=$1',[oldId]))[0].row;
 for(const n of ['20261010010000_exact_market_semantics.sql','20261010020000_final_pass_publication.sql'])await db.exec(file(n));
 assert.deepEqual((await query('select row_to_json(p) row from performance_predictions p where id=$1',[oldId]))[0].row,before);
 // Real queue/read schema and forward read implementation.
 const workerSql=file('20261006020000_register_prediction_performance_jobs.sql');
 await db.exec(workerSql.slice(0,workerSql.indexOf('-- Separate dispatcher')));
 await db.exec(file('20261010030000_global_portfolio_read.sql'));
 // F1: invoke the real recovered triggers, capture actual SQL-generated headers, enter changed handlers.
 const health=file('20260923213738_recover_pipeline_health.sql');await db.exec(health.slice(0,health.indexOf('CREATE OR REPLACE FUNCTION public.enqueue')));
 await db.exec("create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('snapshot_project_url','https://fixture'),('snapshot_publishable_key','publishable-fixture'),('performance_service_role_key','service-fixture');create schema net;create table net.calls(id bigserial,url text,headers jsonb,body jsonb);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into net.calls(url,headers,body) values($1,$2,$3) returning id$$;");
 for(const [component,endpoint] of [['model_audit','capture-model-audit'],['player_prop_capture','capture-player-props'],['unrelated','unchanged']])await query("insert into pipeline_component_registry(component_key,display_name,subsystem,job_name,runner_type,endpoint_path,expected_interval_minutes,stale_after_minutes) values($1,$1,'fixture',$1,'HTTP',$2,60,80)",[component,'/functions/v1/'+endpoint]);
 await db.exec(file('20261010000000_existing_capture_service_dispatch.sql'));
 const triggers=file('20260923213739_recover_posthistory_security_and_cron.sql');await db.exec(triggers.slice(0,triggers.indexOf('CREATE OR REPLACE FUNCTION public.trigger_sharp_source_refresh')));
 for(const [trigger,route] of [['trigger_model_audit','capture-model-audit'],['trigger_player_prop_capture','capture-player-props']]){
  const requestId=(await query(`select ${trigger}() id`))[0].id,request=(await query('select * from net.calls where id=$1',[requestId]))[0];
  assert.equal(request.headers.Authorization,'Bearer service-fixture');
  for(const enabled of [false,true]){
   const response=await handler(route,{},enabled)(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(request.body)}));assert.equal(response.status,200,route+' '+await response.text());
   assert.equal((await handler(route,{},enabled)(new Request(request.url,{method:'POST',headers:{authorization:'Bearer publishable-fixture'},body:'{}'}))).status,401);
  }
 }
 await db.exec("create table model_audit_observations(sport text,starts_at timestamptz,captured_at timestamptz);insert into model_audit_observations values('MLB',now()+interval '15 minutes',now());update pipeline_http_request_log set enqueued_at=now()-interval '10 minutes';");
 const adaptiveSql=file('20260930070000_adaptive_model_capture.sql');await db.exec(adaptiveSql.slice(0,adaptiveSql.indexOf("select cron.schedule")));
 const adaptive=(await query('select trigger_adaptive_model_audit() id,extract(minute from now())::int clock_minute'))[0];
 if([19,20].includes(adaptive.clock_minute))assert.equal(adaptive.id,null);
 else {const request=(await query('select * from net.calls where id=$1',[adaptive.id]))[0];assert.equal(request.headers.Authorization,'Bearer service-fixture');assert.equal(request.body.lookaheadMinutes,120);for(const enabled of [false,true])assert.equal((await handler('capture-model-audit',{},enabled)(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(request.body)}))).status,200);}
 await query("select enqueue_pipeline_http_v1('unrelated')");assert.equal((await query('select headers from net.calls order by id desc limit 1'))[0].headers.Authorization,'Bearer publishable-fixture');
 await db.exec("delete from vault.decrypted_secrets where name='performance_service_role_key'");await assert.rejects(query('select trigger_model_audit()'),/credentials/);
 await db.exec("insert into vault.decrypted_secrets values('performance_service_role_key','service-fixture')");
 console.log('F1 PASS: real existing triggers -> SQL service headers -> changed handlers with flags off/on; unrelated publishable preserved; missing secret fails.');
 // F2: actual team-card evaluator + authenticated handler -> SQL immutable PASS -> read cohort.
 const card={id:701,game_pk:701,event_id:'odds701',starts_at:start,captured_at:stamp,model_version:'pass-v',market_type:'moneyline',market_side:'home',non_sharp_status:'READY_FOR_SHARP_CHECK',model_probability:.6,market_fair_probability:.5,best_odds:100,best_book:'book',raw:{performanceCapture:true,quoteAt:stamp,probabilityBasis:'CONDITIONAL_NO_PUSH',settlementRule:{...rule,period:'FULL_GAME'}}};
 let writes=0;
 const client={rpc:async(n,a)=>{writes++;return rpc(n,a);},from(table){let values=table==='market_grade_latest'?[card]:[];const q={select:()=>q,eq:()=>q,gte:()=>q,gt:()=>q,order:()=>q,limit:()=>q,in:()=>q,then:resolve=>Promise.resolve({data:values,error:null}).then(resolve)};return q;}};
 const finalHandler=handler('market-card',client,true);
 await finalHandler(new Request('https://fixture/market-card'));assert.equal(writes,0);
 const response=await finalHandler(new Request('https://fixture/market-card',{method:'POST',headers:{authorization:'Bearer service-fixture'}}));const body=await response.json();assert.equal(body.passes[0].tracking.tracked,true,JSON.stringify(body));assert.deepEqual(body.publication.faults,[]);
 const passRows=await readPerformance(readClient,{sport:'MLB',cohort:'PASS',from:stamp,to:new Date(Date.now()+3600000).toISOString()});assert.equal(passRows.summary.count,1);
 const passId=body.passes[0].tracking.decisionId;await finalHandler(new Request('https://fixture/market-card',{method:'POST',headers:{authorization:'Bearer service-fixture'}}));assert.equal((await query("select count(*)::int n from performance_decisions where status='PASS'"))[0].n,1);assert.equal((await query("select id from performance_decisions where status='PASS'"))[0].id,passId);
 const passPayload=(await query("select payload from performance_predictions where source_key='market_grade_observations:701'"))[0].payload;
 const evidence={status:'PASS',finalDecision:true,qualificationVersion:'mlb-existing-final-gates-v1',evaluatedAt:new Date().toISOString(),decisionExpiresAt:new Date(Date.now()+20000).toISOString()};
 for(const change of [{provenance:{legacyReconstructed:true}},{startsAt:new Date(Date.now()+3600000).toISOString(),eligibilityStartsAt:new Date(Date.now()+3600000).toISOString(),eventKey:'mlb:702',sourceIds:{provider:'mlb-statsapi',event:'702'}},{capturedAt:new Date(Date.now()+1000).toISOString()}]){const r=await rpc('publish_mlb_pass_v1',{payload:{prediction:{...passPayload,...change,sourceKey:'rejected:'+JSON.stringify(change)},evidence}});assert.ok(r.error);}
 const expired=await rpc('publish_mlb_pass_v1',{payload:{prediction:{...passPayload,sourceKey:'expired-pass'},evidence:{...evidence,decisionExpiresAt:stamp}}});assert.ok(expired.error);assert.equal((await query("select count(*)::int n from performance_predictions where source_key='expired-pass'"))[0].n,0);
 console.log('F2 PASS: real final card handler -> durable PASS -> read cohort; GET no writes, retry immutable, history/early/future/expired evaluation rejected transactionally.');
 // F3: independent synthetic source + explicit crosswalk -> ledger payload -> request -> result adapter -> grader.
 const mapping={provider:'espn',event:'123',player:'55',oddsProvider:'odds-fixture',oddsEvent:'odds123',oddsPlayer:'odds55',validation:{status:'VALIDATED',reference:'fixture-crosswalk-v1',validatedAt:stamp}};
 const source={sport:'FOOTBALL',league:'NFL',version:'nfl-v',forecastAt:stamp,oddsProvider:'odds-fixture',candidates:[{eventID:'odds123',playerID:'odds55',statID:'passing_yards',startsAt:start,side:'over',line:200.5,shadowModelProbability:.6,marketFairProbability:.5,effectiveIndependentWeight:1,updatedAt:stamp,odds:100,book:'book',probabilityBasis:'CONDITIONAL_NO_PUSH',settlementRule:{...rule,period:'INCLUDING_OVERTIME'},resultIdentity:mapping}]};
 const adapted=adaptModelResponse(source,{sport:'NFL',kind:'props',capturedAt:new Date().toISOString()}).predictions[0];assert.deepEqual(adapted.eligibilityReasons,[]);
 const receipt=await rpc('ingest_sport_prediction_v1',{payload:adapted});assert.ifError(receipt.error);const nflId=receipt.data.id,persisted=(await query('select payload from performance_predictions where id=$1',[nflId]))[0].payload;assert.equal(resultRequest(persisted).source,'espn');assert.equal(persisted.sourceIds.odds.event,'odds123');assert.equal(persisted.playerKey,'espn:nfl:55');
 const final={header:{id:'123',uid:'s:20~l:28~e:123',league:{id:'28',uid:'s:20~l:28'},competitions:[{id:'123',status:{type:{name:'STATUS_FINAL',completed:true,state:'post'}},competitors:[{id:'1',homeAway:'home',score:'27',linescores:[7,7,7,0,6].map(displayValue=>({displayValue}))},{id:'2',homeAway:'away',score:'21',linescores:[7,7,7,0,0].map(displayValue=>({displayValue}))}]}]},boxscore:{players:[{team:{id:'1'},statistics:[{name:'passing',keys:['passingYards','completions/passingAttempts'],athletes:[{athlete:{id:'55'},stats:['250','20/30']}]}]}]}};
 const facts=normalizeFinalResult(final,{sport:'NFL',source:'espn'});assert.equal(settlePrediction({...persisted,id:nflId},facts).outcome,'WIN');
 const queueClient={rpc:async(name,a)=>{
  if(name==='claim_performance_settlements_v1')return {data:(await query('select claim_performance_settlements_v1($1,$2) value',[a.p_sport,a.p_limit]))[0].value,error:null};
  if(name==='renew_performance_settlement_v1')return {data:(await query('select renew_performance_settlement_v1($1,$2) value',[a.p_prediction,a.p_token]))[0].value,error:null};
  return {data:(await query('select complete_performance_settlement_v1($1,$2,$3::text::jsonb,$4,$5) value',[a.p_prediction,a.p_token,JSON.stringify(a.p_settlement),a.p_error,a.p_cooldown_seconds]))[0].value,error:null};
 }};
 const due={...persisted,sourceKey:'nfl-worker',startsAt:new Date(Date.now()+100).toISOString(),eligibilityStartsAt:new Date(Date.now()+100).toISOString(),provenance:{...adapted.provenance}};
 const dueReceipt=await rpc('ingest_sport_prediction_v1',{payload:due});assert.ifError(dueReceipt.error);
 await new Promise(r=>setTimeout(r,150));
 const completed=await runSettlementPage(queueClient,{sport:'NFL',fetchImpl:async url=>{assert.match(url,/summary\?event=123$/);return Response.json(final);}});assert.equal(completed.settled,1);assert.deepEqual(completed.faults,[]);
 assert.equal((await query('select outcome from performance_settlements where prediction_id=$1',[dueReceipt.data.id]))[0].outcome,'WIN');
 for(const bad of [null,{...mapping,ambiguous:true},{...mapping,oddsEvent:'wrong'},{...mapping,validation:{...mapping.validation,validatedAt:start}}]){const p=adaptModelResponse({...source,candidates:[{...source.candidates[0],resultIdentity:bad}]},{sport:'NFL',kind:'props',capturedAt:new Date().toISOString()}).predictions[0];assert.ok(p.eligibilityReasons.includes('EXACT_RESULT_MAPPING_UNAVAILABLE'));assert.equal(resultRequest(p),null);}
 console.log('F3 PASS: capture -> actual ledger payload -> result request -> ESPN normalization -> player WIN; missing/ambiguous/misbound/future mappings excluded.');
 // F4: old equivalent issuance retained; distinct scope and complete policy get distinct keys.
 for(const [key,policy] of [['same',rule],['ot',{...rule,period:'INCLUDING_OVERTIME'}],['tie-void',{...rule,tie:'VOID'}]]){
  const p={...old,sourceKey:key,settlementRule:policy},id=await ingest(p);const saved=(await query('select market_key from performance_predictions where id=$1',[id]))[0];assert.deepEqual(JSON.parse(saved.market_key),JSON.parse(marketKey(p)));
  const decision=await rpc('record_decision_v1',{payload:{sourceKey:key+':final',predictionId:id,issuedAt:new Date().toISOString(),status:'PLAY',qualified:true,evidence:{finalQualification:true}}});assert.ifError(decision.error);
  assert.equal((await query('select first_issued from performance_decisions where id=$1',[decision.data]))[0].first_issued,key!=='same');
 }
 assert.equal(settlePrediction(old,facts).outcome,'PUSH');assert.equal(settlePrediction({...old,settlementRule:{...rule,period:'INCLUDING_OVERTIME'}},facts).outcome,'WIN');
 for(const sport of ['MLB','NFL','NBA','CFB','NHL','TENNIS','SOCCER'])assert.notEqual(marketKey({...old,sport}),marketKey({...old,sport,settlementRule:{...rule,cancelled:'UNRESOLVED'}}));
 console.log('F4 PASS: old row unchanged, same semantic market cannot reissue first PLAY; regulation PUSH / overtime WIN and different tie policy are distinct.');
 // F5: historical midnight boundary + market filters cannot replace first equivalent entry.
 for(const [key,market,at,odds,outcome] of [['half-first','player_batting_hits','2026-01-01T23:59:00Z',100,'LOSS'],['half-later','player_batting_totalBases','2026-01-02T00:01:00Z',300,'WIN']]){
  const p={...old,sourceKey:key,sport:'MLB',eventKey:'mlb:999',playerKey:'mlb:55',marketType:market,side:'over',line:.5,capturedAt:at,quoteAt:at,startsAt:'2026-01-02T00:15:00Z',settlementRule:{...rule,period:'FULL_GAME'},sourceIds:{provider:'mlb-statsapi',event:'999',player:'55'},odds};const id=await ingest(p);
  // Historical fixture simulates already recorded issuance; production APIs correctly disallow backdated creation now.
  await query("insert into performance_decisions(source_key,prediction_id,market_key,issued_at,status,qualified,evidence,legacy_reconstructed,first_issued,payload) select $1,id,market_key,$2::timestamptz,'PLAY',true,'{}',false,true,'{}' from performance_predictions where id=$3",[key+':final',at,id]);
  await query("insert into performance_settlements(prediction_id,revision,outcome,source,source_updated_at,settled_at,rule_version,payload) values($1,1,$2,'fixture',now(),now(),'fixture','{}')",[id,outcome]);
 }
 const broad=await readPerformance(readClient,{sport:'MLB',cohort:'PLAY',from:'2026-01-01',to:'2026-01-03'});assert.equal(broad.summary.count,1);assert.equal(broad.summary.hypotheticalUnitProfit,-1);
 const narrow=await readPerformance(readClient,{sport:'MLB',cohort:'PLAY',from:'2026-01-02',to:'2026-01-03'});assert.equal(narrow.summary.count,0);
 const market=await readPerformance(readClient,{sport:'MLB',cohort:'PLAY',from:'2026-01-01',to:'2026-01-03',market:'player_batting_totalBases'});assert.equal(market.summary.count,0);
 const research=await readPerformance(readClient,{sport:'MLB',cohort:'ALL',from:'2026-01-02',to:'2026-01-03',market:'player_batting_totalBases'});assert.equal(research.summary.count,1);assert.equal(research.summary.hypotheticalUnitProfit,3);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(query("select publish_mlb_pass_v1('{}')"),/permission denied/);await assert.rejects(query("select trigger_model_audit()"),/permission denied/);await db.exec('reset role');}
 console.log('F5 PASS: SQL sees earlier counterpart outside interval; midnight/market filters cannot substitute improved odds; ALL research retains exact alternative. RLS denied.');
}finally{await db.close();}
