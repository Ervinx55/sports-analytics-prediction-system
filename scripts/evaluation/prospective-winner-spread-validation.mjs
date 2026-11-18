// Offline only: validates supplied immutable evidence; never imports application models.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {metrics} from './winner-validation-metrics.mjs';

const policyBytes=fs.readFileSync(new URL('./prospective-validation-policy.json',import.meta.url));
const POLICY=JSON.parse(policyBytes);
const sha=value=>createHash('sha256').update(value).digest('hex');
export const POLICY_HASH=sha(policyBytes);
const stamp=x=>typeof x==='string'&&/Z$|[+-]\d{2}:\d{2}$/.test(x)?Date.parse(x):NaN;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=x=>typeof x==='string'&&x.trim().length>0;
const probability=x=>finite(x)&&x>=0&&x<=1;
const receipt=r=>r&&digest(r.sha256)&&typeof r.sourceUrl==='string'&&/^https:\/\//.test(r.sourceUrl)&&Number.isFinite(stamp(r.observedAt));
const isArray=Array.isArray;
const eastern=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
function blockFor(startsAt,unit){
 const date=eastern.format(new Date(startsAt));
 if(unit==='EASTERN_DAY')return date;
 const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
 return d.toISOString().slice(0,10);
}
// Inverse standard normal CDF, rational approximation (planning only).
function inverseNormal(p){
 const a=[-39.6968302866538,220.946098424521,-275.928510446969,138.357751867269,-30.6647980661472,2.50662827745924];
 const b=[-54.4760987982241,161.585836858041,-155.698979859887,66.8013118877197,-13.2806815528857];
 const c=[-.00778489400243029,-.322396458041136,-2.40075827716184,-2.54973253934373,4.37466414146497,2.93816398269878];
 const d=[.00778469570904146,.32246712907004,2.445134137143,3.75440866190742];
 if(p<.02425){const q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
 if(p>1-.02425)return -inverseNormal(1-p);
 const q=p-.5,r=q*q;return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
const logloss=(p,y)=>-y*Math.log(Math.max(1e-12,p))-(1-y)*Math.log(Math.max(1e-12,1-p));
function quantile(values,p){const a=[...values].sort((x,y)=>x-y),i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return a[lo]+(a[hi]-a[lo])*(i-lo);}
function vectorScore(distribution,outcome){return ['win','push','loss'].reduce((sum,key)=>sum+(distribution[key]-Number(key===outcome))**2,0);}
function uncertainty(rows,allRows,alpha,iterations){
 const blocks=new Map();
 const fresh=()=>({n:0,incumbentBrier:0,marketBrier:0,incumbentLogloss:0,marketLogloss:0,bins:Array.from({length:10},()=>({n:0,p:0,y:0})),pushN:0,pushError:0,distributionBrier:0,distributionLogloss:0});
 for(const r of allRows){if(!blocks.has(r.block))blocks.set(r.block,fresh());const b=blocks.get(r.block);if(r.distribution){b.pushN++;b.pushError+=r.distribution.push-Number(r.outcome==='push');b.distributionBrier+=vectorScore(r.distribution,r.outcome)-vectorScore(r.incumbentDistribution,r.outcome);b.distributionLogloss+=-Math.log(Math.max(1e-12,r.distribution[r.outcome]))+Math.log(Math.max(1e-12,r.incumbentDistribution[r.outcome]));}}
 for(const r of rows){const b=blocks.get(r.block);b.n++;const bin=b.bins[Math.min(9,Math.floor(r.candidate*10))];bin.n++;bin.p+=r.candidate;bin.y+=r.y;
  for(const other of ['market','incumbent']){b[`${other}Brier`]+=(r.candidate-r.y)**2-(r[other]-r.y)**2;b[`${other}Logloss`]+=logloss(r.candidate,r.y)-logloss(r[other],r.y);}}
 const values=[...blocks.values()],samples={incumbentBrier:[],marketBrier:[],incumbentLogloss:[],marketLogloss:[],ece:[],bias:[],pushBias:[],distributionBrier:[],distributionLogloss:[]};let seed=POLICY.uncertainty.seed;
 if(values.length<2||!rows.length)return null;
 for(let iter=0;iter<iterations;iter++){
  const total=fresh();
  for(let k=0;k<values.length;k++){
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=values[Math.floor(seed/4294967296*values.length)];
   for(const key of ['n','incumbentBrier','marketBrier','incumbentLogloss','marketLogloss','pushN','pushError','distributionBrier','distributionLogloss'])total[key]+=v[key];
   for(let i=0;i<10;i++)for(const key of ['n','p','y'])total.bins[i][key]+=v.bins[i][key];
  }
  if(!total.n)continue;
  for(const key of ['incumbentBrier','marketBrier','incumbentLogloss','marketLogloss'])samples[key].push(total[key]/total.n);
  samples.ece.push(total.bins.reduce((s,b)=>s+Math.abs(b.p-b.y),0)/total.n);
  samples.bias.push(total.bins.reduce((s,b)=>s+b.p-b.y,0)/total.n);
  if(total.pushN){samples.pushBias.push(total.pushError/total.pushN);samples.distributionBrier.push(total.distributionBrier/total.pushN);samples.distributionLogloss.push(total.distributionLogloss/total.pushN);}
 }
 const interval=a=>a.length?{lower:quantile(a,alpha/2),upper:quantile(a,1-alpha/2)}:null;
 return Object.fromEntries(Object.entries(samples).map(([key,values])=>[key,interval(values)]));
}

function evaluateBundle(bundle={}){
 const result={protocolId:POLICY.id,policyHash:POLICY_HASH,status:'NOT_STARTED',...POLICY.authority,blockers:[]};delete result.bestPossibleStatus;
 const add=(code,detail,eventId)=>result.blockers.push({code,detail,...(eventId?{eventId}: {})});
 const require=(condition,code,detail,eventId)=>{if(!condition)add(code,detail,eventId);return condition;};
 if(!bundle?.registration){add('NO_REGISTRATION','No prospective validation has started; existing archives remain development evidence.');return result;}
 result.status='BLOCKED';const reg=bundle.registration,scope=POLICY.scopes[`${reg.sport}:${reg.market}`];
 require(reg.protocolId===POLICY.id&&reg.policyHash===POLICY_HASH,'POLICY_MISMATCH','Registration must pin this exact policy.');
 require(scope&&reg.period==='FULL_GAME'&&reg.competition===reg.sport&&['REGULAR_SEASON','POSTSEASON'].includes(reg.seasonPhase)&&reg.sideRule==='HOME','UNSUPPORTED_SCOPE','Only separately registered NBA/NFL full-game HOME-side winner/spread cohorts with one season phase are supported.');
 const registered=stamp(reg.registeredAt),start=stamp(reg.windowStart),end=stamp(reg.windowEnd),analysis=stamp(bundle.analysisAt);
 require(text(reg.id)&&text(reg.holdoutId)&&registered>=stamp(POLICY.declaredAt)&&registered<start&&start<end,'NOT_PREREGISTERED','Future start/end and immutable registration must precede capture.');
 require(stamp(reg.trainingThrough)<registered,'TRAINING_OVERLAP','Training must end before registration, not inside holdout.');
 require(Number.isFinite(analysis)&&analysis>=end,'WINDOW_NOT_CLOSED','One final analysis occurs after the fixed window closes.');
 require(stamp(bundle.holdoutFirstOpenedAt)>=end&&stamp(bundle.holdoutFirstOpenedAt)<=analysis,'HOLDOUT_OPENED_EARLY','Unblinded holdout access before closure invalidates confirmation.');
 require(bundle.priorInterimAnalyses===0,'INTERIM_LOOK','No optional stopping or prior unblinded interim analysis.');
 const rr=bundle.registrationReceipt;
 require(rr&&rr.recordedAt===reg.registeredAt&&/^https:\/\//.test(rr.sourceUrl??'')&&rr.sha256===sha(JSON.stringify(reg)),'REGISTRATION_RECEIPT','Registration bytes and recorded receipt must match.');
 require(['trainingEventIds','developmentEventIds','previousHoldoutEventIds'].every(k=>isArray(reg[k])&&reg[k].every(text)),'LEAKAGE_INVENTORY','Explicit training/development/prior-holdout event inventories are required.');
 const keys=['candidate','incumbent','features','sourceSchema',...(reg.market==='SPREAD'?['candidateDistribution','incumbentDistribution']:[])];
 for(const key of keys)require(typeof bundle.artifacts?.[key]==='string'&&digest(reg.modelHashes?.[key])&&sha(bundle.artifacts[key])===reg.modelHashes[key],'MANIFEST_MISMATCH',`Pinned ${key} artifact bytes missing or changed.`);
 if(reg.market==='SPREAD')for(const key of ['candidateDistribution','incumbentDistribution']){
  let artifact;try{artifact=JSON.parse(bundle.artifacts?.[key]);}catch{}
  require(artifact?.kind==='INDEPENDENT_MARGIN_DISTRIBUTION'&&artifact.evaluationStatus==='DEVELOPMENT_ONLY'&&stamp(artifact.testedAt)<registered&&digest(artifact.reportSha256)&&artifact.winnerProbabilityUsedAsCover===false,'DISTRIBUTION_TEST_EVIDENCE','A separately tested frozen margin/cover distribution is required; winner probability is not cover probability.');
 }
 const power=reg.power;
 const timing=reg.forecastPolicy;
 require(timing&&Number.isInteger(timing.inputLeadSeconds)&&Number.isInteger(timing.issueLeadSeconds)&&timing.inputLeadSeconds>=timing.issueLeadSeconds&&timing.issueLeadSeconds>=POLICY.minimumPregameLeadSeconds&&Number.isInteger(timing.maximumCaptureDelaySeconds)&&timing.maximumCaptureDelaySeconds>=0&&timing.maximumCaptureDelaySeconds<=120,'CUTOFF_PREREGISTRATION','Register exact pregame input/issue offsets and a capture delay of at most120seconds before collection.');
 require(power&&power.targetBrierImprovement===POLICY.power.targetBrierImprovement&&finite(power.power)&&power.power>=.8&&power.power<1&&finite(power.pairedDifferenceSd)&&power.pairedDifferenceSd>0&&finite(power.designEffect)&&power.designEffect>=1&&Number.isInteger(power.familySize)&&power.familySize>=1&&power.familySize<=100&&power.sourceKind==='DEVELOPMENT_ONLY'&&stamp(power.estimatedAt)<registered&&digest(power.sourceSha256),'POWER_PREREGISTRATION','Power assumptions must be sourced from development before registration, not estimated from the holdout.');
 require(isArray(bundle.rows)&&isArray(bundle.ledger)&&isArray(bundle.scheduledEvents)&&bundle.scopeComplete===true,'INCOMPLETE_LEDGER','Complete official schedule, inclusion ledger and captured rows are required.');
 require(receipt(bundle.scheduleReceipt)&&bundle.scheduleReceipt.sha256===sha(JSON.stringify(bundle.scheduledEvents))&&stamp(bundle.scheduleReceipt.observedAt)<=registered,'SCHEDULE_RECEIPT','The preregistered schedule scope must have matching bytes and a pre-registration receipt.');
 if(result.blockers.length)return result;
 const intervalCount=reg.market==='SPREAD'?POLICY.uncertainty.spreadIntervalsPerScope:POLICY.uncertainty.winnerIntervalsPerScope;
 const alpha=POLICY.uncertainty.familywiseAlpha/(intervalCount*power.familySize);
 const iterations=Math.max(POLICY.uncertainty.bootstrapIterations,Math.ceil(2*POLICY.uncertainty.minimumExpectedTailSamples/alpha));
 require(iterations<=POLICY.uncertainty.maximumBootstrapIterations,'BOOTSTRAP_TAIL_RESOLUTION','The registered multiplicity exceeds this bounded evaluator\'s supported tail resolution. A new preregistered numerical design is needed.');
 if(result.blockers.length)return result;
 result.registrationId=reg.id;result.scope={sport:reg.sport,market:reg.market,period:reg.period,seasonPhase:reg.seasonPhase};
 const used=new Set([...reg.trainingEventIds,...reg.developmentEventIds,...reg.previousHoldoutEventIds]);
 const schedule=new Map(),ledger=new Map(),seen=new Set(),matchups=new Set();
 for(const e of bundle.scheduledEvents){
  require(text(e.eventId)&&!schedule.has(e.eventId)&&stamp(e.startsAt)>=start&&stamp(e.startsAt)<end&&text(e.selectedTeamId)&&text(e.opponentTeamId)&&e.selectedTeamId!==e.opponentTeamId&&e.homeTeamId===e.selectedTeamId&&e.awayTeamId===e.opponentTeamId,'INVALID_SCHEDULE','Unique identities and official home/away sides inside the fixed window are required.',e.eventId);
  const matchup=JSON.stringify([e.startsAt,...[e.selectedTeamId,e.opponentTeamId].sort()]);
  require(!matchups.has(matchup),'DUPLICATE_MATCHUP','An exact matchup cannot enter again under another provider ID.',e.eventId);matchups.add(matchup);
  require(!used.has(e.eventId),'HOLDOUT_LEAKAGE','Scheduled holdout identities must not reuse development or earlier holdout events.',e.eventId);
  schedule.set(e.eventId,e);
 }
 for(const e of bundle.ledger){
  require(!ledger.has(e.eventId)&&schedule.has(e.eventId)&&['CAPTURED','EXCLUDED'].includes(e.disposition),'INCOMPLETE_LEDGER','Ledger must cover each scheduled game once.',e.eventId);
  require(stamp(e.decidedAt)>=registered&&stamp(e.decidedAt)<stamp(schedule.get(e.eventId)?.startsAt)&&(e.disposition!=='EXCLUDED'||text(e.reason)),'LATE_EXCLUSION','Exclusion and reason must be recorded before the game, regardless of outcome.',e.eventId);ledger.set(e.eventId,e);
 }
 require(ledger.size===schedule.size&&[...schedule.keys()].every(id=>ledger.has(id)),'INCOMPLETE_LEDGER','No silently omitted scheduled games.');
 const scored=[],all=[];let voids=0;
 for(const row of bundle.rows){
  const id=row?.eventId,s= schedule.get(id),l=ledger.get(id),issued=stamp(row?.issuedAt),kickoff=stamp(row?.startsAt),cutoff=stamp(row?.inputCutoff);
  require(text(id)&&!seen.has(id),'DUPLICATE_GAME','Only one preregistered side/line per independent game.',id);seen.add(id);
  require(!used.has(id),'HOLDOUT_LEAKAGE','Holdout event appeared in training, development, or a previously used holdout.',id);
  require(s&&l?.disposition==='CAPTURED'&&s.startsAt===row.startsAt&&s.selectedTeamId===row.selectedTeamId&&s.opponentTeamId===row.opponentTeamId&&row.selectionRole==='HOME'&&row.sport===reg.sport&&row.market===reg.market&&row.period===reg.period&&row.competition===reg.competition&&row.seasonPhase===reg.seasonPhase,'ROW_SCOPE_IDENTITY','Exact registered game, side, sport, phase and market must agree.',id);
  require(keys.every(k=>row.modelHashes?.[k]===reg.modelHashes[k]),'ROW_MANIFEST_MISMATCH','Every forecast uses the registered model/feature/source/distribution hashes.',id);
  require(issued>=registered&&cutoff<=issued&&cutoff>=registered&&kickoff-issued>=POLICY.minimumPregameLeadSeconds*1000&&stamp(row.capturedAt)>=issued&&stamp(row.capturedAt)<kickoff,'PREGAME_CHRONOLOGY','Prediction, input cutoff and immutable capture must all be pregame.',id);
  require(kickoff-cutoff===timing.inputLeadSeconds*1000&&kickoff-issued===timing.issueLeadSeconds*1000&&stamp(row.capturedAt)-issued<=timing.maximumCaptureDelaySeconds*1000,'REGISTERED_CUTOFF_MISMATCH','Every game must use the preregistered input cutoff, issue time and maximum capture delay.',id);
  const {settlement:excludedSettlement,forecastReceipt,...pregame}=row;
  require(forecastReceipt?.recordedAt===row.capturedAt&&/^https:\/\//.test(forecastReceipt?.sourceUrl??'')&&forecastReceipt?.sha256===sha(JSON.stringify(pregame)),'FORECAST_CAPTURE_RECEIPT','Immutable pregame receipt must bind the exact forecast, features, lineup, paired prices and capture time.',id);
  const lineup=row.lineup;
  require(receipt(lineup)&&lineup.verified===true&&lineup.bothTeams===true&&lineup.kind==='PREGAME_AVAILABILITY'&&lineup.eventId===id&&isArray(lineup.teamIds)&&lineup.teamIds.length===2&&lineup.teamIds.includes(row.selectedTeamId)&&lineup.teamIds.includes(row.opponentTeamId)&&(reg.sport==='NBA'?lineup.startingLineupsConfirmed===true:lineup.quarterbacksConfirmed===true&&lineup.officialInactivesConfirmed===true)&&stamp(lineup.observedAt)<=cutoff&&stamp(lineup.observedAt)>=registered,'LINEUP_EVIDENCE','Both teams need verified pregame starters (NBA) or quarterbacks and official inactives (NFL), bound to this event; actual participants are not a substitute.',id);
  require(probability(row.candidate?.probability)&&probability(row.incumbent?.probability),'INVALID_PROBABILITY','Finite candidate and incumbent probabilities in [0,1] are required.',id);
  require(row.incumbent?.inputCutoff===row.inputCutoff&&Math.abs(stamp(row.incumbent?.issuedAt)-issued)<=POLICY.maximumIncumbentIssueSkewSeconds*1000&&stamp(row.incumbent?.issuedAt)<kickoff,'INCUMBENT_AS_OF_MISMATCH','Paired forecasts must use the same input cutoff and issue within60seconds.',id);
  const price=row.prices;
  require(receipt(price)&&text(price.book)&&price.market===reg.market&&price.period===reg.period&&price.selectedTeamId===row.selectedTeamId&&price.opponentTeamId===row.opponentTeamId&&[price.selectionDecimal,price.opponentDecimal].every(x=>finite(x)&&x>1)&&issued-stamp(price.observedAt)>=0&&issued-stamp(price.observedAt)<=POLICY.maximumPriceAgeSeconds*1000&&(reg.market!=='SPREAD'||(price.selectionLine===row.line&&price.opponentLine===-row.line)),'PAIRED_PRICE_EVIDENCE','Complete same-book exact-period/line paired prices must precede issue by at most300seconds.',id);
  const settlement=row.settlement;
  require(settlement?.eventId===id&&settlement?.selectedTeamId===row.selectedTeamId&&settlement?.opponentTeamId===row.opponentTeamId,'SETTLEMENT_IDENTITY','Settlement must identify this exact event and both teams.',id);
  const settlementPayload={eventId:settlement?.eventId,selectedTeamId:settlement?.selectedTeamId,opponentTeamId:settlement?.opponentTeamId,period:settlement?.period,status:settlement?.status,selectedScore:settlement?.selectedScore??null,opponentScore:settlement?.opponentScore??null,reason:settlement?.reason??null};
  require(settlement?.payloadHash===sha(JSON.stringify(settlementPayload)),'SETTLEMENT_PAYLOAD','Normalized settlement payload must match the recorded hash.',id);
  require(receipt(settlement)&&['FINAL','VOID'].includes(settlement.status)&&settlement.period===reg.period&&stamp(settlement.observedAt)>kickoff&&stamp(settlement.observedAt)<=analysis&&(settlement.status!=='VOID'||text(settlement.reason)),'SETTLEMENT_EVIDENCE','Official settled outcome/void receipt and exact period are required; live scores never count.',id);
  if(settlement?.status!=='VOID')require([settlement?.selectedScore,settlement?.opponentScore].every(v=>Number.isInteger(v)&&v>=0),'SETTLEMENT_EVIDENCE','Final scores must be nonnegative integers.',id);
  if(reg.market==='SPREAD'){
   require(finite(row.line)&&Number.isInteger(row.line*2),'UNSUPPORTED_LINE','Only exact integer/half-point spreads; quarter lines require a separate protocol.',id);
   for(const [key,hashKey] of [['candidate','candidateDistribution'],['incumbent','incumbentDistribution']]){
    const model=row[key],d=model?.distribution;
    require(model?.quantity==='COVER'&&model.line===row.line&&model.distributionHash===reg.modelHashes[hashKey]&&d&&['win','push','loss'].every(k=>probability(d[k]))&&Math.abs(d.win+d.push+d.loss-1)<1e-10&&d.win+d.loss>0&&Math.abs(model.probability-d.win/(d.win+d.loss))<1e-10&&(Number.isInteger(row.line)||d.push===0),'COVER_DISTRIBUTION','Independent exact-line win/push/loss distribution and conditional cover probability are required.',id);
   }
  }else require(row.candidate?.quantity==='WINNER'&&row.incumbent?.quantity==='WINNER','WINNER_QUANTITY','A winner cohort cannot consume a cover probability.',id);
  if(result.blockers.length)continue;
  if(settlement.status==='VOID'){voids++;continue;}
  const margin=settlement.selectedScore-settlement.opponentScore+(reg.market==='SPREAD'?row.line:0);
  const outcome=margin>0?'win':margin<0?'loss':'push';
  require(!(outcome==='push'&&reg.sport==='NBA'&&reg.market==='WINNER'),'SETTLEMENT_EVIDENCE','A final NBA full-game winner cannot tie.',id);
  const record={eventId:id,block:blockFor(row.startsAt,scope.blockUnit),outcome,candidate:row.candidate.probability,incumbent:row.incumbent.probability,
   market:(1/price.selectionDecimal)/(1/price.selectionDecimal+1/price.opponentDecimal),distribution:row.candidate.distribution,incumbentDistribution:row.incumbent.distribution};
  all.push(record);if(outcome!=='push')scored.push({...record,y:Number(outcome==='win')});
 }
 require([...ledger.values()].filter(e=>e.disposition==='CAPTURED').every(e=>seen.has(e.eventId)),'INCOMPLETE_LEDGER','Every captured ledger entry needs its immutable forecast row.');
 if(result.blockers.length)return result;
 const planned=Math.ceil(((inverseNormal(1-alpha/2)+inverseNormal(power.power))*power.pairedDifferenceSd/power.targetBrierImprovement)**2*power.designEffect);
 Object.assign(result,{status:'INSUFFICIENT_EVIDENCE',distinctGames:all.length,scoredGames:scored.length,pushes:all.length-scored.length,voids,scheduledGames:schedule.size,excludedGames:schedule.size-bundle.rows.length,
  pairedCaptureCoverage:schedule.size?bundle.rows.length/schedule.size:0,temporalBlocks:new Set(scored.map(r=>r.block)).size,
  requiredGames:Math.max(scope.minimumScoredGames,planned),powerPlan:{approximateRequiredGames:planned,alpha,source:'PREREGISTERED_DEVELOPMENT_VARIANCE',caveat:'Normal planning approximation with declared design effect; actual block intervals must also meet criteria.'},
  metrics:Object.fromEntries(['candidate','incumbent','market'].map(k=>[k,metrics(scored.map(r=>({probability:r[k],outcome:r.y})))]))});
 require(scored.length>=scope.minimumScoredGames,'GAME_FLOOR','Insufficient distinct settled nonpush games for this sport/market.');
 require(scored.length>=planned,'POWER_TARGET','Observed games are below the preregistered variance/power target.');
 require(result.temporalBlocks>=scope.minimumBlocks,'BLOCK_FLOOR','Insufficient temporal blocks; repeated snapshots and games on one slate do not add blocks.');
 require((end-start)/86400000>=scope.minimumWindowDays,'WINDOW_DURATION','Registered window is too short for this sport/market.');
 require(result.pairedCaptureCoverage>=POLICY.minimumPairedCaptureCoverage,'CAPTURE_COVERAGE','Less than95% of the complete scheduled cohort has paired evidence.');
 const intervals=uncertainty(scored,all,alpha,iterations);result.uncertainty={method:'PAIRED_TEMPORAL_BLOCK_PERCENTILE_BOOTSTRAP',iterations,expectedSamplesPerTail:iterations*alpha/2,intervalCountPerScope:intervalCount,seed:POLICY.uncertainty.seed,perIntervalAlpha:alpha,intervals,caveat:'Multiplicity-adjusted approximate percentile intervals; temporal blocks do not eliminate all team/season dependence or guarantee frequentist coverage.'};
 result.comparisons={};
 for(const other of ['incumbent','market']){
  const brier={delta:result.metrics.candidate.brier===null?null:result.metrics.candidate.brier-result.metrics[other].brier,...intervals?.[`${other}Brier`]};
  const log={delta:result.metrics.candidate.logloss===null?null:result.metrics.candidate.logloss-result.metrics[other].logloss,...intervals?.[`${other}Logloss`]};
  result.comparisons[other]={brier,logloss:log};
  require(brier.delta!==null&&brier.delta<=-POLICY.performance.minimumBrierPointImprovement&&finite(brier.upper)&&brier.upper<0&&brier.upper-brier.lower<=POLICY.uncertainty.maximumBrierIntervalWidth,'BRIER_COMPARISON',`Brier improvement versus ${other} lacks required magnitude or uncertainty.`);
  require(finite(log.upper)&&log.upper<=POLICY.performance.maximumLoglossUpperDelta,'LOGLOSS_COMPARISON',`Logloss non-inferiority versus ${other} is not established.`);
 }
 const calibration=result.metrics.candidate.calibration;
 require(calibration.some(b=>b.n>0)&&calibration.every(b=>!b.n||b.n>=POLICY.calibration.minimumOccupiedBinGames),'CALIBRATION_SUPPORT','Each occupied fixed bin needs25games; unoccupied bins remain unsupported.');
 require(intervals?.ece?.upper<=POLICY.calibration.maximumEceUpper&&intervals?.bias?.lower>=-POLICY.calibration.maximumAbsoluteBiasBound&&intervals?.bias?.upper<=POLICY.calibration.maximumAbsoluteBiasBound,'CALIBRATION_UNCERTAINTY','Calibration ECE/bias uncertainty exceeds preregistered tolerances.');
 if(reg.market==='SPREAD'){
  result.distributionMetrics={};
  for(const key of ['candidate','incumbent']){
   const field=key==='candidate'?'distribution':'incumbentDistribution';
   result.distributionMetrics[key]={n:all.length,brier:all.length?all.reduce((s,r)=>s+vectorScore(r[field],r.outcome),0)/all.length:null,
    logloss:all.length?all.reduce((s,r)=>s-Math.log(Math.max(1e-12,r[field][r.outcome])),0)/all.length:null};
  }
  require(intervals?.pushBias?.lower>=-POLICY.spread.maximumAbsolutePushBiasBound&&intervals?.pushBias?.upper<=POLICY.spread.maximumAbsolutePushBiasBound,'PUSH_CALIBRATION','Unconditional push mass is not adequately calibrated.');
  result.distributionComparison={brier:{delta:result.distributionMetrics.candidate.brier-result.distributionMetrics.incumbent.brier,...intervals?.distributionBrier},logloss:{delta:result.distributionMetrics.candidate.logloss-result.distributionMetrics.incumbent.logloss,...intervals?.distributionLogloss}};
  require(finite(intervals?.distributionBrier?.upper)&&intervals.distributionBrier.upper<=0&&finite(intervals?.distributionLogloss?.upper)&&intervals.distributionLogloss.upper<=POLICY.performance.maximumLoglossUpperDelta,'DISTRIBUTION_COMPARISON','The full win/push/loss distribution must not degrade incumbent Brier or logloss within the fixed uncertainty tolerances.');
 }
 if(!result.blockers.length)result.status='HUMAN_REVIEW_ONLY';
 result.lineupInterpretation='Verified availability is provenance, not certification that a model contains a lineup adjustment.';
 result.authority='This offline result never changes frozen NBA/NFL models, PLAY, production weight, or approval. Artifact authenticity still requires independent human audit.';
 return result;
}

export function evaluateProspectiveValidation(bundle={}){
 try{return evaluateBundle(bundle);}
 catch(error){return {protocolId:POLICY.id,policyHash:POLICY_HASH,status:'BLOCKED',productionEligible:false,productionWeight:0,automaticPlayEnabled:false,blockers:[{code:'INVALID_INPUT',detail:error.message}]};}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const bundle=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8')):{};const report=evaluateProspectiveValidation(bundle);process.stdout.write(JSON.stringify(report,null,2)+'\n');}
 catch(error){process.stdout.write(JSON.stringify({status:'BLOCKED',productionEligible:false,productionWeight:0,automaticPlayEnabled:false,blockers:[{code:'INVALID_INPUT',detail:error.message}]},null,2)+'\n');process.exitCode=1;}
}
