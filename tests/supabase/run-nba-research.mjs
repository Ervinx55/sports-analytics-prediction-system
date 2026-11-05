import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {nbaResearchRepository} from '../../supabase/functions/_shared/nba-research-tracking.mjs';
import {adaptNbaTeamResponse} from '../../supabase/functions/_shared/performance-nba-adapter.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);const db=new PGlite();
const sql={begin:async(mode,fn)=>{await db.exec('begin '+mode);try{const r=await fn({unsafe:async(q,args)=>args?(await db.query(q,args)).rows:(await db.exec(q)).at(-1)?.rows??[]});await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}};
try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 await db.exec(readFileSync('supabase/migrations/20261005000000_prediction_performance_ledger.sql','utf8'));
 await db.exec("alter table performance_settlements alter column source_updated_at drop not null;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('performance_service_role_key','fixture-private');create table pipeline_component_registry(component_key text,enabled boolean);insert into pipeline_component_registry values('performance_nba_capture_team',true);grant select on pipeline_component_registry to service_role;create table performance_provider_cooldowns(sport text,provider text,cooldown_until timestamptz,reason text,primary key(sport,provider));grant select,insert,update on performance_provider_cooldowns to service_role;");
 await db.exec(readFileSync('supabase/migrations/20261101153721_nba_research_scoreboard_cache.sql','utf8'));
 await db.exec("create schema net;create sequence net.request_ids;create table net._http_response(id bigint,status_code int,timed_out boolean,error_msg text,created timestamptz,headers jsonb,content text);create function net.http_get(url text,timeout_milliseconds integer) returns bigint language sql as $$ select nextval('net.request_ids') $$;");
 const r=nbaResearchRepository(sql);assert.equal(await r.authorized('Bearer fixture-private'),true);assert.equal(await r.authorized('Bearer public-key'),false);assert.equal(await r.enabled(),true);
 const now=new Date().toISOString(),start=new Date(Date.now()+3600000).toISOString();
 const p=adaptNbaTeamResponse({league:'NBA',sport:'BASKETBALL',version:'fixture',forecastAt:now,markets:[{eventID:'nba:one',marketType:'moneyline',side:'home',startsAt:start,modelProbability:.6,marketFairProbability:.5,home:'Home',away:'Away'}]},{capturedAt:now}).predictions[0];
 assert.equal(await r.capture(p),true);assert.equal(await r.capture({...p,modelProbability:.9}),false);
 const saved=(await db.query('select id,payload,valid from performance_predictions')).rows[0];assert.equal(saved.valid,false);assert.equal(saved.payload.modelProbability,.6);
 const outcome={predictionId:saved.id,outcome:'WIN',source:'espn',sourceUpdatedAt:null,settledAt:now,ruleVersion:'nba-full-game-research-v1',reason:'RESEARCH_DIRECTION_ONLY',researchOnly:true};
 assert.equal(await r.settle(outcome),true);assert.equal(await r.settle({...outcome,outcome:'LOSS'}),false);
 assert.equal((await db.query('select count(*)::int n from performance_settlements')).rows[0].n,1);
 assert.equal((await r.scoreboard('20261101')).error,'SCOREBOARD_PENDING');
 const queued=(await db.query("select request_id from nba_research_scoreboards where scoreboard_date='20261101'")).rows[0];
 await db.query("insert into net._http_response values($1,200,false,null,now(),'{}','{\"events\":[]}')",[queued.request_id]);
 assert.equal((await r.scoreboard('20261101')).ok,true);
 await assert.rejects(r.scoreboard('https://attacker'),/Invalid scoreboard date/);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from nba_research_scoreboards'),/permission denied/);await db.exec('reset role');}
 await r.cool('espn',600);assert.equal(await r.cooldown('espn'),true);
 console.log('NBA research SQL passed: private auth, immutable first capture, diagnostic-only eligibility, idempotent outcomes, cooldown.');
}finally{await db.close();}
