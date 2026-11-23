import test from 'node:test';
import assert from 'node:assert/strict';
import * as nba from '../../sharp-service/api/nbaprops.js';
import {researchPropsResponse} from '../../sharp-service/lib/nba-research-props.js';
import {normalizeResearch} from '../../sharp-service/research-data.js';

const now=Date.parse('2026-11-23T12:00:00Z');
const stamp=new Date(now).toISOString();
const playerID='PLAYER_ONE_NBA';
function event(){
 const oddID=`points-${playerID}-game-ou-over`;
 return {eventID:'g1',leagueID:'NBA',type:'match',status:{startsAt:'2026-11-23T20:00:00Z'},teams:{home:{teamID:'HOME_NBA'},away:{teamID:'AWAY_NBA'}},players:{[playerID]:{playerID,name:'Player One',teamID:'HOME_NBA'}},odds:{[oddID]:{oddID,playerID,statID:'points',sideID:'over',periodID:'game',betTypeID:'ou',byBookmaker:{draftkings:{overUnder:'20.5',odds:'-110',available:true,lastUpdatedAt:stamp}}}}};
}
const load=async(nextCursor=null)=>researchPropsResponse({now,key:'test',optimize:async()=>({blocked:false,effectiveLimit:16}),fetchPage:async()=>({payload:{success:true,data:[event()],nextCursor},fetchedAt:now,cacheStatus:'HIT'})});

test('live NBA research exposes missing playing-time, injury and calibration gates without a prediction',async()=>{
 const {body}=await load();
 const readiness=body.events[0].players[0].propReadiness;
 assert.ok(readiness,'the deployed research contract must expose prop readiness');
 assert.equal(readiness.status,'AVOID_UNVERIFIED');
 assert.equal(readiness.identityStatus,'PROVIDER_ROSTER_MATCHED');
 assert.equal(readiness.projectedMinutes,null);
 assert.equal(readiness.modelProbability,null);
 assert.equal(readiness.productionEligible,false);
 assert.equal(readiness.productionWeight,0);
 for(const reason of ['PROJECTED_MINUTES_UNAVAILABLE','ROTATION_UNCONFIRMED','PLAYER_INJURY_CLEARANCE_UNVERIFIED','PROP_CALIBRATION_UNVALIDATED'])assert.ok(readiness.reasons.includes(reason),reason);
 const row=normalizeResearch(body,'NBA',now)[0];
 assert.deepEqual(row.propReadiness,readiness);
 assert.match(row.reason,/playing time/i);
 assert.match(row.reason,/injury/i);
 assert.equal(row.model,null);
 assert.equal(row.status,'QUOTE ONLY');
});

test('malformed pagination cannot advertise complete research coverage',async()=>{
 for(const cursor of [false,0,{},[]]){
  const {body}=await load(cursor);
  assert.equal(body.coverage.eventsComplete,false,JSON.stringify(cursor));
  assert.ok(body.coverage.reasons.includes('INVALID_CURSOR'));
 }
});

test('NBA research collects quotes and historical context concurrently and survives context failure',async()=>{
 assert.equal(typeof nba.nbaResearchResponse,'function');
 let release,started=false;
 const waiting=new Promise(resolve=>{release=resolve;});
 const response=nba.nbaResearchResponse({now,loadQuotes:async()=>{await waiting;return load();},loadExplanation:async()=>{started=true;release();throw Error('private context failure');}});
 const result=await response;
 assert.equal(started,true);
 assert.equal(result.status,200);
 assert.equal(result.body.events.length,1);
 assert.equal(result.body.events[0].players[0].propReadiness.modelProbability,null);
 assert.ok(!JSON.stringify(result).includes('private context failure'));
});

test('a failed quote response does not create an unhandled context rejection',async()=>{
 assert.equal(typeof nba.nbaResearchResponse,'function');
 const result=await nba.nbaResearchResponse({now,loadQuotes:async()=>({status:503,body:{status:'UNAVAILABLE',events:[]}}),loadExplanation:async()=>{throw Error('private');}});
 assert.equal(result.status,503);
});

test('PrizePicks diagnostic is authenticated on the deployed NBA route before provider access',async()=>{
 const names=['SHARP_MONITOR_TOKEN','SPORTS_ODDS_API_KEY','Sports_Game_Odds_API'];
 const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const oldFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('unauthorized upstream request');};
 const invoke=async headers=>{
  const r={headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  await nba.default({method:'GET',query:{view:'prizepicks'},headers},r);return r;
 };
 try{
  for(const name of names)delete process.env[name];
  const absent=await invoke({});assert.equal(absent.statusCode,503);assert.equal(absent.body.reason,'MONITOR_AUTH_UNAVAILABLE');
  process.env.SHARP_MONITOR_TOKEN='test-monitor-token';
  const denied=await invoke({'x-monitor-token':'incorrect'});assert.equal(denied.statusCode,401);
  assert.equal(denied.headers['Cache-Control'],'private, no-store');
  assert.equal(calls,0);
 }finally{globalThis.fetch=oldFetch;for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
});

test('rescheduled NFL quotes cannot inherit a forecast for the old kickoff',()=>{
 const data={contract:'nfl-multibook-research-v1',generatedAt:stamp,candidates:[{eventID:'game',startsAt:'2026-11-23T18:00:00Z',playerID:'p',playerName:'Player',statID:'yards',side:'OVER',line:30.5,bestBook:'draftkings',bestOdds:-110,rawIndependentProbability:.75}],events:[{eventID:'game',startsAt:'2026-11-23T21:00:00Z',players:[{prop:{playerID:'p',playerName:'Player',statID:'yards',over:{books:{draftkings:{line:30.5,odds:-110,available:true,updatedAt:stamp}}}}}]}]};
 const row=normalizeResearch(data,'NFL',now)[0];
 assert.equal(row.model,null);
 assert.equal(row.status,'QUOTE ONLY');
});
