// Offline preparation only. No database calls, network, activation, fitting or model writes.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createWinnerModelManifest} from '../../sharp-service/lib/winner-prospective-models.js';

const policyBytes=fs.readFileSync(new URL('./prospective-validation-policy.json',import.meta.url));
const policy=JSON.parse(policyBytes);
const hash=x=>createHash('sha256').update(x).digest('hex');
export const REGISTRATION_POLICY_HASH=hash(policyBytes);
const stamp=x=>typeof x==='string'&&/Z$|[+-]\d{2}:\d{2}$/.test(x)?Date.parse(x):NaN;
const text=x=>typeof x==='string'&&x.trim().length>0;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const authority=()=>({confirmationStatus:'NOT_STARTED',enrollmentEnabled:false,registration:null,productionEligible:false,productionWeight:0,automaticPlayEnabled:false});
const scopes=[['NBA','WINNER'],['NBA','SPREAD'],['NFL','WINNER'],['NFL','SPREAD']];
const baseBlockers=[
 ['CANDIDATE_NOT_SELECTED_AND_PINNED','No distinct candidate has been selected and pinned for confirmation.'],
 ['DEVELOPMENT_POWER_PLAN_NOT_REGISTERED','Descriptive development variance is not an approved, candidate-specific power plan.'],
 ['FEATURE_SOURCE_MANIFESTS_NOT_PINNED','Confirmation feature and source schema bytes have not been pinned.'],
 ['FUTURE_SCHEDULE_NOT_REGISTERED','No complete future official schedule and fixed holdout window have been registered.'],
 ['PAIRED_FORECAST_CAPTURE_UNAVAILABLE','Current collection records one frozen winner baseline, not a same-cutoff candidate/incumbent pair.'],
 ['EXACT_CUTOFF_CAPTURE_UNSUPPORTED','Current cron and actual issue timestamps do not implement the policy exact input/issue offsets.'],
 ['REGISTRATION_BOUND_LEDGER_UNAVAILABLE','A registration-bound immutable per-game capture/exclusion ledger is not implemented.'],
 ['PAIRED_PRICE_EXPORT_NOT_POLICY_BOUND','Current quote eligibility is not an exporter enforcing this policy exact pair and 300-second age.'],
 ['OFFICIAL_SETTLEMENT_PROOF_UNAVAILABLE','Provider-reported finals are not automatically official settlement proof.'],
 ['REGISTRATION_NOT_PUBLISHED','No complete holdout registration and independent server receipt have been published.']
];

/** Records intent only. An attached audit is context, never permission to enroll. */
export function buildPendingStudyRequests({artifactAudit=null,artifactAuditReference=null}={}){
 return scopes.map(([sport,market])=>{
  const incumbent=createWinnerModelManifest(sport);
  const blockers=baseBlockers.map(([code,detail])=>({code,detail}));
  if(sport==='NFL')blockers.push(
   {code:'NFL_QUARTERBACK_CONFIRMATION_UNAVAILABLE',detail:'Official inactive lists do not confirm both starting quarterbacks.'},
   {code:'NFL_FUTURE_SCHEDULE_HORIZON_UNAVAILABLE',detail:'The required observed regular-season weeks exceed one season; the complete future schedule has not been published and pinned.'});
  if(market==='SPREAD')blockers.push(
   {code:'CANDIDATE_MARGIN_DISTRIBUTION_UNAVAILABLE',detail:'No selected independently tested exact-line candidate win/push/loss distribution is registered.'},
   {code:'INCUMBENT_MARGIN_DISTRIBUTION_UNAVAILABLE',detail:'No independently tested exact-line incumbent win/push/loss distribution is registered.'},
   {code:'SPREAD_CONFIRMATION_EXPORT_UNAVAILABLE',detail:'Research spread prices can be observed; registration-bound exact-cutoff spread forecast/export is not implemented.'});
  return {contract:'winner-validation-study-request-v1',studyId:`${sport.toLowerCase()}-${market.toLowerCase()}-${policy.id}`,sport,market,competition:sport,period:'FULL_GAME',seasonPhase:'REGULAR_SEASON',sideRule:'HOME',
   protocolId:policy.id,policyHash:REGISTRATION_POLICY_HASH,familyId:`${policy.id}:four-scope-intents`,familySize:4,status:'RECORDED_NOT_ENROLLING',...authority(),
   incumbentHash:incumbent.manifestHash,incumbentRef:{modelVersion:incumbent.modelVersion,manifestHash:incumbent.manifestHash,sourceArtifact:incumbent.sourceArtifact,coefficientsHash:incumbent.coefficientsHash},candidateRef:null,
   criteria:structuredClone(policy.scopes[`${sport}:${market}`]),powerPlan:null,windowStart:null,windowEnd:null,
   artifactAudit:artifactAuditReference?{path:artifactAuditReference.path,sha256:artifactAuditReference.sha256,contract:artifactAudit?.contract??null,status:'PREREQUISITE_CONTEXT_ONLY'}:null,
   collection:{existingFrozenBaseline:'CONTINUE_DEVELOPMENT',retroactiveEnrollment:false},blockers};
 });
}

// Same normal planning approximation used by the v1 final evaluator.
function inverseNormal(p){
 const a=[-39.6968302866538,220.946098424521,-275.928510446969,138.357751867269,-30.6647980661472,2.50662827745924];
 const b=[-54.4760987982241,161.585836858041,-155.698979859887,66.8013118877197,-13.2806815528857];
 const c=[-.00778489400243029,-.322396458041136,-2.40075827716184,-2.54973253934373,4.37466414146497,2.93816398269878];
 const d=[.00778469570904146,.32246712907004,2.445134137143,3.75440866190742];
 if(p<.02425){const q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
 if(p>1-.02425)return -inverseNormal(1-p);
 const q=p-.5,r=q*q;return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
const eastern=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
function blockFor(iso,unit){const day=eastern.format(new Date(iso));if(unit==='EASTERN_DAY')return day;const d=new Date(`${day}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
const stringList=x=>Array.isArray(x)&&x.every(text)&&new Set(x).size===x.length;
const sameList=(a,b)=>stringList(a)&&stringList(b)&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());

function preflight(input={}){
 const result={contract:'winner-validation-registration-preflight-v1',status:'BLOCKED',policyHash:REGISTRATION_POLICY_HASH,...authority(),independentAuditRequired:true,blockers:[]};
 const require=(ok,code,detail)=>{if(!ok)result.blockers.push({code,detail});return Boolean(ok);};
 const p=input?.proposedRegistration;
 if(!require(p&&typeof p==='object'&&!Array.isArray(p),'MISSING_PROPOSAL','An explicit future registration proposal is required.'))return result;
 const now=stamp(input.now),start=stamp(p.windowStart),end=stamp(p.windowEnd),scope=policy.scopes[`${p.sport}:${p.market}`];
 require(p.protocolId===policy.id&&p.policyHash===REGISTRATION_POLICY_HASH,'POLICY_MISMATCH','Pin the unchanged exact v1 policy bytes.');
 require(scope&&p.competition===p.sport&&p.period==='FULL_GAME'&&p.sideRule==='HOME'&&['REGULAR_SEASON','POSTSEASON'].includes(p.seasonPhase),'UNSUPPORTED_SCOPE','Only one NBA/NFL full-game HOME-side winner/spread season-phase cohort is supported.');
 require(!Object.hasOwn(p,'registeredAt')&&!Object.hasOwn(p,'createdAt'),'SERVER_REGISTRATION_REQUIRED','This is a proposal; a trusted registry must assign the actual registration timestamp later.');
 require(Number.isFinite(now)&&now>=stamp(policy.declaredAt)&&text(p.id)&&text(p.holdoutId)&&now<start&&start<end,'FUTURE_WINDOW','The complete registration must precede a fixed future window.');
 require(stamp(p.trainingThrough)<now,'TRAINING_OVERLAP','Training must end before actual registration.');
 require(!input.existingForecastIds?.length&&!input.rows?.length,'RETROACTIVE_ENROLLMENT','Existing forecasts cannot be adopted into a new confirmation holdout.');
 require(p.familySize===4&&p.power?.familySize===4,'FAMILY_MISMATCH','The four requested studies share the declared family of four.');
 const artifactKeys=['candidate','incumbent','features','sourceSchema',...(p.market==='SPREAD'?['candidateDistribution','incumbentDistribution']:[])];
 for(const key of artifactKeys)require(typeof input.artifacts?.[key]==='string'&&digest(p.modelHashes?.[key])&&hash(input.artifacts[key])===p.modelHashes[key],'MANIFEST_MISMATCH',`Missing or changed exact ${key} artifact bytes.`);
 require(digest(p.modelHashes?.candidate)&&p.modelHashes.candidate!==p.modelHashes?.incumbent,'CANDIDATE_EQUALS_INCUMBENT','The candidate must be distinct from the incumbent to test improvement.');
 function evidence(name,code){const e=input[name];if(!require(e&&typeof e.artifactBytes==='string'&&digest(e.sha256)&&hash(e.artifactBytes)===e.sha256,code,`Missing or altered ${name} bytes.`))return null;try{return JSON.parse(e.artifactBytes);}catch{require(false,code,`${name} must be a structured evidence artifact.`);return null;}}
 const inv=evidence('inventoryEvidence','INVENTORY_EVIDENCE');
 require(inv?.complete===true&&inv?.sourceKind==='DEVELOPMENT_ONLY'&&['trainingEventIds','developmentEventIds','previousHoldoutEventIds'].every(k=>sameList(p[k],inv?.[k]))&&stringList(inv?.previousHoldoutIds),'INVENTORY_EVIDENCE','Complete hash-bound training, development and previous-holdout inventories are required.');
 require(inv&&Array.isArray(inv.previousHoldoutIds)&&!inv.previousHoldoutIds.includes(p.holdoutId),'HOLDOUT_ID_REUSED','The holdout identity must not have been used before.');
 const variance=evidence('varianceEvidence','VARIANCE_EVIDENCE'),power=p.power;
 require(power&&power.targetBrierImprovement===policy.power.targetBrierImprovement&&finite(power.power)&&power.power>=policy.power.minimumPower&&power.power<1&&finite(power.pairedDifferenceSd)&&power.pairedDifferenceSd>0&&finite(power.designEffect)&&power.designEffect>=policy.power.minimumDesignEffect&&power.sourceKind==='DEVELOPMENT_ONLY'&&stamp(power.estimatedAt)<now,'POWER_PLAN','Complete development-based paired power assumptions must precede registration.');
 require(variance&&variance.sourceKind==='DEVELOPMENT_ONLY'&&variance.sport===p.sport&&variance.market===p.market&&variance.candidateSha256===p.modelHashes?.candidate&&variance.incumbentSha256===p.modelHashes?.incumbent&&variance.estimatedAt===power?.estimatedAt&&variance.pairedDifferenceSd===power?.pairedDifferenceSd&&variance.designEffect===power?.designEffect&&Number.isInteger(variance.n)&&variance.n>=2&&Number.isInteger(variance.blocks)&&variance.blocks>=2&&variance.blocks<=variance.n&&input.varianceEvidence?.sha256===power?.sourceSha256&&typeof input.varianceEvidence?.predictionBytes==='string'&&hash(input.varianceEvidence.predictionBytes)===variance.predictionSourceSha256,'VARIANCE_EVIDENCE','The paired variance plan must bind these candidates and actual development prediction bytes; a descriptive report is not a selected power plan.');
 const timing=p.forecastPolicy;
 require(timing&&Number.isInteger(timing.inputLeadSeconds)&&Number.isInteger(timing.issueLeadSeconds)&&timing.inputLeadSeconds>=timing.issueLeadSeconds&&timing.issueLeadSeconds>=policy.minimumPregameLeadSeconds&&Number.isInteger(timing.maximumCaptureDelaySeconds)&&timing.maximumCaptureDelaySeconds>=0&&timing.maximumCaptureDelaySeconds<=120,'CUTOFF_PLAN','Register exact input/issue offsets and a bounded real capture delay.');
 const cap=evidence('capabilityEvidence','CAPABILITY_EVIDENCE');
 require(cap?.contract==='winner-confirmation-capability-v1'&&cap.sport===p.sport&&cap.market===p.market&&stamp(cap.observedAt)<=now,'CAPABILITY_EVIDENCE','Capability evidence must identify this scope and precede preflight.');
 require(cap?.pairedForecasts===true&&cap?.immutableForecastReceipts===true,'CAPTURE_CAPABILITY','Actual immutable paired candidate/incumbent capture must be supported.');
 require(cap?.exactInputCutoff===true&&cap?.exactIssueTime===true&&cap?.supportedInputLeadSeconds?.includes(timing?.inputLeadSeconds)&&cap?.supportedIssueLeadSeconds?.includes(timing?.issueLeadSeconds)&&finite(cap?.minimumIssueLeadSeconds)&&timing?.issueLeadSeconds>=cap.minimumIssueLeadSeconds&&finite(cap?.maximumCaptureDelaySeconds)&&cap.maximumCaptureDelaySeconds>=0&&cap.maximumCaptureDelaySeconds<=timing?.maximumCaptureDelaySeconds,'TIMING_CAPABILITY','Current real issue/capture behavior must implement the exact registered offsets; no rounding or backdating.');
 require(cap?.registrationBoundLedger===true&&cap?.pregameExclusionReceipts===true,'LEDGER_CAPABILITY','Every scheduled capture and exclusion needs a registration-bound immutable pregame decision.');
 require(cap?.completePairedPrices===true&&finite(cap?.maximumPriceAgeSeconds)&&cap.maximumPriceAgeSeconds>=0&&cap.maximumPriceAgeSeconds<=policy.maximumPriceAgeSeconds,'PRICE_CAPABILITY','Exact two-sided prices and actual observation age must meet this policy.');
 require(cap?.officialSettlement===true,'OFFICIAL_SETTLEMENT_CAPABILITY','Official event/team/period settlement proof must be supported.');
 require(p.sport==='NBA'?cap?.nbaConfirmedStarters===true:cap?.nflConfirmedQuarterbacks===true&&cap?.nflOfficialInactives===true,'LINEUP_CAPABILITY','Both NBA starting fives, or both NFL starting quarterbacks and official inactives, must be verifiable before cutoff.');
 if(p.market==='SPREAD'){
  require(cap?.spreadExactLinePrices===true&&cap?.independentCoverDistributions===true,'SPREAD_CAPABILITY','Exact opposing spread prices and independently executed cover distributions must be supported.');
  for(const key of ['candidate','incumbent']){
   let d,report;try{d=JSON.parse(input.artifacts?.[`${key}Distribution`]);report=JSON.parse(input.distributionReports?.[key]);}catch{}
   require(d?.kind==='INDEPENDENT_MARGIN_DISTRIBUTION'&&d.evaluationStatus==='DEVELOPMENT_ONLY'&&stamp(d.testedAt)<now&&d.winnerProbabilityUsedAsCover===false&&typeof input.distributionReports?.[key]==='string'&&hash(input.distributionReports[key])===d.reportSha256&&report?.sport===p.sport&&report.market==='SPREAD'&&report.sourceKind==='DEVELOPMENT_ONLY'&&report.independentOfWinnerProbability===true&&report.exactLineCoverageTested===true&&report.pushAccountingTested===true,'DISTRIBUTION_EVIDENCE',`The ${key} must have independently tested exact-line win/push/loss artifact and development report bytes; winner percentages cannot substitute.`);
  }
 }
 const schedule=input.scheduledEvents,receipt=input.scheduleReceipt;
 require(Array.isArray(schedule)&&input.scopeComplete===true&&receipt&&/^https:\/\//.test(receipt.sourceUrl??'')&&Number.isFinite(stamp(receipt.observedAt))&&stamp(receipt.observedAt)<=now&&receipt.sha256===hash(JSON.stringify(schedule)),'SCHEDULE_EVIDENCE','A complete official future schedule with matching receipt bytes is required.');
 if(scope&&Number.isFinite(start)&&Number.isFinite(end))require((end-start)/86400000>=scope.minimumWindowDays,'WINDOW_DURATION','The fixed window must meet the sport/market duration floor.');
 if(!scope||!Array.isArray(schedule))return result;
 const ids=new Set(),matchups=new Set(),blocks=new Set(),used=new Set([...(p.trainingEventIds??[]),...(p.developmentEventIds??[]),...(p.previousHoldoutEventIds??[])]);
 for(const e of schedule){
  if(!e||typeof e!=='object'){require(false,'INVALID_SCHEDULE','Every scheduled event needs an exact official identity.');continue;}
  const eventTime=stamp(e.startsAt);
  require(text(e.eventId)&&!ids.has(e.eventId)&&eventTime>=start&&eventTime<end&&e.sport===p.sport&&e.competition===p.competition&&e.seasonPhase===p.seasonPhase&&text(e.homeTeamId)&&text(e.awayTeamId)&&e.homeTeamId!==e.awayTeamId&&e.selectedTeamId===e.homeTeamId&&e.opponentTeamId===e.awayTeamId,'INVALID_SCHEDULE','Unique exact event, phase, home/away and future-window identity are required.');
  ids.add(e.eventId);const matchup=JSON.stringify([e.startsAt,...[e.homeTeamId,e.awayTeamId].sort()]);
  require(!matchups.has(matchup),'DUPLICATE_MATCHUP','Provider aliases cannot count the same exact matchup twice.');matchups.add(matchup);
  require(!used.has(e.eventId),'HOLDOUT_LEAKAGE','No scheduled game may appear in training, development or a previously used holdout.');
  if(Number.isFinite(eventTime))blocks.add(blockFor(e.startsAt,scope.blockUnit));
 }
 if(result.blockers.length)return result;
 const intervalCount=p.market==='SPREAD'?policy.uncertainty.spreadIntervalsPerScope:policy.uncertainty.winnerIntervalsPerScope;
 const alpha=policy.uncertainty.familywiseAlpha/(intervalCount*4);
 const planned=Math.ceil(((inverseNormal(1-alpha/2)+inverseNormal(power.power))*power.pairedDifferenceSd/power.targetBrierImprovement)**2*power.designEffect);
 const iterations=Math.max(policy.uncertainty.bootstrapIterations,Math.ceil(2*policy.uncertainty.minimumExpectedTailSamples/alpha));
 result.requiredGames=Math.max(scope.minimumScoredGames,planned);result.scheduledGames=ids.size;result.scheduledBlocks=blocks.size;result.bootstrapIterations=iterations;
 require(iterations<=policy.uncertainty.maximumBootstrapIterations,'BOOTSTRAP_TAIL_RESOLUTION','Registered multiplicity must retain supported numerical tail resolution.');
 require(ids.size>=result.requiredGames,'SCHEDULE_GAME_FLOOR','The full future schedule cannot supply the larger of the scored-game floor and power target. Pushes/voids may require additional planned capacity.');
 require(blocks.size>=scope.minimumBlocks,'SCHEDULE_BLOCK_FLOOR','The official schedule cannot supply the required distinct observed game-day/week blocks.');
 if(!result.blockers.length)result.status='READY_FOR_REGISTRATION';
 result.limit='Advisory byte/contract consistency only. Independently verify source authenticity, complete schedules, candidate execution and registry receipts. A trusted registry must recheck at its actual commit time. This helper never registers or enrolls a holdout.';
 return result;
}

/** Even READY does not authorize enrollment or establish external receipt authenticity. */
export function preflightProspectiveRegistration(input){
 try{return preflight(input);}
 catch(error){return {contract:'winner-validation-registration-preflight-v1',status:'BLOCKED',policyHash:REGISTRATION_POLICY_HASH,...authority(),independentAuditRequired:true,blockers:[{code:'INVALID_INPUT',detail:error.message}]};}
}

function readJsonFile(file){const absolute=path.resolve(file),bytes=fs.readFileSync(absolute);if(bytes.length>10*1024*1024)throw Error('Input exceeds10MiB offline bound');return {value:JSON.parse(bytes),path:absolute,sha256:hash(bytes)};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2);let output;
  if(!args.length||args.length===2&&args[0]==='--audit'){
   const audit=args.length?readJsonFile(args[1]):null;
   const relative=audit?path.relative(process.cwd(),audit.path):null;
   const reference=audit?{path:relative&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative)?relative.replaceAll(path.sep,'/'):path.basename(audit.path),sha256:audit.sha256}:null;
   output={contract:'winner-validation-study-requests-v1',policyHash:REGISTRATION_POLICY_HASH,requests:buildPendingStudyRequests({artifactAudit:audit?.value,artifactAuditReference:reference})};
  }else if(args.length===2&&args[0]==='--preflight'){
   const bundle=readJsonFile(args[1]).value;output=preflightProspectiveRegistration({...bundle,now:new Date().toISOString()});
  }else throw Error('Usage: node winner-validation-registration.mjs [--audit prerequisites.json | --preflight proposal.json]');
  process.stdout.write(JSON.stringify(output,null,2)+'\n');
 }catch(error){process.stdout.write(JSON.stringify({status:'BLOCKED',...authority(),blockers:[{code:'INVALID_INPUT',detail:error.message}]},null,2)+'\n');process.exitCode=1;}
}
