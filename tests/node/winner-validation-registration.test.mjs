import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildPendingStudyRequests,preflightProspectiveRegistration,REGISTRATION_POLICY_HASH} from '../../scripts/evaluation/winner-validation-registration.mjs';
import {createWinnerModelManifest} from '../../sharp-service/lib/winner-prospective-models.js';

const hash=x=>createHash('sha256').update(x).digest('hex');
const now='2026-12-01T00:00:00Z';
const encode=x=>JSON.stringify(x);
function fixture({sport='NBA',market='WINNER',games=400}={}){
 const artifacts={candidate:'fixed distinct candidate',incumbent:'fixed frozen incumbent',features:'feature definitions',sourceSchema:'source definitions'};
 const distributionReports={};
 if(market==='SPREAD')for(const key of ['candidate','incumbent']){
  distributionReports[key]=encode({sport,market,sourceKind:'DEVELOPMENT_ONLY',independentOfWinnerProbability:true,exactLineCoverageTested:true,pushAccountingTested:true});
  artifacts[`${key}Distribution`]=encode({kind:'INDEPENDENT_MARGIN_DISTRIBUTION',evaluationStatus:'DEVELOPMENT_ONLY',testedAt:'2026-11-20T00:00:00Z',reportSha256:hash(distributionReports[key]),winnerProbabilityUsedAsCover:false});
 }
 const p={id:`${sport}-${market}-candidate`,holdoutId:`unused-${sport}-${market}`,protocolId:'winner-spread-prospective-v1',policyHash:REGISTRATION_POLICY_HASH,sport,market,competition:sport,period:'FULL_GAME',seasonPhase:'REGULAR_SEASON',sideRule:'HOME',
  familySize:4,windowStart:'2027-01-01T00:00:00Z',windowEnd:'2028-01-01T00:00:00Z',trainingThrough:'2026-11-01T00:00:00Z',trainingEventIds:['train'],developmentEventIds:['dev'],previousHoldoutEventIds:[],
  modelHashes:Object.fromEntries(Object.entries(artifacts).map(([k,v])=>[k,hash(v)])),forecastPolicy:{inputLeadSeconds:900,issueLeadSeconds:660,maximumCaptureDelaySeconds:120},
  power:{targetBrierImprovement:.01,power:.8,pairedDifferenceSd:.01,designEffect:1,familySize:4,sourceKind:'DEVELOPMENT_ONLY',estimatedAt:'2026-11-25T00:00:00Z'}};
 const predictionBytes='frozen development paired predictions';
 const variance={sport,market,candidateSha256:p.modelHashes.candidate,incumbentSha256:p.modelHashes.incumbent,sourceKind:'DEVELOPMENT_ONLY',estimatedAt:p.power.estimatedAt,pairedDifferenceSd:.01,designEffect:1,n:100,blocks:20,predictionSourceSha256:hash(predictionBytes)};
 const varianceBytes=encode(variance);p.power.sourceSha256=hash(varianceBytes);
 const inventoryBytes=encode({sourceKind:'DEVELOPMENT_ONLY',complete:true,trainingEventIds:p.trainingEventIds,developmentEventIds:p.developmentEventIds,previousHoldoutEventIds:[],previousHoldoutIds:[]});
 const capability={contract:'winner-confirmation-capability-v1',sport,market,observedAt:'2026-11-25T00:00:00Z',pairedForecasts:true,exactInputCutoff:true,exactIssueTime:true,supportedInputLeadSeconds:[900],supportedIssueLeadSeconds:[660],minimumIssueLeadSeconds:301,maximumCaptureDelaySeconds:120,immutableForecastReceipts:true,registrationBoundLedger:true,pregameExclusionReceipts:true,completePairedPrices:true,maximumPriceAgeSeconds:300,officialSettlement:true,nbaConfirmedStarters:true,nflConfirmedQuarterbacks:true,nflOfficialInactives:true,spreadExactLinePrices:true,independentCoverDistributions:true};
 const capabilityBytes=encode(capability);
 const scheduledEvents=Array.from({length:games},(_,i)=>({eventId:`event-${i}`,startsAt:new Date(Date.parse('2027-01-02T20:00:00Z')+Math.floor(i/(sport==='NFL'?10:4))*(sport==='NFL'?7:1)*86400000).toISOString(),sport,competition:sport,seasonPhase:'REGULAR_SEASON',homeTeamId:`home-${i}`,awayTeamId:`away-${i}`,selectedTeamId:`home-${i}`,opponentTeamId:`away-${i}`}));
 return {now,proposedRegistration:p,artifacts,distributionReports,scheduledEvents,scopeComplete:true,scheduleReceipt:{sourceUrl:'https://official.example/schedule',observedAt:'2026-11-25T00:00:00Z',sha256:hash(encode(scheduledEvents))},
  varianceEvidence:{artifactBytes:varianceBytes,sha256:hash(varianceBytes),predictionBytes},inventoryEvidence:{artifactBytes:inventoryBytes,sha256:hash(inventoryBytes)},capabilityEvidence:{artifactBytes:capabilityBytes,sha256:hash(capabilityBytes)}};
}
const fail=(b,code)=>{const r=preflightProspectiveRegistration(b);assert.equal(r.status,'BLOCKED');assert.ok(r.blockers.some(x=>x.code===code),encode(r.blockers));assert.equal(r.enrollmentEnabled,false);return r;};
function replaceEvidence(b,key,value){b[key].artifactBytes=encode(value);b[key].sha256=hash(b[key].artifactBytes);}

test('four intent records pin current policy and actual frozen baselines without registration claims',()=>{
 const rows=buildPendingStudyRequests();assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.studyId)).size,4);
 assert.deepEqual(rows.map(r=>`${r.sport}:${r.market}`).sort(),['NBA:SPREAD','NBA:WINNER','NFL:SPREAD','NFL:WINNER']);
 for(const r of rows){assert.equal(r.incumbentHash,createWinnerModelManifest(r.sport).manifestHash);assert.equal(r.policyHash,REGISTRATION_POLICY_HASH);assert.equal(r.familySize,4);assert.equal(r.status,'RECORDED_NOT_ENROLLING');assert.equal(r.confirmationStatus,'NOT_STARTED');assert.equal(r.enrollmentEnabled,false);assert.equal(r.registration,null);assert.equal(r.productionEligible,false);assert.equal(r.productionWeight,0);assert.equal(r.automaticPlayEnabled,false);assert.equal('createdAt' in r,false);assert.equal('registeredAt' in r,false);assert.ok(r.blockers.length);}
 assert.ok(rows.find(r=>r.sport==='NFL').blockers.some(b=>b.code==='NFL_FUTURE_SCHEDULE_HORIZON_UNAVAILABLE'));
 assert.ok(rows.filter(r=>r.market==='SPREAD').every(r=>r.blockers.some(b=>b.code==='SPREAD_CONFIRMATION_EXPORT_UNAVAILABLE'&&b.detail.includes('Research spread prices'))));
});
test('a prerequisite audit cannot silently select a candidate or clear enrollment blockers',()=>{
 const rows=buildPendingStudyRequests({artifactAudit:{status:'READY',candidate:'best'},artifactAuditReference:{path:'audit.json',sha256:'a'.repeat(64)}});
 assert.ok(rows.every(r=>r.candidateRef===null&&r.enrollmentEnabled===false&&r.registration===null));
});
test('CLI audit references inside the repository use portable relative paths',()=>{
 const cwd=fileURLToPath(new URL('../..',import.meta.url));
 const audit='scripts/evaluation/prospective-validation-policy.json';
 const result=JSON.parse(execFileSync(process.execPath,['scripts/evaluation/winner-validation-registration.mjs','--audit',audit],{cwd,encoding:'utf8'}));
 assert.equal(result.requests.length,4);assert.ok(result.requests.every(r=>r.artifactAudit.path===audit&&r.artifactAudit.sha256===REGISTRATION_POLICY_HASH&&r.enrollmentEnabled===false));
});
test('complete registration-time evidence is only advisory readiness, never activation',()=>{
 const r=preflightProspectiveRegistration(fixture());assert.equal(r.status,'READY_FOR_REGISTRATION',encode(r.blockers));assert.equal(r.registration,null);assert.equal(r.enrollmentEnabled,false);assert.equal(r.confirmationStatus,'NOT_STARTED');assert.equal(r.productionEligible,false);assert.equal(r.automaticPlayEnabled,false);assert.equal(r.requiredGames,300);assert.equal(r.independentAuditRequired,true);
});
test('missing proposals and altered exact artifact bytes fail closed',()=>{
 fail({},'MISSING_PROPOSAL');const a=fixture();a.artifacts.candidate+='changed';fail(a,'MANIFEST_MISMATCH');
 const b=fixture();delete b.artifacts.features;fail(b,'MANIFEST_MISMATCH');
});
test('a baseline compared to itself cannot create an impossible improvement study',()=>{
 const b=fixture();b.artifacts.candidate=b.artifacts.incumbent;b.proposedRegistration.modelHashes.candidate=b.proposedRegistration.modelHashes.incumbent;fail(b,'CANDIDATE_EQUALS_INCUMBENT');
});
test('power evidence must be sourced, paired, pre-registration and hash-bound',()=>{
 const a=fixture();delete a.varianceEvidence;fail(a,'VARIANCE_EVIDENCE');
 const b=fixture();b.varianceEvidence.predictionBytes+='changed';fail(b,'VARIANCE_EVIDENCE');
 const c=fixture();c.proposedRegistration.power.pairedDifferenceSd=.02;fail(c,'VARIANCE_EVIDENCE');
});
test('leakage inventories and prior holdout identity are mandatory',()=>{
 const a=fixture();delete a.inventoryEvidence;fail(a,'INVENTORY_EVIDENCE');
 const b=fixture();b.proposedRegistration.developmentEventIds.push('event-0');const inv=JSON.parse(b.inventoryEvidence.artifactBytes);inv.developmentEventIds.push('event-0');replaceEvidence(b,'inventoryEvidence',inv);fail(b,'HOLDOUT_LEAKAGE');
 const c=fixture();const i=JSON.parse(c.inventoryEvidence.artifactBytes);i.previousHoldoutIds.push(c.proposedRegistration.holdoutId);replaceEvidence(c,'inventoryEvidence',i);fail(c,'HOLDOUT_ID_REUSED');
});
test('complete schedule must make game, time-block and duration floors feasible',()=>{
 fail(fixture({games:299}),'SCHEDULE_GAME_FLOOR');
 const b=fixture();for(const e of b.scheduledEvents)e.startsAt='2027-01-02T20:00:00Z';b.scheduleReceipt.sha256=hash(encode(b.scheduledEvents));fail(b,'SCHEDULE_BLOCK_FLOOR');
 const c=fixture({sport:'NFL',games:200});c.proposedRegistration.windowEnd='2027-03-01T00:00:00Z';fail(c,'WINDOW_DURATION');
});
test('incomplete schedules, duplicate aliases and changed schedule bytes are blocked',()=>{
 const a=fixture();a.scopeComplete=false;fail(a,'SCHEDULE_EVIDENCE');
 const b=fixture();b.scheduledEvents[1]={...b.scheduledEvents[0],eventId:'alias'};b.scheduleReceipt.sha256=hash(encode(b.scheduledEvents));fail(b,'DUPLICATE_MATCHUP');
 const c=fixture();c.scheduledEvents.pop();fail(c,'SCHEDULE_EVIDENCE');
});
test('unsupported real issue timing cannot be repaired by pretending a cron is exact',()=>{
 const b=fixture();const c=JSON.parse(b.capabilityEvidence.artifactBytes);c.exactIssueTime=false;replaceEvidence(b,'capabilityEvidence',c);fail(b,'TIMING_CAPABILITY');
 const d=fixture();d.proposedRegistration.forecastPolicy.issueLeadSeconds=120;fail(d,'TIMING_CAPABILITY');
});
test('required lineup, official settlement, price and ledger capabilities all fail closed',()=>{
 for(const [key,code] of [['nbaConfirmedStarters','LINEUP_CAPABILITY'],['officialSettlement','OFFICIAL_SETTLEMENT_CAPABILITY'],['registrationBoundLedger','LEDGER_CAPABILITY'],['completePairedPrices','PRICE_CAPABILITY'],['immutableForecastReceipts','CAPTURE_CAPABILITY']]){
  const b=fixture();const c=JSON.parse(b.capabilityEvidence.artifactBytes);c[key]=false;replaceEvidence(b,'capabilityEvidence',c);fail(b,code);
 }
 const b=fixture({sport:'NFL'});const c=JSON.parse(b.capabilityEvidence.artifactBytes);c.nflConfirmedQuarterbacks=false;replaceEvidence(b,'capabilityEvidence',c);fail(b,'LINEUP_CAPABILITY');
});
test('spreads require independently tested exact-line push distributions and quotes',()=>{
 const good=fixture({market:'SPREAD'});assert.equal(preflightProspectiveRegistration(good).status,'READY_FOR_REGISTRATION');
 const a=fixture({market:'SPREAD'});delete a.artifacts.candidateDistribution;fail(a,'DISTRIBUTION_EVIDENCE');
 const b=fixture({market:'SPREAD'});const c=JSON.parse(b.capabilityEvidence.artifactBytes);c.spreadExactLinePrices=false;replaceEvidence(b,'capabilityEvidence',c);fail(b,'SPREAD_CAPABILITY');
 const d=fixture({market:'SPREAD'});d.distributionReports.candidate+='changed';fail(d,'DISTRIBUTION_EVIDENCE');
});
test('past captures and client registration timestamp cannot be adopted retroactively',()=>{
 const a=fixture();a.proposedRegistration.windowStart='2026-11-17T00:00:00Z';fail(a,'FUTURE_WINDOW');
 const b=fixture();b.proposedRegistration.registeredAt=now;fail(b,'SERVER_REGISTRATION_REQUIRED');
 const c=fixture();c.existingForecastIds=['old-forecast'];fail(c,'RETROACTIVE_ENROLLMENT');
});
test('malformed input and unsupported scope or multiplicity return structured blockers',()=>{
 fail(null,'MISSING_PROPOSAL');const a=fixture();a.proposedRegistration.sport='NHL';fail(a,'UNSUPPORTED_SCOPE');
 const b=fixture();b.proposedRegistration.power.familySize=1;fail(b,'FAMILY_MISMATCH');
 const c=fixture();c.scheduledEvents[0]=null;assert.equal(preflightProspectiveRegistration(c).status,'BLOCKED');
});
