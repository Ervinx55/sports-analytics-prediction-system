/** Diagnostics only: retain exact source blockers and explain ungraded rows. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const collectorPath='scripts/local/sgo-nba-collector.mjs';
export const originalCollectorSha256='59051a74c33ccbd983b6bc925c1fad5165043de10296875eb8bdd8dbbd92eb56';
const sha=value=>createHash('sha256').update(value).digest('hex');
function replaceOnce(source,before,after){
 if(source.split(before).length!==2)throw Error('COLLECTOR_PATCH_CONTEXT_MISMATCH');
 return source.replace(before,after);
}

// These helpers only describe failed settlement attempts. They never issue an
// outcome, repair a fixture, fetch a source, or change the settlement decision.
const diagnostics=String.raw`function settlementFailureCode(error){
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
`;

export function patchDiagnosticsSource(source){
 if(typeof source!=='string'||sha(source)!==originalCollectorSha256)throw Error('COLLECTOR_SOURCE_CHANGED_REVIEW_REQUIRED');
 let result=replaceOnce(source,'export function selectSgoSettlementEvents',diagnostics+'export function selectSgoSettlementEvents');
 result=replaceOnce(result,'report.settlement={selectedEvents:ids.length,pendingRows:ordered.length,failures:{}};','report.settlement={selectedEvents:ids.length,pendingRows:ordered.length,failures:{},unresolvedRows:0,unresolved:{}};');
 result=replaceOnce(result,'if(events.length!==1)continue;let out=sgoOutcome','if(events.length!==1){recordUnresolvedSettlement(report,row.eventID,\'SGO_SETTLEMENT_EVENT_MISSING\');continue;}let out=sgoOutcome');
 result=replaceOnce(result,"const reason=/^[A-Z][A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'SETTLEMENT_SOURCE_FAILED';","const reason=settlementFailureCode(error);");
 result=replaceOnce(result,'if(out)report.settled+=db.settle(out);}',"if(out)report.settled+=db.settle(out);else recordUnresolvedSettlement(report,row.eventID,report.settlement.failures[row.eventID]??unresolvedSettlementReason(row,events[0],p.observedAt,season(row.startsAt),repaired.get(row.eventID)));}");
 return result;
}

export function patchHostedDiagnosticsBundle(bundle){
 if(bundle?.slug!=='collect-nba-props'||bundle.version!==43||bundle.verify_jwt!==true||!Array.isArray(bundle.files))throw Error('HOSTED_BUNDLE_CHANGED_REVIEW_REQUIRED');
 if(bundle.files.some(f=>typeof f?.name!=='string'||typeof f?.content!=='string')||new Set(bundle.files.map(f=>f.name)).size!==bundle.files.length)throw Error('INVALID_HOSTED_FILES');
 const matches=bundle.files.filter(f=>f.name===collectorPath);if(matches.length!==1)throw Error('COLLECTOR_FILE_NOT_UNIQUE');
 const source=matches[0].content,patched=patchDiagnosticsSource(source);
 return {slug:bundle.slug,verify_jwt:true,entrypoint_path:'supabase/functions/collect-nba-props/index.ts',files:bundle.files.map(f=>f.name===collectorPath?{...f,content:patched}:{...f}),audit:{sourceVersion:43,sourceSha256:sha(source),patchedSha256:sha(patched),changedFiles:[collectorPath],diagnosticsOnly:true,settlementRulesChanged:false,productionWeightChanged:false,forecastOrModelFilesChanged:false}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Usage: node scripts/nba/patch-hosted-outcome-diagnostics.mjs INPUT_V43_EXPORT OUTPUT_BUNDLE');
 const result=patchHostedDiagnosticsBundle(JSON.parse(readFileSync(input,'utf8')));
 writeFileSync(output,JSON.stringify(result));console.log(JSON.stringify(result.audit,null,2));
}
