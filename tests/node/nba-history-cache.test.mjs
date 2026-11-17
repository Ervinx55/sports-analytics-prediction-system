import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const fixture=JSON.parse(readFileSync(new URL('../fixtures/nba-bdl-live-v44.json',import.meta.url),'utf8'));
const modulePath='scripts/local/bdl-live.mjs';
const baseline=process.env.NBA_HISTORY_CACHE_BASELINE==='1';
const patcher=baseline?{patchHistoryCacheSource:s=>s}:await import('../../scripts/nba/patch-hosted-history-cache.mjs');
const root=mkdtempSync(join(tmpdir(),'nba-history-cache-'));
for(const file of fixture.files){const path=join(root,file.name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,file.name===modulePath?patcher.patchHistoryCacheSource(file.content):file.content);}
const {createBdlBackup,liveBdlContract}=await import(pathToFileURL(join(root,modulePath)));
test.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'nba-history-cache-'));rmSync(root,{recursive:true,force:true});});
const now='2026-11-17T16:00:00.000Z';
function sourcePair(){
 const event={eventID:'CACHE_TEST',leagueID:'NBA',type:'match',status:{startsAt:'2026-11-10T00:00:00.000Z',finalized:true,completed:true,ended:true},teams:{home:{teamID:'HOME_NBA',names:{long:'Home'}},away:{teamID:'AWAY_NBA',names:{long:'Away'}}},players:{},results:{game:{}}};
 const backup={id:123,datetime:event.status.startsAt,status:'Final',postponed:false,season:2026,period:4,home_team_score:50,visitor_team_score:50,home_team:{full_name:'Home',players:[]},visitor_team:{full_name:'Away',players:[]}};
 for(const [side,bs,offset] of [['home','home',0],['away','visitor',10]]){
  event.results.game[side]={points:50,rebounds:20,assists:10,fieldGoalsAttempted:25,freeThrowsAttempted:0,offensiveRebounds:0,turnovers:5};
  for(let n=1;n<=5;n++){
   const playerID=side.toUpperCase()+n+'_NBA';
   event.players[playerID]={playerID,teamID:event.teams[side].teamID,name:side+' Player'+n};
   event.results.game[playerID]={secondsPlayed:2880,points:10,rebounds:4,assists:2,fieldGoalsAttempted:5,freeThrowsAttempted:0,offensiveRebounds:0,turnovers:1};
   backup[bs+'_team'].players.push({player:{id:offset+n,first_name:side,last_name:'Player'+n},min:'48:00',pts:10,reb:4,ast:2,fga:5,fta:0,oreb:0,turnover:1,fgm:5,fg3m:0,ftm:0,dreb:4});
  }
 }
 return {event,backup};
}
function scenario({mutate=()=>{},status=401,cooldown=false,fetchBody=null,responseText=undefined,retrievedAt='2026-11-12T10:00:00.000Z'}={}){
 const {event,backup}=sourcePair();mutate(event,backup);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(event.status.startsAt));
 const packet={body:{data:[backup]},url:'https://api.balldontlie.io/v1/box_scores?date='+date,sha256:'a'.repeat(64),retrievedAt};
 const key='bdl-date:'+date+':'+packet.sha256+':'+packet.retrievedAt;
 const state={bdl:{dates:{[date]:{key,retrievedAt}},...(cooldown?{nextRequestAt:Date.parse(now)+3600000,lastError:'BDL_HTTP_401'}:{})}};
 const summaries={};let calls=0,loads=0;
 const run=createBdlBackup({key:'test-key',state,summaries,clock:()=>now,loadSummaries:async ids=>{loads++;assert.deepEqual(ids,[key]);return {[key]:packet};},fetchImpl:async()=>{calls++;return responseText!==undefined?new Response(responseText,{status:200}):fetchBody?new Response(JSON.stringify(fetchBody),{status:200}):new Response('',{status});}});
 return {event,backup,packet,state,summaries,run,counts:()=>({calls,loads})};
}

test('expired final cache recovers after 401 while retaining acquisition failure and original receipt',async()=>{
 const s=scenario();const result=await s.run(s.event,now);
 assert.equal(result.players.length,10);
 assert.equal(result.players[0].points,10);
 assert.equal(result.backupEvidence.retrievedAt,'2026-11-12T10:00:00.000Z');
 assert.equal(result.backupEvidence.staleCacheFallback.reason,'BDL_HTTP_401');
 assert.equal(result.backupEvidence.staleCacheFallback.retrievedAt,'2026-11-12T10:00:00.000Z');
 assert.equal(s.state.bdl.lastError,'BDL_HTTP_401');
 assert.equal(s.state.bdl.lastAcquisitionError,'BDL_HTTP_401');
 assert.equal(s.state.bdl.lastAcquisitionAttemptAt,now);
 assert.equal(s.state.bdl.staleFallback.accepted,1);
 assert.equal(s.state.bdl.staleFallback.events.CACHE_TEST.status,'ACCEPTED');
 assert.deepEqual(s.counts(),{calls:1,loads:1});
 assert.equal(s.state.bdl.dates['2026-11-09'].retrievedAt,'2026-11-12T10:00:00.000Z');
});

test('cooldown can reuse a strictly reconciled cached final without consuming network budget',async()=>{
 const s=scenario({cooldown:true});const result=await s.run(s.event,now);
 assert.equal(result.backupEvidence.staleCacheFallback.reason,'BDL_COOLDOWN');
 assert.equal(s.state.bdl.lastError,'BDL_HTTP_401');
 assert.deepEqual(s.counts(),{calls:0,loads:1});
});

test('fallback rejects incomplete, changed, ambiguous, and nonfinal source data',async()=>{
 const cases=[
  [(e,b)=>b.home_team.players.pop(),'INCOMPLETE_TEAM_MINUTES'],
  [(e,b)=>b.status='3rd Qtr','BACKUP_GAME_UNVERIFIED'],
  [(e,b)=>e.results.game.HOME1_NBA.points=11,'PLAYER_STATS_CONFLICT'],
  [(e,b)=>e.players.HOME1_NBA.name='Different Person','PLAYER_MAPPING_UNVERIFIED'],
  [(e,b)=>b.home_team_score=51,'GAME_TEAM_OR_SCORE_CONFLICT'],
  [(e,b)=>b.home_team.full_name='Another Team','BACKUP_GAME_NOT_UNIQUE'],
 ];
 for(const [mutate,reason] of cases){
  const s=scenario({mutate,cooldown:true});
  await assert.rejects(s.run(s.event,now),new RegExp(reason));
  assert.equal(s.state.bdl.staleFallback.accepted,0);
  assert.equal(s.state.bdl.lastError,'BDL_HTTP_401');
 }
 const duplicate=scenario({cooldown:true});duplicate.packet.body.data.push(structuredClone(duplicate.backup));
 await assert.rejects(duplicate.run(duplicate.event,now),/BACKUP_GAME_NOT_UNIQUE/);
});

test('fallback never uses future, pregame, mismatched, or recent packet provenance',async()=>{
 for(const retrievedAt of ['2026-11-18T00:00:00.000Z','2026-11-09T00:00:00.000Z']){
  const s=scenario({retrievedAt,cooldown:true});await assert.rejects(s.run(s.event,now),/BDL_STALE_CACHE_PROVENANCE/);
 }
 const mismatch=scenario({cooldown:true});mismatch.packet.url+='&other=1';
 await assert.rejects(mismatch.run(mismatch.event,now),/BDL_STALE_CACHE_PROVENANCE/);
 const recent=scenario({cooldown:true,retrievedAt:'2026-11-17T09:00:00.000Z',mutate:(e,b)=>{e.status.startsAt=b.datetime='2026-11-17T01:00:00.000Z';}});
 await assert.rejects(recent.run(recent.event,now),/BDL_COOLDOWN/);
 const live=scenario({cooldown:true});live.event.status.finalized=false;
 await assert.rejects(live.run(live.event,now),/SOURCE_NOT_FINAL/);
});

test('successful refresh is authoritative and does not fall back on new conflicting or malformed data',async()=>{
 const newer=sourcePair().backup;newer.home_team_score=51;
 const s=scenario({fetchBody:{data:[newer]}});
 await assert.rejects(s.run(s.event,now),/GAME_TEAM_OR_SCORE_CONFLICT/);
 assert.equal(s.state.bdl.staleFallback.accepted,0);
 assert.equal(s.counts().loads,0);
 const malformed=scenario({fetchBody:{data:'invalid'}});
 await assert.rejects(malformed.run(malformed.event,now),/BDL_INVALID_RESPONSE/);
});

test('fresh cache retains normal behavior and does not invent a fallback label',async()=>{
 const s=scenario({retrievedAt:'2026-11-17T15:00:00.000Z'});const result=await s.run(s.event,now);
 assert.equal(result.backupEvidence.staleCacheFallback,undefined);
 assert.equal(result.backupEvidence.retrievedAt,'2026-11-17T15:00:00.000Z');
 assert.deepEqual(s.counts(),{calls:0,loads:1});
});

test('HTTP 200 invalid JSON or null is an invalid response and never triggers cached recovery',async()=>{
 for(const responseText of ['{invalid','null','']){
  const s=scenario({responseText});
  await assert.rejects(s.run(s.event,now),/BDL_INVALID_RESPONSE/);
  assert.equal(s.state.bdl.staleFallback.accepted,0);
  assert.equal(s.state.bdl.lastAcquisitionError,'BDL_INVALID_RESPONSE');
  assert.deepEqual(s.counts(),{calls:1,loads:0});
 }
});

test('cached verification cannot erase a live acquisition failure and a real successful fetch can clear it',async()=>{
 const cached=scenario({retrievedAt:'2026-11-17T15:00:00.000Z'});
 cached.state.bdl.lastError='BDL_HTTP_401';cached.state.bdl.lastAcquisitionError='BDL_HTTP_401';
 await cached.run(cached.event,now);
 assert.equal(cached.state.bdl.lastError,'BDL_HTTP_401');
 assert.equal(cached.state.bdl.lastAcquisitionError,'BDL_HTTP_401');
 const refreshed=scenario({fetchBody:{data:[sourcePair().backup]}});
 refreshed.state.bdl.lastAcquisitionError='BDL_HTTP_401';
 const result=await refreshed.run(refreshed.event,now);
 assert.equal(refreshed.state.bdl.lastAcquisitionError,null);
 assert.equal(refreshed.state.bdl.lastSuccessfulFetchAt,now);
 assert.equal(result.backupEvidence.staleCacheFallback,undefined);
});

test('immutable bundle patch preserves models, corrections, reconciliation rules, and authentication',async()=>{
 if(baseline)return;
 const bundle={...fixture,files:[...fixture.files,{name:'frozen-model.json',content:'frozen-model'}]};
 const patched=patcher.patchHostedHistoryCacheBundle(bundle);
 const changed=patched.files.filter(f=>f.content!==bundle.files.find(o=>o.name===f.name).content).map(f=>f.name);
 assert.deepEqual(changed,[modulePath]);
 assert.equal(patched.verify_jwt,true);
 assert.equal(patched.audit.settlementRulesChanged,false);
 assert.equal(patched.audit.productionWeightChanged,false);
 const original=fixture.files.find(f=>f.name===modulePath).content;
 const originalRoot=join(root,'original');
 for(const file of fixture.files){const path=join(originalRoot,file.name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,file.content);}
 const old=await import(pathToFileURL(join(originalRoot,modulePath)));
 assert.equal(liveBdlContract,old.liveBdlContract);
 assert.equal(createHash('sha256').update(original).digest('hex'),patcher.originalBdlSha256);
 for(const changedBundle of [{...bundle,version:45},{...bundle,verify_jwt:false},{...bundle,files:[...bundle.files,bundle.files[0]]}])assert.throws(()=>patcher.patchHostedHistoryCacheBundle(changedBundle));
 assert.throws(()=>patcher.patchHistoryCacheSource(original+'\n'),/SOURCE_CHANGED/);
});
