import {minutesPair} from './nba-minutes-comparison.mjs';
import {historyInputRevisions} from './nba-gamebook-revision.mjs';
import {liveBdlContract} from './bdl-live.mjs';
import {repairVerifiedBdl} from './nba-verified-bdl.mjs';
import {repairSgoWithArchive} from './nba-archived-backup.mjs';
import {pregameEvidence} from './nba-pregame.mjs';
import {describeQuoteReadiness} from './nba-quote-readiness.mjs';
import {createHash} from 'node:crypto';
import {normalizeResearch} from '../../sharp-service/research-data.js';
import {baselineFeatures,matchedFeatures,projectCandidate} from './nba-matched-context.mjs';
import {probabilityForecast} from './nba-probability.mjs';
import {parseSgoNbaSummary,sgoOutcome} from './sgo-nba-history.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function validationEnrollment(protocol,modelHash,issuedAt,startsAt){
 const time=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
 return protocol?.modelHash===modelHash&&typeof protocol.id==='string'&&time(protocol.startsAt)<=time(issuedAt)&&time(issuedAt)<time(startsAt)&&time(startsAt)<time(protocol.endsAt)?protocol.id:null;
}
export const sgoModelHash=({artifact,probabilityArtifact,backupArchive,bdlArchive,liveBackup})=>hash({...(liveBackup?{liveBdlContract}:{}),...(bdlArchive?{bdlArchiveSha256:hash(bdlArchive)}:{}),pregameContract:'nba-pregame-v2',forecastDependencyContract:'own-team-baseline-v1',sourceContract:'sgo-nba-v1',historyContract:backupArchive?'sgo-history-backup-v1':'sgo-history-v2',backupSha256:backupArchive?hash(backupArchive):null,context:artifact,probability:probabilityArtifact});
const season=at=>new Date(at).getUTCFullYear()-(new Date(at).getUTCMonth()<8?1:0);
function settlementFailureCode(error){
 const message=error?.message;
 if(typeof message!=='string'||message.length>101)return 'SETTLEMENT_SOURCE_FAILED';
 if(/^[A-Z][A-Z0-9_]{1,100}$/.test(message))return message;
 const match=/^(TEAM_TOTAL_CONFLICT|PLAYER_STATS_CONFLICT|PLAYER_DERIVED_STATS_CONFLICT)_(.+)$/.exec(message);
 const fields=['points','rebounds','assists','fieldGoalsAttempted','freeThrowsAttempted','offensiveRebounds','turnovers','blocks','steals','fouls','fieldGoalsMade','threePointersMade','threePointersAttempted','freeThrowsMade','defensiveRebounds','plusMinus','twoPointersMade','twoPointersAttempted','points+assists','points+rebounds','points+rebounds+assists','rebounds+assists','blocks+steals'];
 return match&&fields.includes(match[2])?message:'SETTLEMENT_SOURCE_FAILED';
}
function unresolvedSettlementReason(row,event,retrievedAt,seasonYear,verifiedSummary){
 try{
  if(row.context?.sourceContract!=='sgo-nba-v1')return 'FORECAST_SOURCE_CONTRACT_UNSUPPORTED';
  if(row.eventID!=='sgo:'+event.eventID)return 'FORECAST_EVENT_MISMATCH';
  if(!['points','rebounds','assists'].includes(row.market)||!['OVER','UNDER'].includes(row.side)||typeof row.line!=='number'||!Number.isFinite(row.line))return 'FORECAST_MARKET_INVALID';
  const g=verifiedSummary??parseSgoNbaSummary(event,retrievedAt,seasonYear);
  if(g.id!==row.eventID)return 'SUMMARY_EVENT_MISMATCH';
  const matches=g.players.filter(p=>p.id===row.playerID);
  if(!matches.length)return 'VERIFIED_POSITIVE_MINUTE_PLAYER_MISSING';
  if(!matches.some(p=>p.teamId===row.context.teamId))return 'SUMMARY_PLAYER_TEAM_MISMATCH';
  if(!g.teams.some(t=>t.id===row.context.opponentTeamId)||row.context.teamId===row.context.opponentTeamId)return 'SUMMARY_OPPONENT_MISMATCH';
  const instant=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
  const start=instant(row.startsAt),officialStart=instant(g.startsAt),received=instant(row.receivedAt);
  if(![start,officialStart,received].every(Number.isFinite))return 'FORECAST_TIME_INVALID';
  if(Math.abs(start-officialStart)>900000)return 'FORECAST_START_MISMATCH';
  if(!(received<Math.min(start,officialStart)))return 'FORECAST_NOT_PREGAME';
  return 'SETTLEMENT_OUTCOME_UNAVAILABLE';
 }catch(error){return settlementFailureCode(error);}
}
function recordUnresolvedSettlement(report,eventID,reason){
 const counts=report.settlement.unresolved[eventID]??={};
 counts[reason]=(counts[reason]??0)+1;report.settlement.unresolvedRows++;
}
export function selectSgoSettlementEvents(rows,state){
 if(!rows.length)return [];
 const key=rows.map(r=>r.startsAt.slice(0,10)).sort()[0];
 const ids=[...new Set(rows.map(r=>r.eventID.slice(4)))].sort();
 state.sgoSettlementCursors??={};const cursor=state.sgoSettlementCursors[key]??0;
 const selected=Array.from({length:Math.min(8,ids.length)},(_,i)=>ids[(cursor+i)%ids.length]);
 // Rotate priority even when every event fits: the backup permits one fresh date per run.
 state.sgoSettlementCursors[key]=(cursor+(ids.length<=8?1:selected.length))%ids.length;
 for(const old of Object.keys(state.sgoSettlementCursors).sort().slice(0,-31))delete state.sgoSettlementCursors[old];
 return selected;
}
export async function exactSgoEvents(ids,page,expandResults=false){
 const events=[],seen=new Set(),cursors=new Set();let cursor=null,observedAt;
 for(let i=0;i<3;i++){
  const p=await page({leagueID:'NBA',eventIDs:ids.join(','),type:'match',oddID:'points-home-game-ml-home',limit:'20',...(expandResults?{expandResults:'true'}:{}),...(cursor?{cursor}:{})});observedAt=p.observedAt;
  for(const e of p.events){if(!ids.includes(e.eventID)||seen.has(e.eventID))throw Error('SGO_EVENT_ID_MISMATCH');seen.add(e.eventID);events.push(e);}
  if(!p.nextCursor)return {events,observedAt};
  if(cursors.has(p.nextCursor))throw Error('SGO_REPEATED_CURSOR');cursors.add(p.nextCursor);cursor=p.nextCursor;
 }
 throw Error('SGO_EXACT_PAGE_INCOMPLETE');
}
export function historyReadyForTeams(h,teams){return h?.complete===true&&!h.failure&&!h.invalid.some(r=>!Array.isArray(r.teams)||r.teams.length!==2||r.teams.some(t=>typeof t!=='string')||r.teams.some(t=>teams.includes(t)));}
export function historyReadiness(h,summaries,teams){
 const invalid=(h?.invalid??[]).filter(r=>!Array.isArray(r.teams)||r.teams.length!==2||r.teams.some(t=>typeof t!=='string'||teams.includes(t)));
 const missing=(h?.ids??[]).filter(id=>!summaries[id]);
 return {ready:historyReadyForTeams(h,teams)&&missing.length===0,teams,invalidGames:invalid.map(r=>({eventID:r.eventID,reason:r.reason})),missingSummaryIds:missing,complete:h?.complete===true,failure:h?.failure??null};
}

async function resolvedSummary(e,observedAt,year,{backupArchive,bdlArchive,liveBackup}){
 try{return parseSgoNbaSummary(e,observedAt,year);}catch(primary){
  try{if(!backupArchive)throw primary;return repairSgoWithArchive(e,backupArchive,observedAt,year);}catch(old){
   try{if(!bdlArchive?.games.some(r=>r.summary.id==='sgo:'+e.eventID))throw old;return repairVerifiedBdl(e,bdlArchive,observedAt);}catch(archived){
    if(!liveBackup)throw archived;return liveBackup(e,observedAt);
   }
  }
 }
}
export async function collectSgoHistory({state,summaries,page,clock,backupArchive,bdlArchive,liveBackup}){
 const now=clock(),year=season(now),contract=liveBackup?'sgo-history-live-bdl-v1:'+hash({backupArchive,bdlArchive,liveBdlContract}):bdlArchive?'sgo-history-bdl-v1:'+hash({backupArchive,bdlArchive}):backupArchive?'sgo-history-backup-v1:'+hash(backupArchive):'sgo-history-v2';let h=state.sgoHistory;
 if(!h||h.contract!==contract||h.seasonYear!==year||h.failure&&Date.parse(now)>=h.failure.retryAfter||h.complete&&Date.parse(now)-Date.parse(h.cutoff)>=86400000){h=state.sgoHistory={contract,repaired:0,seasonYear:year,cutoff:now,ids:[],eventIDs:[],cursor:null,cursors:[],complete:false,invalid:[]};}
 if(h.failure)return h;
 if(h.complete){
  const selected=h.invalid.filter(r=>typeof r.eventID==='string'&&(!r.lastCheckedAt||Date.parse(now)-Date.parse(r.lastCheckedAt)>=6*3600000)).sort((a,b)=>(Date.parse(a.lastCheckedAt)||0)-(Date.parse(b.lastCheckedAt)||0)).slice(0,8);
  h.reconciliation={at:now,checked:0,accepted:0,remaining:h.invalid.length};
  if(!selected.length)return h;
  // Failed/missing responses never erase quarantine. At most eight games per cycle.
  const previousChecks=new Map(selected.map(r=>[r,r.lastCheckedAt]));
  for(const r of selected)r.lastCheckedAt=now;
  const result=await exactSgoEvents(selected.map(r=>r.eventID),page,true);
  for(const r of selected){
   h.reconciliation.checked++;
   const e=result.events.find(e=>e.eventID===r.eventID);if(!e){r.reason='SGO_CORRECTION_EVENT_MISSING';continue;}
   try{
    const g=await resolvedSummary(e,result.observedAt,year,{backupArchive,bdlArchive,liveBackup});
    if(Date.parse(g.startsAt)>=Date.parse(h.cutoff))throw Error('SGO_HISTORY_CUTOFF');
    if(h.eventIDs.includes(g.id))throw Error('SGO_DUPLICATE_GAME');
    const key=g.id+':'+hash(g);summaries[key]=g;h.ids.push(key);h.eventIDs.push(g.id);
    if(g.backupEvidence)h.repaired=(h.repaired??0)+1;
    h.invalid=h.invalid.filter(x=>x!==r);h.reconciliation.accepted++;
   }catch(err){r.reason=err.message;if(/^BDL_(RUN_BUDGET|COOLDOWN)$/.test(err.message)){if(previousChecks.get(r))r.lastCheckedAt=previousChecks.get(r);else delete r.lastCheckedAt;}}
  }
  h.reconciliation.remaining=h.invalid.length;return h;
 }
 const fail=reason=>{h.failure={reason,retryAfter:Date.parse(now)+86400000};throw Error(reason);};
 for(let i=0;i<2;i++){
  const p=await page({leagueID:'NBA',type:'match',finalized:'true',startsAfter:`${year}-09-01T00:00:00Z`,startsBefore:h.cutoff,expandResults:'true',oddID:'points-home-game-ml-home',limit:'20',...(h.cursor?{cursor:h.cursor}:{})});
  for(const e of p.events){
   // Preseason is outside the fitted regular-season contract.
   if(/^NBA Preseason\b/i.test(e.info?.seasonWeek??''))continue;
   try{const g=await resolvedSummary(e,p.observedAt,year,{backupArchive,bdlArchive,liveBackup});if(g.backupEvidence)h.repaired++;if(Date.parse(g.startsAt)>=Date.parse(h.cutoff))throw Error('SGO_HISTORY_CUTOFF');
    if(h.eventIDs.includes(g.id))throw Error('SGO_DUPLICATE_GAME');h.eventIDs.push(g.id);const key=g.id+':'+hash(g);h.ids.push(key);summaries[key]=g;
   }catch(err){const teams=[e.teams?.home?.teamID,e.teams?.away?.teamID];h.invalid.push({eventID:e.eventID??null,reason:err.message,teams:e.leagueID==='NBA'&&teams.every(t=>typeof t==='string'&&t.endsWith('_NBA'))&&teams[0]!==teams[1]?teams:null});}
  }
  if(h.ids.length>1500||h.invalid.length>200)fail('SGO_HISTORY_LIMIT');
  if(!p.nextCursor){h.complete=true;break;}
  if(h.cursors.includes(p.nextCursor))fail('SGO_REPEATED_CURSOR');
  h.cursors.push(p.nextCursor);h.cursor=p.nextCursor;
 }
 return h;
}
/** Separate native-identity cohort; no retrospective conversion of ESPN rows. */
export async function sgoPropTick(db,{body,state,summaries,page,clock,artifact,probabilityArtifact,backupArchive,bdlArchive,liveBackup=null,officialReport=null,validationProtocol=null,minutesArtifact=null,minutesProtocol=null,loadSummaries=async()=>({})}){
 const report={minutesComparison:{protocolId:minutesProtocol?.id??null,forecasts:0,blocked:0,reasons:{}},at:clock(),source:'SportsGameOdds',captured:0,settled:0,forecasts:0,blocked:0,faults:[],productionWeight:0};
 const modelHash=sgoModelHash({artifact,probabilityArtifact,backupArchive,bdlArchive,liveBackup});
 report.validation={protocolId:validationProtocol?.id??null,modelHash,matchesFrozenModel:validationProtocol?.modelHash===modelHash,enrolledForecasts:0};
 const settlePending=async()=>{
 const pending=db.pending().filter(r=>r.context?.sourceContract==='sgo-nba-v1'&&Date.parse(r.startsAt)<Date.parse(clock()));
 const ids=selectSgoSettlementEvents(pending,state);
 if(ids.length)try{
  const p=await exactSgoEvents(ids,page,true);
  const repaired=new Map();
  const priority=new Map(ids.map((id,index)=>[`sgo:${id}`,index]));
  const ordered=pending.filter(row=>priority.has(row.eventID)).sort((a,b)=>priority.get(a.eventID)-priority.get(b.eventID));
  report.settlement={selectedEvents:ids.length,pendingRows:ordered.length,failures:{},unresolvedRows:0,unresolved:{}};
  for(const row of ordered){const events=p.events.filter(e=>`sgo:${e.eventID}`===row.eventID);if(events.length!==1){recordUnresolvedSettlement(report,row.eventID,'SGO_SETTLEMENT_EVENT_MISSING');continue;}let out=sgoOutcome(row,events[0],p.observedAt,season(row.startsAt));if(!out&&liveBackup){try{if(!repaired.has(row.eventID)){try{repaired.set(row.eventID,await resolvedSummary(events[0],p.observedAt,season(row.startsAt),{backupArchive,bdlArchive,liveBackup}));}catch(error){repaired.set(row.eventID,null);const reason=settlementFailureCode(error);report.settlement.failures[row.eventID]=reason;}}const g=repaired.get(row.eventID);if(g)out=sgoOutcome(row,events[0],p.observedAt,season(row.startsAt),g);}catch{}}if(out)report.settled+=db.settle(out);else recordUnresolvedSettlement(report,row.eventID,report.settlement.failures[row.eventID]??unresolvedSettlementReason(row,events[0],p.observedAt,season(row.startsAt),repaired.get(row.eventID)));}
 }catch(e){report.faults.push(e.message);}
 };
 // Alternate priority so permanent historical conflicts cannot starve outcomes.
 const settlementFirst=Boolean(liveBackup&&state.bdlSettlementFirst);
 if(liveBackup)state.bdlSettlementFirst=!settlementFirst;
 if(settlementFirst)await settlePending();
 let h;
 try{h=await collectSgoHistory({state,summaries,page,clock,backupArchive,bdlArchive,liveBackup});}catch(e){h=state.sgoHistory;report.faults.push(e.message);}
 if(h?.complete){
  for(let i=0;i<h.ids.length;i+=200)Object.assign(summaries,await loadSummaries(h.ids.slice(i,i+200)));
 }else report.faults.push(h?.invalid.length?'SGO_HISTORY_INVALID':'SGO_HISTORY_WARMUP');
 report.history={complete:Boolean(h?.complete),games:h?.ids.length??0,invalid:h?.invalid.length??0,repaired:h?.repaired??0,cutoff:h?.cutoff??null,failure:h?.failure??null,reconciliation:h?.reconciliation??null};
 // Immutable provenance is shared across the run, not rehashed per quote.
 const backupArchiveSha256=backupArchive?hash(backupArchive):null,historySnapshotDigest=hash(h?.ids??[]);
 const evidenceByPlayer=new Map();
 report.pregame={reportPublishedAt:officialReport?.publishedAt??null,reportRetrievedAt:officialReport?.retrievedAt??null,availabilityStatuses:{},availabilityReasons:{},minutesCandidates:0,minutesUnavailable:0};
 let rows=[];try{rows=normalizeResearch(body,'NBA',Date.parse(clock())).filter(r=>r.provider==='SportsGameOdds'&&r.eventID.startsWith('sgo:')&&['points','rebounds','assists'].includes(r.marketType));}catch{report.faults.push('INVALID_PROP_FEED');}
 report.quoteReadiness=describeQuoteReadiness(body,rows,Date.parse(clock()));
 const eventIDs=[...new Set(rows.map(r=>r.eventID.slice(4)))].slice(0,8),current=new Map();
 if(eventIDs.length)try{
  const p=await exactSgoEvents(eventIDs,page);
  for(const e of p.events){if(current.has(e.eventID))throw Error('SGO_DUPLICATE_CURRENT_EVENT');current.set(e.eventID,e);}
 }catch(e){current.clear();report.faults.push(e.message);}
 for(const r of rows)try{
  const issuedAt=clock(),now=Date.parse(issuedAt),e=current.get(r.eventID.slice(4)),p=e?.players?.[r.playerID];
  const fresh=t=>Number.isFinite(Date.parse(t))&&Date.parse(t)<=now&&now-Date.parse(t)<=600000;
  if(!e||e.leagueID!=='NBA'||e.type!=='match'||e.status.started||e.status.finalized||e.status.cancelled||Date.parse(e.status.startsAt)!==Date.parse(r.startsAt)||!(Date.parse(r.startsAt)>now)||!p||p.playerID!==r.playerID)throw Error('SGO_CURRENT_IDENTITY_UNVERIFIED');
  const teams=[e.teams?.home?.teamID,e.teams?.away?.teamID];if(teams.some(t=>typeof t!=='string'||!t.endsWith('_NBA'))||teams[0]===teams[1]||!teams.includes(p.teamID))throw Error('SGO_CURRENT_TEAM_UNVERIFIED');
  if(![r.generatedAt,r.updatedAt,r.oppositeUpdatedAt].every(fresh)||!Number.isFinite(r.market)||!Number.isFinite(r.line)||!Number.isFinite(r.odds))throw Error('QUOTE_NOT_CURRENT_PAIRED');
  const teamId=p.teamID,opponentTeamId=teams.find(t=>t!==teamId),identity=hash([r.eventID,r.playerID,r.marketType,r.side,r.line,r.book]);
  const evidenceKey=e.eventID+':'+r.playerID;
  if(!evidenceByPlayer.has(evidenceKey)){
   const baseline=historyReadiness(h,summaries,[teamId]),context=historyReadiness(h,summaries,[teamId,opponentTeamId]),ready=baseline.ready;
   const evidence=pregameEvidence(officialReport,e,r.playerID,issuedAt,ready?h.ids.map(id=>summaries[id]):[]);
   evidence.historyReadiness={baseline,context};
   if(!ready)evidence.minutes.reason='OWN_TEAM_HISTORY_INCOMPLETE';
   evidenceByPlayer.set(evidenceKey,evidence);
   report.pregame.availabilityStatuses[evidence.availability.status]=(report.pregame.availabilityStatuses[evidence.availability.status]??0)+1;
   if(evidence.availability.status==='UNKNOWN')report.pregame.availabilityReasons[evidence.availability.reason]=(report.pregame.availabilityReasons[evidence.availability.reason]??0)+1;
   report.pregame[evidence.minutes.status==='EXPERIMENTAL_UNVALIDATED'?'minutesCandidates':'minutesUnavailable']++;
  }
  const pregame=evidenceByPlayer.get(evidenceKey);
  const base={identity,eventID:r.eventID,playerID:r.playerID,sport:'NBA',market:r.marketType,side:r.side,line:r.line,book:r.book,odds:r.odds,startsAt:r.startsAt,receivedAt:issuedAt,issuedAt,quoteAt:r.updatedAt,oppositeQuoteAt:r.oppositeUpdatedAt,marketProbability:r.market,source:'SportsGameOdds',context:{teamId,opponentTeamId,sourceContract:'sgo-nba-v1'},productionEligible:false,productionWeight:0};
  base.pregame=pregame;
  report.captured+=db.insert(base);
  if(!pregame.historyReadiness.baseline.ready)throw Error('SGO_OWN_TEAM_HISTORY_NOT_COMPLETE');
  const history=h.ids.map(id=>summaries[id]),query={teamId,opponentTeamId,playerId:r.playerID,market:r.marketType,startsAt:r.startsAt,cutoff:issuedAt};
  let x=baselineFeatures(history,query),contextBlocker=null;
  if(pregame.historyReadiness.context.ready){try{x=matchedFeatures(history,query);}catch(error){contextBlocker=error.message;}}
  else contextBlocker='OPPONENT_HISTORY_INCOMPLETE';
  const probability=probabilityForecast(probabilityArtifact,r.marketType,x.baseline,r.line,r.side,issuedAt);
  const enrollment=validationEnrollment(validationProtocol,modelHash,issuedAt,r.startsAt);
  const forecast={...base,modelHash,validationProtocol:enrollment,features:x,historySnapshotDigest,historyCutoff:h.cutoff,backupArchiveSha256,baselineProjection:x.baseline,contextBlocker,forecastScope:contextBlocker?'BASELINE_ONLY':'BASELINE_AND_CONTEXT',candidateProjection:contextBlocker||r.marketType==='assists'?null:projectCandidate(x,artifact.models[r.marketType]?.combined,r.marketType),probability,modelProbability:probability.modelProbability,blockers:[...pregame.blockers,'CROSS_PROVIDER_VALIDATION_REQUIRED','PARTICIPATION_UNVERIFIED','PROJECTED_MINUTES_UNVERIFIED','BOOK_SETTLEMENT_UNVERIFIED','PRODUCTION_PROMOTION_NOT_VALIDATED','NO_VALIDATED_PROBABILITY']};
  // Source repairs have an independent audit trail; existing forecasts are append-only.
  forecast.inputDataRevisions=historyInputRevisions(history);
  forecast.inputDataRevisionReviewRequired=forecast.inputDataRevisions.length>0;
  // Provenance survives the holdout window; enrollment remains unchanged.
  forecast.reviewedProtocol=validationProtocol?.modelHash===modelHash?validationProtocol.id:null;
  const appended=db.appendForecast(forecast);
  if(minutesArtifact&&minutesProtocol){try{report.minutesComparison.forecasts+=db.appendForecast(minutesPair({base:forecast,history,artifact:minutesArtifact,protocol:minutesProtocol,reviewedContinuation:true}));}catch(error){report.minutesComparison.blocked++;report.minutesComparison.reasons[error.message]=(report.minutesComparison.reasons[error.message]??0)+1;}}
  report.forecasts+=appended;if(enrollment)report.validation.enrolledForecasts+=appended;
 }catch(e){report.blocked++;report.faults.push(e.message);}
 if(!settlementFirst)await settlePending();
 state.pregameSnapshot={at:clock(),players:Object.fromEntries(evidenceByPlayer)};
 report.faults=[...new Set(report.faults)];return report;
}
