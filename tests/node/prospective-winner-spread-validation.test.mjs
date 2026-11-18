import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evaluateProspectiveValidation, POLICY_HASH} from '../../scripts/evaluation/prospective-winner-spread-validation.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
const at = n => new Date(Date.parse('2027-01-02T20:00:00Z') + n*86400000).toISOString();
const before = (date, minutes) => new Date(Date.parse(date)-minutes*60000).toISOString();
const evidence = observedAt => ({observedAt,sourceUrl:'https://official.example/evidence',sha256:'a'.repeat(64)});
function sealRow(row){const {settlement,forecastReceipt,...pregame}=row;row.forecastReceipt={recordedAt:row.capturedAt,sourceUrl:'https://immutable.example/forecast',sha256:hash(JSON.stringify(pregame))};return row;}
function sealSettlement(row){const s=row.settlement;s.eventId=row.eventId;s.selectedTeamId=row.selectedTeamId;s.opponentTeamId=row.opponentTeamId;s.payloadHash=hash(JSON.stringify({eventId:s.eventId,selectedTeamId:s.selectedTeamId,opponentTeamId:s.opponentTeamId,period:s.period,status:s.status,selectedScore:s.selectedScore??null,opponentScore:s.opponentScore??null,reason:s.reason??null}));return row;}
function fixture({sport='NBA',market='WINNER',games=300}={}) {
 const spread=market==='SPREAD', perBlock=spread?10:5;
 const artifacts={candidate:'fixed candidate model',incumbent:'fixed incumbent model',features:'fixed feature schema',sourceSchema:'fixed source schema'};
 if(spread) for(const key of ['candidateDistribution','incumbentDistribution']) artifacts[key]=JSON.stringify({kind:'INDEPENDENT_MARGIN_DISTRIBUTION',testedAt:'2026-11-15T00:00:00Z',evaluationStatus:'DEVELOPMENT_ONLY',reportSha256:'c'.repeat(64),winnerProbabilityUsedAsCover:false});
 const modelHashes=Object.fromEntries(Object.entries(artifacts).map(([k,v])=>[k,hash(v)]));
 const registration={id:'prospective-fixture',protocolId:'winner-spread-prospective-v1',sport,market,period:'FULL_GAME',competition:sport,seasonPhase:'REGULAR_SEASON',sideRule:'HOME',
  registeredAt:'2026-12-01T00:00:00Z',windowStart:'2027-01-01T00:00:00Z',windowEnd:'2028-01-01T00:00:00Z',trainingThrough:'2026-11-16T00:00:00Z',
  holdoutId:'never-used-future-period',trainingEventIds:['training-game'],developmentEventIds:['development-game'],previousHoldoutEventIds:[],
  modelHashes,policyHash:POLICY_HASH,forecastPolicy:{inputLeadSeconds:660,issueLeadSeconds:600,maximumCaptureDelaySeconds:120},
  power:{targetBrierImprovement:.01,power:.8,pairedDifferenceSd:.01,designEffect:1,familySize:1,estimatedAt:'2026-11-17T00:00:00Z',sourceKind:'DEVELOPMENT_ONLY',sourceSha256:'b'.repeat(64)}};
 const rows=Array.from({length:games},(_,i)=>{
  const startsAt=at(Math.floor(i/perBlock)*(sport==='NFL'?7:1));
  const issuedAt=before(startsAt,10),inputCutoff=before(startsAt,11);
  const win=spread?i%10<7:i%5<4,push=spread&&i%10===9;
  const row={eventId:`event-${i}`,selectedTeamId:`home-${i}`,opponentTeamId:`away-${i}`,selectionRole:'HOME',sport,market,period:'FULL_GAME',competition:sport,seasonPhase:'REGULAR_SEASON',
   startsAt,issuedAt,capturedAt:before(startsAt,9),inputCutoff,modelHashes:{...modelHashes},
   candidate:{probability:spread?7/9:.8,quantity:spread?'COVER':'WINNER'},
   incumbent:{probability:.5,issuedAt,inputCutoff,quantity:spread?'COVER':'WINNER'},
   lineup:{...evidence(before(startsAt,12)),verified:true,bothTeams:true,kind:'PREGAME_AVAILABILITY',eventId:`event-${i}`,teamIds:[`home-${i}`,`away-${i}`],startingLineupsConfirmed:true,quarterbacksConfirmed:true,officialInactivesConfirmed:true},
   prices:{...evidence(before(startsAt,10.5)),book:'paired-book',market,period:'FULL_GAME',selectedTeamId:`home-${i}`,opponentTeamId:`away-${i}`,selectionDecimal:2,opponentDecimal:2},
   settlement:{...evidence(new Date(Date.parse(startsAt)+4*3600000).toISOString()),status:'FINAL',selectedScore:spread?(push?105:win?106:104):(win?101:99),opponentScore:100,period:'FULL_GAME'}};
  if(spread){row.line=-5;row.candidate={...row.candidate,line:-5,distribution:{win:.7,push:.1,loss:.2},distributionHash:modelHashes.candidateDistribution};row.incumbent={...row.incumbent,line:-5,distribution:{win:.45,push:.1,loss:.45},distributionHash:modelHashes.incumbentDistribution};row.prices.selectionLine=-5;row.prices.opponentLine=5;}
  return sealRow(sealSettlement(row));
 });
 const scheduledEvents=rows.map(({eventId,startsAt,selectedTeamId,opponentTeamId})=>({eventId,startsAt,selectedTeamId,opponentTeamId,homeTeamId:selectedTeamId,awayTeamId:opponentTeamId}));
 return {registration,artifacts,registrationReceipt:{recordedAt:registration.registeredAt,sourceUrl:'https://immutable.example/registration',sha256:hash(JSON.stringify(registration))},
  analysisAt:'2028-01-02T00:00:00Z',holdoutFirstOpenedAt:'2028-01-01T01:00:00Z',priorInterimAnalyses:0,scopeComplete:true,scheduledEvents,
  scheduleReceipt:{...evidence('2026-12-01T00:00:00Z'),sha256:hash(JSON.stringify(scheduledEvents))},
  ledger:rows.map(r=>({eventId:r.eventId,disposition:'CAPTURED',decidedAt:r.issuedAt})),rows};
}
function reseal(b){b.registrationReceipt.sha256=hash(JSON.stringify(b.registration));return b;}
function blocked(b,code){const r=evaluateProspectiveValidation(b);assert.equal(r.status,'BLOCKED');assert.ok(r.blockers.some(x=>x.code===code),JSON.stringify(r.blockers));assert.equal(r.productionEligible,false);return r;}

test('absence of a registration cannot retroactively start prospective validation',()=>{
 const r=evaluateProspectiveValidation({rows:[]});assert.equal(r.status,'NOT_STARTED');assert.equal(r.productionEligible,false);assert.equal(r.automaticPlayEnabled,false);
});
test('clean calibrated future evidence can only request human review, never enable PLAY',()=>{
 const r=evaluateProspectiveValidation(fixture());assert.equal(r.status,'HUMAN_REVIEW_ONLY',JSON.stringify(r.blockers));
 assert.equal(r.distinctGames,300);assert.equal(r.temporalBlocks,60);assert.ok(Math.abs(r.metrics.candidate.brier-.16)<1e-12);
 assert.ok(r.comparisons.market.brier.upper<0);assert.equal(r.productionEligible,false);assert.equal(r.productionWeight,0);assert.equal(r.automaticPlayEnabled,false);
});
test('reused development labels and a holdout opened before closure fail closed',()=>{
 const a=fixture();a.registration.developmentEventIds.push('event-1');blocked(reseal(a),'HOLDOUT_LEAKAGE');
 const b=fixture();b.holdoutFirstOpenedAt='2027-02-01T00:00:00Z';blocked(b,'HOLDOUT_OPENED_EARLY');
 const c=fixture();c.priorInterimAnalyses=1;blocked(c,'INTERIM_LOOK');
});
test('a registration or training cutoff after the future window begins is invalid',()=>{
 const a=fixture();a.registration.registeredAt='2027-01-03T00:00:00Z';a.registrationReceipt.recordedAt=a.registration.registeredAt;blocked(reseal(a),'NOT_PREREGISTERED');
 const b=fixture();b.registration.trainingThrough='2027-01-03T00:00:00Z';blocked(reseal(b),'TRAINING_OVERLAP');
});
test('missing pregame lineup proof and post-forecast evidence cannot be treated as verified',()=>{
 const a=fixture();delete a.rows[0].lineup;blocked(a,'LINEUP_EVIDENCE');
 const b=fixture();b.rows[0].lineup.observedAt=b.rows[0].startsAt;blocked(b,'LINEUP_EVIDENCE');
 const c=fixture();c.rows[0].capturedAt=c.rows[0].startsAt;blocked(c,'PREGAME_CHRONOLOGY');
});
test('stale or unmatched paired prices and different incumbent information cutoffs are blocked',()=>{
 const a=fixture();a.rows[0].prices.observedAt=before(a.rows[0].issuedAt,6);blocked(a,'PAIRED_PRICE_EVIDENCE');
 const b=fixture();delete b.rows[0].prices.opponentDecimal;blocked(b,'PAIRED_PRICE_EVIDENCE');
 const c=fixture();c.rows[0].incumbent.inputCutoff=before(c.rows[0].inputCutoff,1);blocked(c,'INCUMBENT_AS_OF_MISMATCH');
});
test('fixed artifact bytes and registration receipts detect changes',()=>{
 const a=fixture();a.artifacts.candidate+='changed';blocked(a,'MANIFEST_MISMATCH');
 const b=fixture();b.registration.market='SPREAD';blocked(b,'REGISTRATION_RECEIPT');
 const c=fixture();c.rows[0].modelHashes.candidate='f'.repeat(64);blocked(c,'ROW_MANIFEST_MISMATCH');
});
test('duplicates, missing scheduled games and postgame exclusions cannot inflate coverage',()=>{
 const a=fixture();a.rows.push({...a.rows[0]});blocked(a,'DUPLICATE_GAME');
 const b=fixture();b.ledger.pop();blocked(b,'INCOMPLETE_LEDGER');
 const c=fixture();c.rows.pop();c.ledger.at(-1).disposition='EXCLUDED';c.ledger.at(-1).reason='missing lineup';c.ledger.at(-1).decidedAt='2028-01-01T00:00:00Z';blocked(c,'LATE_EXCLUSION');
});
test('game-count floor and preregistered power requirement are both necessary',()=>{
 const a=evaluateProspectiveValidation(fixture({games:295}));assert.equal(a.status,'INSUFFICIENT_EVIDENCE');assert.ok(a.blockers.some(x=>x.code==='GAME_FLOOR'));
 const b=fixture();b.registration.power.pairedDifferenceSd=.5;const r=evaluateProspectiveValidation(reseal(b));assert.equal(r.status,'INSUFFICIENT_EVIDENCE');assert.ok(r.requiredGames>300);assert.ok(r.blockers.some(x=>x.code==='POWER_TARGET'));
});
test('large samples with no improvement or poor calibration do not clear review criteria',()=>{
 const a=fixture();for(const r of a.rows){r.candidate.probability=.5;sealRow(r);}
 const x=evaluateProspectiveValidation(a);assert.equal(x.status,'INSUFFICIENT_EVIDENCE');assert.ok(x.blockers.some(b=>b.code==='BRIER_COMPARISON'));
 const b=fixture();for(const r of b.rows){r.candidate.probability=.99;sealRow(r);}
 const y=evaluateProspectiveValidation(b);assert.equal(y.status,'INSUFFICIENT_EVIDENCE');assert.ok(y.blockers.some(b=>b.code==='CALIBRATION_UNCERTAINTY'));
});
test('unsettled outcomes and scores from another period cannot enter validation',()=>{
 const a=fixture();a.rows[0].settlement.status='LIVE';blocked(a,'SETTLEMENT_EVIDENCE');
 const b=fixture();b.rows[0].settlement.period='FIRST_HALF';blocked(b,'SETTLEMENT_EVIDENCE');
});
test('winner percentages are not a cover model, and exact spread lines are required',()=>{
 const a=fixture({market:'SPREAD',games:600});delete a.rows[0].candidate.distribution;blocked(a,'COVER_DISTRIBUTION');
 const b=fixture({market:'SPREAD',games:600});b.rows[0].candidate.quantity='WINNER';blocked(b,'COVER_DISTRIBUTION');
 const c=fixture({market:'SPREAD',games:600});c.rows[0].prices.selectionLine=-4.5;blocked(c,'PAIRED_PRICE_EVIDENCE');
 const d=fixture({market:'SPREAD',games:600});d.rows[0].candidate.line=-4.5;blocked(d,'COVER_DISTRIBUTION');
});
test('spread pushes remain in distribution scores but not binary cover denominator',()=>{
 const r=evaluateProspectiveValidation(fixture({market:'SPREAD',games:600}));assert.equal(r.status,'HUMAN_REVIEW_ONLY',JSON.stringify(r.blockers));
 assert.equal(r.distinctGames,600);assert.equal(r.pushes,60);assert.equal(r.scoredGames,540);
 assert.equal(r.distributionMetrics.candidate.n,600);assert.ok(Math.abs(r.distributionMetrics.candidate.brier-.46)<1e-12);
 assert.ok(Math.abs(r.metrics.candidate.brier-14/81)<1e-12);assert.equal(r.automaticPlayEnabled,false);
});
test('quarter-lines and push mass on half-lines are rejected, never silently reinterpreted',()=>{
 const a=fixture({market:'SPREAD',games:600});a.rows[0].line=-4.25;blocked(a,'UNSUPPORTED_LINE');
 const b=fixture({market:'SPREAD',games:600});const r=b.rows[0];r.line=-4.5;r.candidate.line=-4.5;r.incumbent.line=-4.5;r.prices.selectionLine=-4.5;r.prices.opponentLine=4.5;blocked(b,'COVER_DISTRIBUTION');
});
test('NFL ties are explicitly retained as pushes and winner floors use resolved games',()=>{
 const b=fixture({sport:'NFL',games:200});b.rows[0].settlement.selectedScore=100;sealSettlement(b.rows[0]);
 const r=evaluateProspectiveValidation(b);assert.equal(r.pushes,1);assert.equal(r.scoredGames,199);assert.equal(r.status,'INSUFFICIENT_EVIDENCE');assert.ok(r.blockers.some(x=>x.code==='GAME_FLOOR'));
});
test('unrequested sports have no invented confirmation thresholds',()=>{
 const b=fixture();b.registration.sport='NHL';blocked(reseal(b),'UNSUPPORTED_SCOPE');
});
test('immutable forecast capture detects probabilities rewritten after outcomes',()=>{
 const b=fixture();b.rows[0].candidate.probability=.99;blocked(b,'FORECAST_CAPTURE_RECEIPT');
});
test('a settlement from another event or changed final score is rejected',()=>{
 const a=fixture();a.rows[0].settlement.eventId='another-game';blocked(a,'SETTLEMENT_IDENTITY');
 const b=fixture();b.rows[0].settlement.selectedScore=0;blocked(b,'SETTLEMENT_PAYLOAD');
});
test('generic availability is insufficient without both confirmed lineups or NFL QB and inactives',()=>{
 const a=fixture();a.rows[0].lineup.startingLineupsConfirmed=false;blocked(a,'LINEUP_EVIDENCE');
 const b=fixture({sport:'NFL',games:200});b.rows[0].lineup.officialInactivesConfirmed=false;blocked(b,'LINEUP_EVIDENCE');
});
test('alternate provider IDs cannot count the same exact matchup twice',()=>{
 const b=fixture();Object.assign(b.scheduledEvents[1],{...b.scheduledEvents[0],eventId:'event-1'});b.scheduleReceipt.sha256=hash(JSON.stringify(b.scheduledEvents));blocked(b,'DUPLICATE_MATCHUP');
});
test('voids are retained and remove outcomes from scored sample without inflating coverage',()=>{
 const b=fixture();b.rows[0].settlement.status='VOID';b.rows[0].settlement.reason='CANCELLED';sealSettlement(b.rows[0]);
 const r=evaluateProspectiveValidation(b);assert.equal(r.voids,1);assert.equal(r.scoredGames,299);assert.equal(r.status,'INSUFFICIENT_EVIDENCE');
});
test('malformed caller rows fail closed as structured blockers',()=>{
 const b=fixture();b.rows[0]=null;const r=evaluateProspectiveValidation(b);assert.equal(r.status,'BLOCKED');assert.equal(r.productionEligible,false);
});

test('forecast input and issue cutoffs are fixed before collection begins',()=>{
 const a=fixture();delete a.registration.forecastPolicy;blocked(reseal(a),'CUTOFF_PREREGISTRATION');
 const b=fixture();b.rows[0].inputCutoff=before(b.rows[0].startsAt,13);b.rows[0].incumbent.inputCutoff=b.rows[0].inputCutoff;sealRow(b.rows[0]);blocked(b,'REGISTERED_CUTOFF_MISMATCH');
});

test('unsupported combined phases and unresolved extreme bootstrap tails fail closed',()=>{
 const a=fixture();a.registration.seasonPhase='ALL';blocked(reseal(a),'UNSUPPORTED_SCOPE');
 const b=fixture();b.registration.power.familySize=100;blocked(reseal(b),'BOOTSTRAP_TAIL_RESOLUTION');
});
