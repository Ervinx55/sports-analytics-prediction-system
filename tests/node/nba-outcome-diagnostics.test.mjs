import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchCollectorSource} from '../../scripts/nba/patch-hosted-outcome-fairness.mjs';

const original=patchCollectorSource(readFileSync(new URL('../fixtures/nba-outcome-collector-v42.txt',import.meta.url),'utf8'));
const baseline=process.env.NBA_DIAGNOSTIC_BASELINE==='1';
const patcher=baseline?{patchDiagnosticsSource:s=>s}:await import('../../scripts/nba/patch-hosted-outcome-diagnostics.mjs');
const history=readFileSync(new URL('../fixtures/nba-outcome-history-v43.txt',import.meta.url),'utf8').replaceAll('export ','');
const {sgoOutcome,parseSgoNbaSummary}=Function(history+';return {sgoOutcome,parseSgoNbaSummary};')();
const clock=()=> '2026-11-16T12:00:00Z';
function eventFixture(){
 const e={eventID:'game1',leagueID:'NBA',type:'match',status:{startsAt:'2026-11-15T00:00:00Z',finalized:true,completed:true,ended:true},teams:{home:{teamID:'HOME_NBA'},away:{teamID:'AWAY_NBA'}},players:{},results:{game:{}}};
 const stats={secondsPlayed:2880,points:10,rebounds:4,assists:2,fieldGoalsAttempted:5,freeThrowsAttempted:0,offensiveRebounds:0,turnovers:1};
 for(const side of ['home','away']){
  e.results.game[side]={points:50,rebounds:20,assists:10,fieldGoalsAttempted:25,freeThrowsAttempted:0,offensiveRebounds:0,turnovers:5};
  for(let n=0;n<5;n++){const playerID=side.toUpperCase()+n+'_NBA';e.players[playerID]={playerID,teamID:e.teams[side].teamID};e.results.game[playerID]={...stats};}
 }
 return e;
}
const rowFixture=(changes={})=>({identity:'quote1',eventID:'sgo:game1',playerID:'HOME0_NBA',market:'points',side:'OVER',line:9.5,startsAt:'2026-11-15T00:00:00Z',receivedAt:'2026-11-14T23:00:00Z',context:{sourceContract:'sgo-nba-v1',teamId:'HOME_NBA',opponentTeamId:'AWAY_NBA'},...changes});
async function replay({rows=[rowFixture()],event=eventFixture(),failure=null,source=patcher.patchDiagnosticsSource(original),includeEvent=true}={}){
 const selectorCode=source.slice(source.indexOf('export function selectSgoSettlementEvents'),source.indexOf('export async function exactSgoEvents')).replace('export ','');
 const helpers=source.includes('function settlementFailureCode')?source.slice(source.indexOf('function settlementFailureCode'),source.indexOf('export function selectSgoSettlementEvents')):'';
 const settleCode=source.slice(source.indexOf(' const settlePending=async()=>{'),source.indexOf(' // Alternate priority'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('db','state','clock','exactSgoEvents','page','season','sgoOutcome','parseSgoNbaSummary','liveBackup','resolvedSummary','backupArchive','bdlArchive','report',helpers+selectorCode+settleCode+';await settlePending();');
 const outcomes=[],report={settled:0,faults:[]},state={},requests={provider:0,backup:0};
 await run({pending:()=>rows,settle:o=>{outcomes.push(o);return 1;}},state,clock,async()=>{requests.provider++;return {events:includeEvent?[event]:[],observedAt:clock()};},null,()=>2026,sgoOutcome,parseSgoNbaSummary,true,async e=>{requests.backup++;if(failure)throw Error(failure);return parseSgoNbaSummary(e,clock(),2026);},null,null,report);
 return {outcomes,report,state,requests};
}

test('bounded statistic failures survive reporting without leaking arbitrary errors',async()=>{
 for(const [failure,want] of [
  ['TEAM_TOTAL_CONFLICT_rebounds','TEAM_TOTAL_CONFLICT_rebounds'],
  ['PLAYER_STATS_CONFLICT_steals','PLAYER_STATS_CONFLICT_steals'],
  ['PLAYER_DERIVED_STATS_CONFLICT_points+rebounds+assists','PLAYER_DERIVED_STATS_CONFLICT_points+rebounds+assists'],
  ['PLAYER_MAPPING_UNVERIFIED','PLAYER_MAPPING_UNVERIFIED'],
  ['TEAM_TOTAL_CONFLICT_secretToken','SETTLEMENT_SOURCE_FAILED'],
  ['request https://private.example/?key=secret','SETTLEMENT_SOURCE_FAILED'],
  ['PLAYER_STATS_CONFLICT_steals\nsecret','SETTLEMENT_SOURCE_FAILED'],
  ['PLAYER_STATS_CONFLICT_steals\n','SETTLEMENT_SOURCE_FAILED']
 ]){
  const e=eventFixture();delete e.results.game.home.points;
  const {report,outcomes}=await replay({event:e,failure});
  assert.equal(report.settlement.failures['sgo:game1'],want);
  assert.deepEqual(outcomes,[]);
 }
});

test('missing positive-minute player gets an unresolved reason and no inactive outcome',async()=>{
 const rows=[rowFixture({playerID:'MISSING_NBA'}),rowFixture({identity:'quote2',playerID:'MISSING_NBA',market:'rebounds'})];
 const {report,outcomes}=await replay({rows});
 assert.deepEqual(outcomes,[]);
 assert.deepEqual(report.settlement.unresolved,{'sgo:game1':{VERIFIED_POSITIVE_MINUTE_PLAYER_MISSING:2}});
 assert.equal(report.settlement.unresolvedRows,2);
 assert.deepEqual(report.settlement.failures,{});
});

test('identity and chronology blockers stay distinct from source failure',async()=>{
 for(const [row,reason] of [
  [rowFixture({context:{sourceContract:'sgo-nba-v1',teamId:'AWAY_NBA',opponentTeamId:'HOME_NBA'}}),'SUMMARY_PLAYER_TEAM_MISMATCH'],
  [rowFixture({receivedAt:'2026-11-15T00:00:00Z'}),'FORECAST_NOT_PREGAME'],
  [rowFixture({startsAt:'2026-11-15T01:00:00Z'}),'FORECAST_START_MISMATCH']
 ]){
  const {report,outcomes}=await replay({rows:[row]});
  assert.deepEqual(outcomes,[]);
  assert.deepEqual(report.settlement.unresolved,{'sgo:game1':{[reason]:1}});
 }
 const absent=await replay({includeEvent:false});
 assert.deepEqual(absent.report.settlement.unresolved,{'sgo:game1':{SGO_SETTLEMENT_EVENT_MISSING:1}});
});

test('diagnostics preserve staged outcomes, event rotation, request counts, and frozen bundle bytes',async()=>{
 const before=await replay({source:original}),after=await replay();
 assert.deepEqual(after.outcomes,before.outcomes);
 assert.equal(after.outcomes[0].outcome,'WIN');
 assert.deepEqual(after.state,before.state);
 assert.deepEqual(after.requests,before.requests);
 assert.deepEqual(after.report.settlement.unresolved,{});
 if(baseline)return;
 const bundle={slug:'collect-nba-props',version:43,verify_jwt:true,files:[{name:patcher.collectorPath,content:original},{name:'frozen.json',content:'{"weight":0,"forecast":"immutable"}'}]};
 const saved=JSON.stringify(bundle),result=patcher.patchHostedDiagnosticsBundle(bundle);
 assert.equal(JSON.stringify(bundle),saved);
 assert.equal(result.files[1].content,bundle.files[1].content);
 assert.deepEqual(result.audit.changedFiles,[patcher.collectorPath]);
 assert.equal(result.verify_jwt,true);
 assert.throws(()=>patcher.patchHostedDiagnosticsBundle({...bundle,version:44}),/CHANGED_REVIEW_REQUIRED/);
 assert.throws(()=>patcher.patchHostedDiagnosticsBundle({...bundle,verify_jwt:false}),/CHANGED_REVIEW_REQUIRED/);
 assert.throws(()=>patcher.patchDiagnosticsSource(original+'\n'),/SOURCE_CHANGED_REVIEW_REQUIRED/);
 assert.throws(()=>patcher.patchHostedDiagnosticsBundle({...bundle,files:[...bundle.files,bundle.files[0]]}),/INVALID_HOSTED_FILES/);
});
