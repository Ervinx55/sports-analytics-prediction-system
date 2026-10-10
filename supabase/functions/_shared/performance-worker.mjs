import {normalizeFinalResult} from './performance-result-sources.mjs';
import {settlePrediction} from './performance-settlement.mjs';
export const SETTLEMENT_SPORTS=['MLB','NFL','NBA','CFB','NHL','TENNIS','SOCCER'];
export function resultRequest(p) {
 const id=p?.sourceIds?.event;
 if(typeof id!=='string'||! /^[1-9][0-9]*$/.test(id))return null;
 if(p.sport==='MLB'&&p.sourceIds.provider==='mlb-statsapi'&&p.eventKey===`mlb:${id}`)return {source:'mlb-statsapi',url:`https://statsapi.mlb.com/api/v1.1/game/${id}/feed/live`};
 const path={NFL:'football/nfl',NBA:'basketball/nba',CFB:'football/college-football'}[p.sport];
 if(path&&p.sourceIds.provider==='espn'&&p.eventKey===`espn:${p.sport.toLowerCase()}:${id}`)return {source:'espn',url:`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${id}`};
 return null;
}
/** One bounded attempt per durable lease. Quota/cooldown responses are never bypassed. */
export async function fetchResultResponse(url,{fetchImpl=fetch,timeoutMs=12000}={}) {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try {
  const response=await fetchImpl(url,{signal:controller.signal,headers:{accept:'application/json'},cache:'no-store'});
  if(!response.ok){const retry=response.headers.get('retry-after');const seconds=retry&&/^\d+$/.test(retry)?Number(retry):retry?Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000)):0;return {ok:false,error:`PROVIDER_HTTP_${response.status}`,cooldownSeconds:Math.max(response.status===429?60:0,Number.isFinite(seconds)?Math.min(seconds,30*86400):0)};}
  const max=4*1024*1024;
  if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();return {ok:false,error:'PROVIDER_RESPONSE_TOO_LARGE'};}
  const reader=response.body?.getReader(),decoder=new TextDecoder();let raw='',bytes=0;
  if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>max){await reader.cancel();return {ok:false,error:'PROVIDER_RESPONSE_TOO_LARGE'};}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
  let body;try{body=JSON.parse(raw);}catch{return {ok:false,error:'MALFORMED_JSON'};}
  if(!body||typeof body!=='object'||Array.isArray(body))return {ok:false,error:'MALFORMED_JSON'};
  if(body.nextCursor||body.nextPage||body.complete===false)return {ok:false,error:'INCOMPLETE_PROVIDER_PAGE'};
  if(body.quotaBlocked===true||body.status==='QUOTA_EXHAUSTED'||body.cooldownUntil&&Date.parse(body.cooldownUntil)>Date.now())return {ok:false,error:'PROVIDER_COOLDOWN',cooldownSeconds:Math.max(60,Math.ceil((Date.parse(body.cooldownUntil)-Date.now())/1000)||3600)};
  return {ok:true,body};
 }catch{return {ok:false,error:controller.signal.aborted?'PROVIDER_TIMEOUT':'PROVIDER_UNAVAILABLE'};}finally{clearTimeout(timer);}
}
/** @param {{rpc:Function}} client
 * @param {{sport:string,limit?:number,fetchImpl?:typeof fetch}} options */
export async function runSettlementPage(client,{sport,limit=100,fetchImpl=fetch}) {
 const claimed=await client.rpc('claim_performance_settlements_v1',{p_sport:sport,p_limit:limit});
 if(claimed.error||!Array.isArray(claimed.data)||claimed.data.length>limit)throw Error('QUEUE_CLAIM_FAILED');
 const summary={processed:0,settled:0,unresolved:0,retries:0,cursor:null,coverage:{sport,complete:false,modelAvailable:['MLB','NFL'].includes(sport),resultAdapterAvailable:['MLB','NFL','NBA','CFB'].includes(sport),state:'PARTIAL'},faults:[]};
 // Lease each item immediately before fetching, avoiding expiration of a 100x12s sequential page.
 const responses=new Map();
 const processRow=async row=>{
  const renewed=await client.rpc('renew_performance_settlement_v1',{p_prediction:row.prediction_id,p_token:row.lease_token});
  if(renewed.error||renewed.data!==true){summary.faults.push('LEASE_LOST');return;}
  const p={...row.prediction,id:row.prediction_id},request=resultRequest(p);let settlement=null,error=null,cooldown=0;
  if(!request){settlement={predictionId:p.id,outcome:'UNRESOLVED',source:'unavailable',sourceUpdatedAt:null,sourceRevision:null,ruleVersion:p.settlementRule?.version??'unknown',reason:['NHL','TENNIS','SOCCER'].includes(sport)?'RESULT_ADAPTER_UNAVAILABLE':'EXACT_RESULT_MAPPING_UNAVAILABLE'};}
  else {
   if(!responses.has(request.url))responses.set(request.url,fetchResultResponse(request.url,{fetchImpl}).then(result=>({...result,retrievedAt:new Date().toISOString()})));
   const fetched=await responses.get(request.url);
   if(!fetched.ok){error=fetched.error;cooldown=fetched.cooldownSeconds??0;}
   else settlement=settlePrediction(p,normalizeFinalResult(fetched.body,{sport,source:request.source,retrievedAt:fetched.retrievedAt}));
  }
  const receipt=await client.rpc('complete_performance_settlement_v1',{p_prediction:p.id,p_token:row.lease_token,p_settlement:settlement,p_error:error,p_cooldown_seconds:cooldown});
  if(receipt.error||!receipt.data||receipt.data.accepted!==true){summary.faults.push('QUEUE_COMPLETION_FAILED');return;}
  summary.processed++;summary.cursor=p.id;
  if(error)summary.retries++;
  if(receipt.data.outcome==='UNRESOLVED'||error)summary.unresolved++;else summary.settled++;
 };
 // Twenty bounded fetches per wave keep a worst-case hundred-row page inside 120s leases.
 for(let offset=0;offset<claimed.data.length;offset+=20)await Promise.all(claimed.data.slice(offset,offset+20).map(processRow));
 summary.coverage.state=summary.faults.length||summary.retries?'ERROR':summary.unresolved?'UNRESOLVED':summary.processed?'SETTLED':'EMPTY';
 // This describes the claimed page only, never asserts provider or historical coverage completeness.
 return summary;
}
