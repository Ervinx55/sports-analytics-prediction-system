import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWinnerCandidates,normalizeLineupEvidence,normalizeWinnerQuotes} from '../../sharp-service/lib/winner-capture-policy.js';
import {createWinnerModelManifest,canonicalHash} from '../../sharp-service/lib/winner-prospective-models.js';
const issuedAt='2026-11-17T20:00:00Z',observedAt='2026-11-17T19:59:30Z';
const event={sport:'NBA',eventID:'espn:123',sourceIds:{espn:'123',sgo:'sgo123'},startsAt:'2026-11-18T01:00:00Z',season:2026,home:{id:'1',abbreviation:'ATL'},away:{id:'2',abbreviation:'BOS'},identityVerified:true,status:'SCHEDULED',sourceFetchedAt:observedAt};
const history={complete:true,sourceSnapshots:[{sourceUrl:'https://example.test/history',fetchedAt:observedAt,sha256:'a'.repeat(64)}],games:Array.from({length:4},(_,i)=>({eventId:String(i),startsAt:`2026-11-${String(8+i*2).padStart(2,'0')}T23:00:00Z`,home:'ATL',away:'BOS',homeScore:110,awayScore:100,completed:true}))};
const input=()=>({sport:'NBA',events:[event],history,issuedAt,observedAt,modelManifest:createWinnerModelManifest('NBA')});
test('timestamped independent baseline saves with unavailable lineups and no market claims',()=>{
 const result=buildWinnerCandidates(input());assert.equal(result.candidates.length,1);
 const row=result.candidates[0];assert.equal(row.event_id,event.eventID);assert.equal(row.forecast.captureClass,'BASELINE_ONLY');
 assert.equal(row.forecast.lineup.status,'UNAVAILABLE');assert.equal(row.forecast.fullFeatureEligible,false);
 assert.equal(row.forecast.pairedPriceEligible,false);assert.equal(row.forecast.probabilityBasis,'INDEPENDENT_HOME_WIN');
 assert.equal(row.forecast.productionWeight,0);assert.equal(row.forecast.productionEligible,false);assert.ok(row.forecast.homeProbability>0&&row.forecast.homeProbability<1);
 assert.match(row.input_hash,/^[a-f0-9]{64}$/);assert.deepEqual(buildWinnerCandidates(input()),result);
 assert.equal(row.input_hash,canonicalHash(row.inputEvidence));assert.equal(row.model_hash,row.forecast.manifestHash);
 assert.equal(row.inputObservedAt,new Date(observedAt).toISOString());
});
test('NBA exact SGO canonical identity can enroll without a second provider mapping',()=>{
 const sgo={...event,eventID:'sgo:sgo123',sourceIds:{sgo:'sgo123'}};
 assert.equal(buildWinnerCandidates({...input(),events:[sgo]}).candidates.length,1);
 assert.equal(buildWinnerCandidates({...input(),events:[{...sgo,sourceIds:{sgo:'sgo123',espn:'123'}}]}).candidates.length,1);
 assert.equal(buildWinnerCandidates({...input(),events:[{...sgo,eventID:'sgo:other'}]}).candidates.length,0);
});
test('future receipts, current/live events, wrong frozen manifests and duplicate identities cannot enroll',()=>{
 for(const changed of [
  {observedAt:'2026-11-17T20:01:00Z'},
  {events:[{...event,sourceFetchedAt:'2026-11-17T20:01:00Z'}]},
  {events:[{...event,status:'LIVE'}]},
  {events:[{...event,identityVerified:false}]},
  {issuedAt:event.startsAt},
  {history:{...history,sourceSnapshots:[{...history.sourceSnapshots[0],fetchedAt:'2026-11-17T20:01:00Z'}]}},
  {modelManifest:{...createWinnerModelManifest('NBA'),modelVersion:'mutated'}}
 ])assert.equal(buildWinnerCandidates({...input(),...changed}).candidates.length,0);
 assert.equal(buildWinnerCandidates({...input(),events:[event,{...event,startsAt:'2026-11-18T02:00:00Z'}]}).candidates.length,0);
});
test('injury reports, QB expectation, and target final boxscores never become verified pregame lineups',()=>{
 for(const kind of ['OFFICIAL_INJURY_REPORT','NFL_DEPTH_CHART','FINAL_GAMEBOOK','TARGET_BOXSCORE']){
  const evidence={eventID:event.eventID,kind,status:'VERIFIED',publishedAt:observedAt,fetchedAt:observedAt,sourceUrl:'https://example.test/report',sha256:'b'.repeat(64)};
  assert.equal(normalizeLineupEvidence(event,[evidence],issuedAt).verified,false);
 }
});
test('even complete future or wrong-event confirmed starter lists fail pregame verification',()=>{
 const evidence={eventID:event.eventID,kind:'CONFIRMED_STARTERS',status:'VERIFIED',publishedAt:observedAt,fetchedAt:observedAt,sourceUrl:'https://www.nba.com/game/123',sha256:'b'.repeat(64),source:'NBA_OFFICIAL',homeTeamId:'1',awayTeamId:'2',startsAt:event.startsAt,homePlayerIds:['1','2','3','4','5'],awayPlayerIds:['6','7','8','9','10']};
 assert.equal(normalizeLineupEvidence(event,[evidence],issuedAt).verified,true);
 for(const changed of [{fetchedAt:event.startsAt},{eventID:'espn:other'},{homeTeamId:'other'},{homePlayerIds:['1','1','2','3','4']},{kind:'FINAL_GAMEBOOK'}])assert.equal(normalizeLineupEvidence(event,[{...evidence,...changed}],issuedAt).verified,false);
 const row=buildWinnerCandidates({...input(),lineupEvidence:[evidence]}).candidates[0];
 assert.equal(row.forecast.lineup.verified,true);assert.equal(row.forecast.fullFeatureEligible,false);
});
test('paired quote comparisons demand exact event, same-book pair, freshness and pregame receipt',()=>{
 const quote={eventID:event.eventID,sourceEventId:'sgo123',book:'pinnacle',homeOdds:-120,awayOdds:110,homeUpdatedAt:observedAt,awayUpdatedAt:observedAt,fetchedAt:observedAt,sourceUrl:'https://api.sportsgameodds.com/v2/events',sourceHash:'c'.repeat(64)};
 const accepted=normalizeWinnerQuotes(event,[quote],issuedAt);assert.equal(accepted.pairs.length,1);assert.equal(accepted.eligible,true);
 assert.equal(accepted.pairs[0].sourceHash,quote.sourceHash);
 for(const sourceHash of [undefined,'wrong','c'.repeat(63)])assert.equal(normalizeWinnerQuotes(event,[{...quote,sourceHash}],issuedAt).eligible,false);
 for(const changed of [{eventID:'other'},{sourceEventId:'other'},{homeUpdatedAt:'2026-11-17T19:40:00Z'},{fetchedAt:'2026-11-17T20:01:00Z'},{awayUpdatedAt:'2026-11-17T19:55:00Z'},{homeOdds:0}])assert.equal(normalizeWinnerQuotes(event,[{...quote,...changed}],issuedAt).eligible,false);
 assert.equal(normalizeWinnerQuotes(event,[quote,{...quote,homeOdds:-130}],issuedAt).eligible,false);
 const base=buildWinnerCandidates(input()).candidates[0].forecast.homeProbability;
 const withQuotes=buildWinnerCandidates({...input(),quotes:[quote]}).candidates[0].forecast;
 assert.equal(withQuotes.homeProbability,base);assert.equal(withQuotes.pairedPriceEligible,true);
});
