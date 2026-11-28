import test from 'node:test';
import assert from 'node:assert/strict';
import {nbaScenarioTargets,nbaScenarioHistory} from '../../sharp-service/lib/nba-scenario-history.js';
import {createNbaPropScenariosHandler} from '../../sharp-service/handlers/nba-prop-scenarios.js';

const asOf='2026-11-28T15:00:00.000Z';
const target={eventID:'sgo:next',playerID:'PLAYER_1_NBA',teamId:'A_NBA',opponentTeamId:'B_NBA',startsAt:'2026-11-29T01:00:00.000Z'};
function fixture(){
  return {contract:'nba-explanation-snapshot-v1',generatedAt:asOf,targets:[target],
    history:[10,20,30].map((points,i)=>({
      archiveSha256:'a'.repeat(64),
      summary:{id:'sgo:history'+i,startsAt:`2026-11-${20+i}T01:00:00Z`,observedAt:'2026-11-27T12:00:00Z',
        teams:[{id:'A_NBA'},{id:'C_NBA'}],players:[{id:target.playerID,teamId:target.teamId,minutes:30,points,rebounds:5,assists:4}],
        backupEvidence:{bdlGameID:100+i,sourceSha256:'a'.repeat(64),retrievedAt:'2026-11-27T11:00:00Z',
          playerCrosswalk:[{sgoPlayerID:target.playerID,teamId:target.teamId,bdlPlayerID:42}]}},
      raw:{id:100+i,datetime:`2026-11-${20+i}T01:00:00Z`,status:'Final',home_team:{players:[{player:{id:42,position:'G'},min:'30:00',pts:points,reb:5,ast:4}]},visitor_team:{players:[]}}
    }))};
}
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
const query={mode:'nba-prop-scenarios',live:'1',eventId:target.eventID,playerId:target.playerID,market:'points_assists',thresholds:'15,20,25',direction:'at_least',minutes:'24,36'};

test('history adapter verifies paired totals against the exact archived player and preserves input',()=>{
  const s=fixture(),original=JSON.stringify(s),r=nbaScenarioHistory(s,{eventID:target.eventID,playerID:target.playerID,asOf});
  assert.equal(r.status,'AVAILABLE');assert.equal(r.rows.length,3);
  assert.deepEqual(r.rows.map(x=>x.points+x.assists),[14,24,34]);
  assert.equal(r.rows[0].observedAt,'2026-11-27T12:00:00.000Z');
  assert.equal(JSON.stringify(s),original);
});
test('wrong archived totals and future archive observations cannot enter a scenario',()=>{
  const s=fixture();s.history[0].raw.home_team.players[0].pts=99;
  s.history[1].summary.backupEvidence.retrievedAt='2026-11-29T00:00:00Z';
  const r=nbaScenarioHistory(s,{eventID:target.eventID,playerID:target.playerID,asOf});
  assert.equal(r.rows.length,1);
  assert.equal(r.sourceValidation.excludedCounts.ARCHIVED_PLAYER_TOTALS_UNVERIFIED,1);
  assert.equal(r.sourceValidation.excludedCounts.ARCHIVE_TIME_UNVERIFIED,1);
});
test('malformed source members are diagnosed without crashing the adapter or handler',async()=>{
  for(const malformed of [{players:{}},{players:[null]},{teams:[null,{id:'C_NBA'}]}]){
    const s=fixture();Object.assign(s.history[0].summary,malformed);
    const data=nbaScenarioHistory(s,{eventID:target.eventID,playerID:target.playerID,asOf});
    assert.equal(data.rows.length,2);
    const handle=createNbaPropScenariosHandler({readSnapshot:async()=>s,clock:()=>asOf});
    const r=res();await handle({method:'GET',query},r);
    assert.equal(r.code,200);assert.equal(r.body.status,'INSUFFICIENT_HISTORY');
  }
});
test('source final headers and archive retrieval must agree with the historical game chronology',()=>{
  for(const mutate of [s=>{s.history[0].summary.backupEvidence.retrievedAt='2026-11-01T00:00:00Z';},
    s=>{s.history[0].raw.datetime='2026-12-10T00:00:00Z';},s=>{delete s.history[0].raw.datetime;},
    s=>{s.history[0].raw.status='Postponed';},s=>{s.history[0].raw.cancelled=true;}]){
    const s=fixture();mutate(s);
    assert.equal(nbaScenarioHistory(s,{eventID:target.eventID,playerID:target.playerID,asOf}).rows.length,2);
  }
});
test('fresh target catalog collapses repeated markets and excludes conflicting roster identities',()=>{
  const s=fixture();s.targets.push({...target,market:'rebounds'});
  assert.equal(nbaScenarioTargets(s,asOf).targets.length,1);
  s.targets.push({...target,teamId:'C_NBA'});
  assert.equal(nbaScenarioTargets(s,asOf).targets.length,0);
  assert.equal(nbaScenarioHistory(s,{eventID:target.eventID,playerID:target.playerID,asOf}).status,'TARGET_UNAVAILABLE');
});
test('stale or future snapshots are not evidence for a current request',()=>{
  for(const generatedAt of ['2026-11-28T14:49:59Z','2026-11-28T15:00:01Z']){
    const s=fixture();s.generatedAt=generatedAt;
    assert.equal(nbaScenarioTargets(s,asOf).status,'SOURCE_UNAVAILABLE');
  }
});
test('live request returns exact combo analysis and distinct assumed minutes scenarios without raw archives',async()=>{
  const handle=createNbaPropScenariosHandler({readSnapshot:async()=>fixture(),clock:()=>asOf});
  const response=res();await handle({method:'GET',query},response);
  assert.equal(response.code,200);assert.equal(response.body.status,'AVAILABLE');
  assert.equal(response.body.market,'points_assists');assert.equal(response.body.historical.mean,24);
  assert.equal(response.body.historical.observedGameCount,3);assert.equal(response.body.minutesScenarios.length,2);
  assert.equal(response.body.productionEligible,false);assert.equal(response.body.modelProbability,null);
  assert.equal(response.headers['Cache-Control'],'private, no-store');
  assert.equal(JSON.stringify(response.body).includes('playerCrosswalk'),false);
  assert.equal(JSON.stringify(response.body).includes('archiveSha256'),false);
});
test('catalog request exposes only unique upcoming target metadata',async()=>{
  const handle=createNbaPropScenariosHandler({readSnapshot:async()=>fixture(),clock:()=>asOf});
  const response=res();await handle({method:'GET',query:{live:'1'}},response);
  assert.equal(response.code,200);assert.equal(response.body.targets.length,1);
  assert.equal(response.body.history,undefined);assert.equal(response.body.raw,undefined);
});
test('explicit loading is required and malformed requests do not read the database',async()=>{
  let reads=0;const handle=createNbaPropScenariosHandler({readSnapshot:async()=>{reads++;return fixture();},clock:()=>asOf});
  const response=res();await handle({method:'GET',query:{}},response);
  assert.equal(response.body.status,'NOT_REQUESTED');
  for(const changes of [{playerId:''},{thresholds:'10,,15'},{thresholds:'NaN'},{minutes:'0'},{minutes:'-1'},{minutes:'49'},
    {thresholds:'10,10'},{minutes:'30,30'},
    {market:'made_up'},{direction:'anything'},{thresholds:['10','15']},{minutes:Array(6).fill(30).join(',')}]){
    const r=res();await handle({method:'GET',query:{...query,...changes}},r);assert.equal(r.code,400);
  }
  const post=res();await handle({method:'POST',query},post);assert.equal(post.code,405);
  assert.equal(reads,0);
});
test('unavailable source and expired targets fail with plain public errors',async()=>{
  for(const [snapshot,code] of [[null,503],[{...fixture(),targets:[]},404]]){
    const handle=createNbaPropScenariosHandler({readSnapshot:async()=>snapshot,clock:()=>asOf});
    const r=res();await handle({method:'GET',query},r);assert.equal(r.code,code);assert.equal(r.body.productionEligible,false);
  }
  const handle=createNbaPropScenariosHandler({readSnapshot:async()=>{throw new Error('private connection details');},clock:()=>asOf});
  const r=res();await handle({method:'GET',query},r);
  assert.equal(r.code,503);assert.equal(JSON.stringify(r.body).includes('private connection'),false);
});
