import {persistenceDelta} from './nba-persistence.mjs';
import {directSgoProps} from '../local/nba-direct-props.mjs';
import {createBdlBackup} from '../local/bdl-live.mjs';
import {sgoPage} from '../local/sgo-nba-history.mjs';
import {sgoPropTick} from '../local/sgo-nba-collector.mjs';
import {fetchResultResponse} from '../../supabase/functions/_shared/performance-worker.mjs';
import {propTick} from '../local/prop-tick.mjs';
import {createMatchedCollector} from '../local/prop-matched-collector.mjs';
import {isValidatedAutomaticInactive,verifyOneInactiveEvent} from './nba-inactive.mjs';
import {publishNbaLiveDecisions} from './nba-live-decisions.mjs';
export function stagedStore(pending=[]){
 const rows=new Map(pending.map(r=>[r.identity,r])),observations=[],forecasts=new Map(),outcomes=new Map();
 return {
 insert(row){if(rows.has(row.identity))return 0;const compact={...row,context:{teamId:row.context?.teamId,opponentTeamId:row.context?.opponentTeamId,...(row.context?.sourceContract?{sourceContract:row.context.sourceContract}:{})}};rows.set(row.identity,compact);observations.push(compact);return 1;},
 appendForecast(row){if(row.productionWeight!==0||row.productionEligible!==false||!(Date.parse(row.issuedAt)<Date.parse(row.startsAt)))throw Error('Invalid forecast');const key=row.identity+':'+row.modelHash;if(forecasts.has(key))return 0;forecasts.set(key,row);return 1;},
 pending(){return [...rows.values()].filter(r=>!outcomes.has(r.identity));},rows(){return [...rows.values()];},outcomes(){return [...outcomes.values()];},
 settle(row){if(!rows.has(row.identity)||outcomes.has(row.identity)||row.researchOnly!==true||!(['WIN','LOSS','PUSH'].includes(row.outcome)||isValidatedAutomaticInactive(row,rows.get(row.identity))))return 0;outcomes.set(row.identity,row);return 1;},
 delta(){return {observations,forecasts:[...forecasts.values()],outcomes:[...outcomes.values()]};}
 };
}
export async function runHosted({rpc,artifact,probabilityArtifact,backupArchive,bdlArchive,validationProtocol=null,minutesArtifact=null,minutesProtocol=null,sgoKey=null,bdlKey=null,fetchImpl=fetch,clock=()=>new Date().toISOString()}){
 const lease=await rpc('claim_nba_prop_run_v2',{p_source_contract:sgoKey?'sgo-nba-v1':'legacy'});if(!lease)return {skipped:'LEASE_BUSY'};
 const db=stagedStore(lease.pending??[]),cache={teamPairCursor:lease.state?.teamPairCursor??0,summaries:{}},cooldowns=lease.state?.cooldowns??{};
 const loaded=new Set(),started=Date.now();let calls=0;
 const boundedFetch=(url,options)=>{if(++calls>45||Date.now()-started>100000)throw Error('RUN_BUDGET');return fetchImpl(url,options);};
 if(sgoKey){
  const state={...lease.state},summaries={};let report,decisionQuoteBody=null;
  const loadSummaries=async ids=>{const saved=await rpc('load_nba_prop_summaries_v1',{p_ids:ids});for(const id of Object.keys(saved??{}))loaded.add(id);return saved??{};};
  const liveBackup=bdlKey?createBdlBackup({key:bdlKey,state,summaries,loadSummaries,fetchImpl:boundedFetch,clock}):null;
  try{
   const feed=await fetchResultResponse('https://sports-analytics-prediction-system-tau.vercel.app/api/nbaprops?books=draftkings&limit=8',{fetchImpl:boundedFetch});
   const injury=await fetchResultResponse('https://sports-analytics-prediction-system-tau.vercel.app/api/nbaavailability',{fetchImpl:boundedFetch});
   const page=params=>sgoPage(params,{key:sgoKey,state,clock,fetchImpl:boundedFetch});
   let quoteBody=feed.ok?feed.body:{events:[],generatedAt:clock()},quoteFallback=null;
   if(!feed.ok){try{quoteBody=await directSgoProps({page,clock});quoteFallback='DIRECT_SGO_BOUNDED_FALLBACK';}catch(error){quoteFallback=error.message;}}
   decisionQuoteBody=quoteBody;
   report=await sgoPropTick(db,{body:quoteBody,state,summaries,page,clock,artifact,probabilityArtifact,backupArchive,bdlArchive,liveBackup,validationProtocol,minutesArtifact,minutesProtocol,officialReport:injury.ok?injury.body:null,loadSummaries});
   report.quoteFallback=quoteFallback;
   if(!injury.ok)report.faults.push('official-injury:'+injury.error);
   if(!feed.ok)report.faults.push('props:'+feed.error);
  }catch(e){report={at:clock(),faults:[e.message?.startsWith('SGO_')?e.message:'SGO_CYCLE_FAILED'],productionWeight:0};}
  try{report.inactiveVerification=await verifyOneInactiveEvent(db,{state,page:params=>sgoPage(params,{key:sgoKey,state,clock,fetchImpl:boundedFetch}),fetchImpl:boundedFetch,clock,remainingMs:()=>100000-(Date.now()-started)});}catch{report.inactiveVerification={checkedEvents:0,inactiveOutcomes:0,reason:'INACTIVE_SOURCE_FAILED'};}
  report.backup={configured:Boolean(bdlKey),cachedDates:Object.keys(state.bdl?.dates??{}).length,nextRequestAt:state.bdl?.nextRequestAt??null,lastVerifiedAt:state.bdl?.lastVerifiedAt??null,lastError:state.bdl?.lastError??null};
  const fresh=Object.fromEntries(Object.entries(summaries).filter(([id])=>!loaded.has(id)));
  const delta=await persistenceDelta(rpc,db.delta());
  report.persistence={forecastCandidates:db.delta().forecasts.length,forecastWrites:delta.forecasts.length};
  const persisted=await rpc('finish_nba_prop_run_v1',{p_token:lease.token,p_delta:delta,p_state:state,p_summaries:fresh,p_report:{...report,requests:calls,scope:'NBA SportsGameOdds native identities; partial quote coverage'}});
  report.liveDecisions=await publishNbaLiveDecisions({rpc,forecasts:db.delta().forecasts,body:decisionQuoteBody,clock});
  return {ok:true,persisted,report};
 }
 const collector=createMatchedCollector(artifact,cache,async()=>null,{probabilityArtifact,teamLimit:2,summaryLimit:8,loadSummaries:async ids=>{
  const saved=await rpc('load_nba_prop_summaries_v1',{p_ids:ids});for(const id of Object.keys(saved??{}))loaded.add(id);return saved??{};
 }});
 let report;
 try {report=await propTick(db,{url:'https://sports-analytics-prediction-system-tau.vercel.app/api/nbaprops?books=draftkings&limit=8',fetchImpl:boundedFetch,clock,cooldowns,matchedCollector:collector});}
 catch {report={at:clock(),faults:['HOSTED_CYCLE_FAILED']};}
 const summaries=Object.fromEntries(Object.entries(cache.summaries).filter(([id])=>!loaded.has(id)));
 const delta=await persistenceDelta(rpc,db.delta());
 report.persistence={forecastCandidates:db.delta().forecasts.length,forecastWrites:delta.forecasts.length};
 const persisted=await rpc('finish_nba_prop_run_v1',{p_token:lease.token,p_delta:delta,p_state:{teamPairCursor:cache.teamPairCursor,cooldowns},p_summaries:summaries,p_report:{...report,requests:calls,productionWeight:0,scope:'NBA DraftKings; up to 8 provider events; partial coverage'}});
 return {ok:true,persisted,report};
}


