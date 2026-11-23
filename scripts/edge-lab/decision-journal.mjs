#!/usr/bin/env node
// A reviewable service-role command; default execution never contacts a server.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const scopes=new Set(['FULL_GAME','FIRST_HALF','SECOND_HALF','FIRST_QUARTER','SECOND_QUARTER','THIRD_QUARTER','FOURTH_QUARTER','UNKNOWN']);
const decisions=new Set(['BUY','AVOID','PASS','WATCH','REVERSED','PLACED','SELECT_RESEARCH','SELECT_RESEARCH_PRICE_CONDITIONAL','RETAIN','REPORTED_SELECTION']);
const kinds=new Set(['evaluation','recommendation','documented_ticket']);
const provenances=new Set(['system','conversation','documented_ticket','historical_backfill']);
const props=new Set(['points','rebounds','assists','threes','points_assists','points_rebounds','rebounds_assists','points_rebounds_assists','pra','rushing_yards','receiving_yards','passing_yards','receptions','passing_attempts','rushing_attempts']);
const teams=new Set(['moneyline','spread','total']);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const required=(value,name)=>{if(typeof value!=='string'||!value.trim())throw Error(name+'_REQUIRED');return value.trim();};
function timestamp(value,name,optional=false) {
  if(value===null||value===undefined) {if(optional)return null;throw Error(name+'_REQUIRED');}
  const match=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/);
  if(!match||!Number.isFinite(Date.parse(value)))throw Error('INVALID_'+name);
  const [,year,month,day,hour,minute,second,fraction]=match;
  const y=Number(year),m=Number(month),d=Number(day),leap=y%4===0&&(y%100!==0||y%400===0);
  if(y<1||m<1||m>12||d<1||d>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1]||Number(hour)>23||Number(minute)>59||Number(second)>59)throw Error('INVALID_'+name);
  const base=value.replace(/\.\d+(?=Z|[+-])/,'');
  const precision=(fraction??'').replace(/0+$/,'').padEnd(3,'0');
  return new Date(base).toISOString().replace('.000Z','.'+precision+'Z');
}
function numeric(value,name,optional=false) {
  if(value===null||value===undefined) {if(optional)return null;throw Error(name+'_REQUIRED');}
  if(typeof value!=='number'||!Number.isFinite(value))throw Error('INVALID_'+name);
  return value;
}
function jsonInput(value) {
  if(!object(value)||Buffer.byteLength(JSON.stringify(value))>65536)throw Error('INVALID_INPUT_OBJECT');
  return structuredClone(value);
}
export function normalizeJournalDecision(input) {
  const p=jsonInput(input);
  for(const field of ['source','sourceReference','sport','marketType','marketScope','decision','provenance'])p[field]=required(p[field],field);
  p.sport=p.sport.toUpperCase();p.marketType=p.marketType.toLowerCase();p.decision=p.decision.toUpperCase();
  p.recordKind=p.recordKind??'recommendation';
  if(!scopes.has(p.marketScope)||!decisions.has(p.decision)||!provenances.has(p.provenance)||!kinds.has(p.recordKind))throw Error('UNSUPPORTED_DECISION_METADATA');
  p.issuedAt=timestamp(p.issuedAt,'ISSUED_AT',true);p.startsAt=timestamp(p.startsAt,'STARTS_AT',true);
  p.line=numeric(p.line,'LINE',true);p.odds=numeric(p.odds,'ODDS',true);p.modelProbability=numeric(p.modelProbability,'MODEL_PROBABILITY',true);
  if(p.odds!==null&&(!Number.isInteger(p.odds)||Math.abs(p.odds)<100))throw Error('INVALID_ODDS');
  if(p.modelProbability!==null&&(p.modelProbability<0||p.modelProbability>1))throw Error('INVALID_MODEL_PROBABILITY');
  if(p.side!=null){p.side=required(p.side,'SIDE').toUpperCase();p.side=({MORE:'OVER',LESS:'UNDER'})[p.side]??p.side;}
  if(!object(p.evidence)||!Object.keys(p.evidence).length)throw Error('DECISION_PROVENANCE_REQUIRED');
  p.context=p.context??{};if(!object(p.context))throw Error('INVALID_CONTEXT');
  if(p.isDocumentedWager!==undefined&&typeof p.isDocumentedWager!=='boolean')throw Error('INVALID_WAGER_FLAG');
  p.isDocumentedWager=p.isDocumentedWager??false;
  if(p.isDocumentedWager&&(p.provenance!=='documented_ticket'||p.recordKind!=='documented_ticket'||!p.evidence.ticketReference))throw Error('DOCUMENTED_TICKET_REQUIRED');
  return p;
}
export function normalizeOfficialResult(input,sourceBytes) {
  const p=jsonInput(input);
  if(!sourceBytes?.length)throw Error('SOURCE_CAPTURE_REQUIRED');
  const hash=createHash('sha256').update(sourceBytes).digest('hex');
  if(p.sourceSha256!==hash)throw Error('SOURCE_CAPTURE_HASH_MISMATCH');
  if(!['ORIGIN_RESPONSE_BYTES','SEARCH_SERVICE_EXTRACTED_OFFICIAL_PAGE'].includes(p.sourceCaptureFormat))throw Error('SOURCE_CAPTURE_FORMAT_REQUIRED');
  for(const name of ['sport','eventId','marketType','marketScope','officialEventId','sourceUrl','verifiedBy'])p[name]=required(p[name],name);
  p.sport=p.sport.toUpperCase();p.marketType=p.marketType.toLowerCase();
  p.startsAt=timestamp(p.startsAt,'STARTS_AT');p.retrievedAt=timestamp(p.retrievedAt,'RETRIEVED_AT');
  if(p.status!=='FINAL'||!scopes.has(p.marketScope)||p.marketScope==='UNKNOWN')throw Error('REVIEWED_FINAL_RESULT_REQUIRED');
  if(Date.parse(p.retrievedAt)<Date.parse(p.startsAt)||Date.parse(p.retrievedAt)>Date.now()||Date.parse(p.startsAt)>=Date.now())throw Error('INVALID_RESULT_RETRIEVAL_TIME');
  const url=new URL(p.sourceUrl),domain={NBA:'nba.com',NFL:'nfl.com',NHL:'nhl.com',MLB:'mlb.com'}[p.sport];
  if(url.protocol!=='https:'||url.username||url.password||url.port||!domain||!(url.hostname===domain||url.hostname.endsWith('.'+domain)))throw Error('OFFICIAL_SOURCE_URL_REQUIRED');
  if(teams.has(p.marketType)) {
    if(p.playerId!=null||p.officialPlayerId!=null||p.actualValue!=null||p.participation!=='NOT_APPLICABLE')throw Error('INVALID_TEAM_RESULT');
    for(const k of ['awayScore','homeScore'])if(!Number.isInteger(p[k])||p[k]<0)throw Error('INVALID_TEAM_SCORE');
  } else if(props.has(p.marketType)) {
    p.playerId=required(p.playerId,'PLAYER_ID');p.officialPlayerId=required(p.officialPlayerId,'OFFICIAL_PLAYER_ID');
    p.actualValue=numeric(p.actualValue,'ACTUAL_VALUE');
    if(p.participation!=='PLAYED'||p.awayScore!=null||p.homeScore!=null)throw Error('INVALID_PLAYER_RESULT');
    if(!Number.isInteger(p.actualValue)||(p.actualValue<0&&(p.sport==='NBA'||!['rushing_yards','receiving_yards','passing_yards'].includes(p.marketType))))throw Error('INVALID_COUNT_STATISTIC');
  } else throw Error('UNSUPPORTED_RESULT_MARKET');
  const evidence=p.identityEvidence;
  if(!object(evidence)||typeof evidence.reference!=='string'||!evidence.reference.trim())throw Error('EXACT_OFFICIAL_IDENTITY_REVIEW_REQUIRED');
  for(const k of ['eventId','playerId','officialEventId','officialPlayerId','marketType','marketScope','sourceSha256','sourceCaptureFormat']) {
    if((evidence[k]??null)!==(p[k]??null))throw Error('OFFICIAL_IDENTITY_EVIDENCE_MISMATCH');
  }
  if(timestamp(evidence.startsAt,'EVIDENCE_STARTS_AT')!==p.startsAt)throw Error('OFFICIAL_IDENTITY_EVIDENCE_MISMATCH');
  if(p.supersedesResultId!=null&&(!Number.isSafeInteger(p.supersedesResultId)||p.supersedesResultId<1))throw Error('INVALID_PREVIOUS_RESULT_ID');
  return p;
}
export function buildJournalOperation({action,input,sourceBytes,resultId,limit=1000,from,to,recordKind=null}) {
  if(action==='record')return {rpc:'record_edge_decision_v1',args:{p_decision:normalizeJournalDecision(input)}};
  if(action==='result')return {rpc:'record_edge_official_result_v1',args:{p_result:normalizeOfficialResult(input,sourceBytes)}};
  if(action==='grade') {
    if(!Number.isSafeInteger(resultId)||resultId<1)throw Error('INVALID_RESULT_ID');
    if(!Number.isInteger(limit)||limit<1||limit>2000)throw Error('GRADE_BATCH_LIMIT_1_TO_2000');
    return {rpc:'grade_edge_journal_result_v1',args:{p_result_id:resultId,p_limit:limit}};
  }
  if(action==='scorecard') {
    from=timestamp(from,'FROM');to=timestamp(to,'TO');
    if(Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>31*86400000)throw Error('SCORECARD_WINDOW_MAX_31_DAYS');
    if(recordKind!==null&&!kinds.has(recordKind))throw Error('INVALID_RECORD_KIND');
    return {rpc:'edge_journal_scorecard_v2',args:{p_from:from,p_to:to,p_record_kind:recordKind}};
  }
  throw Error('SUPPORTED_ACTIONS: record, result, grade, scorecard');
}
export async function runJournalOperation(options,{fetchImpl=globalThis.fetch,env=process.env}={}) {
  const plan=buildJournalOperation(options);
  if(options.apply!==true)return {dryRun:true,...plan};
  const base=env.SUPABASE_URL,key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key)throw Error('SERVICE_CONFIG_REQUIRED');
  const url=new URL(base);
  if(url.protocol!=='https:'||!url.hostname.match(/^[a-z0-9]+\.supabase\.co$/)||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw Error('INVALID_SERVICE_URL');
  const headers={'content-type':'application/json',apikey:key};
  if(!key.startsWith('sb_secret_'))headers.authorization='Bearer '+key;
  const response=await fetchImpl(new URL('/rest/v1/rpc/'+plan.rpc,url),{
    method:'POST',headers,
    body:JSON.stringify(plan.args),signal:AbortSignal.timeout(30000)
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw Error('JOURNAL_RPC_FAILED:'+response.status+':'+String(result?.message??'NO_ERROR_MESSAGE').slice(0,500));
  return {dryRun:false,rpc:plan.rpc,result};
}
async function main(argv) {
  const [action,...args]=argv,options={action};
  const flags=new Map();
  for(let i=0;i<args.length;i++) {
    const flag=args[i];
    if(flag==='--apply'){options.apply=true;continue;}
    if(!['--input','--source-file','--result-id','--limit','--from','--to','--record-kind'].includes(flag)||!args[i+1]||args[i+1].startsWith('--')||flags.has(flag))throw Error('INVALID_ARGUMENT:'+flag);
    flags.set(flag,args[++i]);
  }
  if(flags.has('--input'))options.input=JSON.parse(readFileSync(flags.get('--input'),'utf8'));
  if(flags.has('--source-file'))options.sourceBytes=readFileSync(flags.get('--source-file'));
  for(const [flag,name] of [['--result-id','resultId'],['--limit','limit']])if(flags.has(flag))options[name]=Number(flags.get(flag));
  for(const [flag,name] of [['--from','from'],['--to','to'],['--record-kind','recordKind']])if(flags.has(flag))options[name]=flags.get(flag);
  process.stdout.write(JSON.stringify(await runJournalOperation(options),null,2)+'\n');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main(process.argv.slice(2)).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
