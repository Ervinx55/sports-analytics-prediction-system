import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {backtestNbaBaseline} from '../../sharp-service/lib/nba-vnext-backtest.js';

// Synthetic archived observations: receipt times are explicit test inputs, not
// a duration that the production replay may infer from a game's start time.
function observed(game,observedAt){
 const snapshot={eventId:game.eventId,startsAt:game.startsAt,home:game.home,away:game.away,
  homeScore:game.homeScore,awayScore:game.awayScore,completed:true};
 return {...game,finalObservation:{contract:'nba-final-observation-v1',...snapshot,observedAt,
  sourceUrl:`https://scores.example.test/nba/${game.eventId}.json`,
  sourceSha256:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}};
}
const game=(eventId,startsAt,observedAt,homeScore=105,awayScore=100)=>observed({eventId,startsAt,
 home:'BOS',away:'MIL',homeScore,awayScore,completed:true},observedAt);
const history=()=>Array.from({length:24},(_,i)=>{
 const date=`2026-10-${String(i+1).padStart(2,'0')}`;
 return game('history-'+i,date+'T19:00:00Z',date+'T23:00:00Z');
});
const target=()=>game('target','2026-10-25T20:00:00Z','2026-10-25T23:00:00Z',111,100);
const replay=games=>backtestNbaBaseline({games,minimumEvaluated:1});
const targetRecord=report=>report.records.find(record=>record.eventId==='target');

test('an overlapping earlier-start game cannot leak its eventual score into a target replay',()=>{
 const base=history(),wanted=targetRecord(replay([...base,target()]));
 assert.ok(wanted);
 const overlap=game('overlap','2026-10-25T19:00:00Z','2026-10-25T22:00:00Z',180,60);
 const actual=targetRecord(replay([...base,overlap,target()]));
 assert.equal(actual.predictedHomeWinProbability,wanted.predictedHomeWinProbability);
 assert.equal(actual.eligibleHistoryGames,24);
 assert.ok(!actual.historyEventIds.includes('overlap'));
 const changed=observed({...overlap,homeScore:60,awayScore:180},overlap.finalObservation.observedAt);
 assert.equal(targetRecord(replay([...base,changed,target()])).predictedHomeWinProbability,wanted.predictedHomeWinProbability);
});

test('only an exact final observation strictly before the forecast cutoff is eligible',()=>{
 const base=history(),wanted=targetRecord(replay([...base,target()]));
 const atCutoff=game('overlap','2026-10-25T19:00:00Z','2026-10-25T19:59:59.999Z',180,60);
 const excluded=targetRecord(replay([...base,atCutoff,target()]));
 assert.equal(excluded.predictedHomeWinProbability,wanted.predictedHomeWinProbability);
 const before=observed(atCutoff,'2026-10-25T19:59:59.998Z');
 const included=targetRecord(replay([...base,before,target()]));
 assert.equal(included.eligibleHistoryGames,25);
 assert.ok(included.historyEventIds.includes('overlap'));
 assert.notEqual(included.predictedHomeWinProbability,wanted.predictedHomeWinProbability);
 assert.equal(included.latestHistoricalFinalObservedAt,'2026-10-25T19:59:59.998Z');
});

test('current final scores without archived availability evidence block replay metrics',()=>{
 const legacy=[...history(),target()].map(({finalObservation,...row})=>row);
 const report=replay(legacy);
 assert.equal(report.status,'BLOCKED_TEMPORAL_EVIDENCE');
 assert.equal(report.evaluatedGames,0);assert.deepEqual(report.records,[]);
 for(const key of ['brier','logLoss','ece','payoutROI','marketBaselineBrier'])assert.equal(report[key],null);
 assert.ok(report.reasons.includes('FINAL_OBSERVATION_MISSING'));
 assert.equal(report.productionEligible,false);assert.equal(report.automaticBuyEnabled,false);
});

test('malformed or mismatched final evidence cannot supply temporal eligibility',()=>{
 for(const patch of [
  {observedAt:null},{observedAt:'not-a-time'},{observedAt:'2026-09-30T19:00:00Z'},
  {observedAt:'2099-01-01T00:00:00Z'},{completed:false},{eventId:'other'},
  {startsAt:'2026-10-01T20:00:00Z'},{home:'OTHER'},{homeScore:200},
  {sourceSha256:'unverified'},{sourceUrl:null}
 ]){
  const games=[...history(),target()];Object.assign(games[0].finalObservation,patch);
  const report=replay(games);
  assert.equal(report.status,'BLOCKED_TEMPORAL_EVIDENCE',JSON.stringify(patch));
  assert.equal(report.evaluatedGames,0);
 }
});

test('strings and nulls never become fabricated final scores',()=>{
 for(const value of [null,'105','',true,NaN]){
  const games=[...history(),target()];games[0].homeScore=value;
  const report=replay(games);
  assert.equal(report.status,'BLOCKED_TEMPORAL_EVIDENCE');
  assert.ok(report.reasons.includes('INVALID_FINAL_GAME'));
  assert.equal(report.evaluatedGames,0);
 }
});

test('duplicate or conflicting observations cannot select an arbitrary result version or inflate the cohort',()=>{
 const base=history();
 for(const duplicate of [structuredClone(base[0]),
  observed({...base[0],homeScore:190},base[0].finalObservation.observedAt),
  observed({...base[0],eventId:'different-provider-id'},base[0].finalObservation.observedAt),
  observed(base[0],'2026-10-26T23:00:00Z')]){
  const report=replay([...base,duplicate,target()]);
  assert.equal(report.status,'BLOCKED_TEMPORAL_EVIDENCE');
  assert.ok(report.reasons.includes('DUPLICATE_OR_CONFLICTING_FINAL_GAME'));
  assert.equal(report.evaluatedGames,0);
 }
});

test('an evidence-backed research replay keeps approval gates disabled',()=>{
 const report=replay([...history(),target()]);
 assert.equal(report.status,'RESEARCH_AUDIT');assert.equal(report.evaluatedGames,1);
 assert.equal(report.productionEligible,false);assert.equal(report.productionWeight,0);
 assert.equal(report.automaticBuyEnabled,false);assert.equal(report.payoutROI,null);
 assert.equal(report.temporalEvidence.status,'COMPLETE_OBSERVATION_METADATA');
 assert.equal(replay([]).status,'INSUFFICIENT_HOLDOUT');
});
