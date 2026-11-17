import {captureNflPrices} from './price-capture-lib.mjs';

export const NFL_PRICE_URL='https://sports-analytics-prediction-system-tau.vercel.app/api/nflprops?books=draftkings,fanduel,betmgm,caesars,bovada,pinnacle&limit=20';
const MAX_BYTES=5*1024*1024;
const TABLES=new Set(['nfl_price_observations_v1','nfl_price_responses_v1','nfl_price_collection_runs_v1']);
const safeError=error=>/^(NFL_SOURCE_(?:HTTP_\d{3}|TOO_LARGE|INVALID_JSON|TIMEOUT|FETCH_FAILED|EMPTY_BODY|TOO_MANY_RECORDS)|DATABASE_(?:HTTP_\d{3}|FETCH_FAILED|INVALID_RESULT|CONFIGURATION|TABLE_NOT_ALLOWED))$/.test(error?.message??'')?error.message:'NFL_COLLECTION_FAILED';
const iso=clock=>{const at=clock();if(typeof at!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(at)||!Number.isFinite(Date.parse(at)))throw Error('INVALID_CLOCK');return at;};
const digest=async(value,cryptoImpl)=>Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))).map(b=>b.toString(16).padStart(2,'0')).join('');

async function fetchSource(fetchImpl){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try{
  const response=await fetchImpl(NFL_PRICE_URL,{headers:{accept:'application/json'},signal:controller.signal,redirect:'error'});
  if(!response.ok)throw Error('NFL_SOURCE_HTTP_'+response.status);
  const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>MAX_BYTES)throw Error('NFL_SOURCE_TOO_LARGE');
  const reader=response.body?.getReader();if(!reader)throw Error('NFL_SOURCE_EMPTY_BODY');
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error('NFL_SOURCE_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let rawText,body;try{rawText=new TextDecoder('utf-8',{fatal:true}).decode(bytes);body=JSON.parse(rawText);}catch{throw Error('NFL_SOURCE_INVALID_JSON');}
  return {bytes,rawText,body};
 }catch(error){if(controller.signal.aborted)throw Error('NFL_SOURCE_TIMEOUT');if(/^NFL_SOURCE_/.test(error?.message??''))throw error;throw Error('NFL_SOURCE_FETCH_FAILED');}finally{clearTimeout(timer);}
}

/** Only INSERT-on-conflict-DO-NOTHING is available; existing rows are never updated. */
export function createRestPriceStore({url,authorization,fetchImpl=fetch}){
 let base;try{base=new URL(url);}catch{throw Error('DATABASE_CONFIGURATION');}
 if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||base.port||base.search||base.hash||base.pathname!=='/'||!/^Bearer [A-Za-z0-9._-]+$/.test(authorization??''))throw Error('DATABASE_CONFIGURATION');
 const key=authorization.slice(7);
 return {async append(table,rows){
  if(!TABLES.has(table))throw Error('DATABASE_TABLE_NOT_ALLOWED');if(!Array.isArray(rows)||rows.length>200)throw Error('DATABASE_INVALID_RESULT');if(!rows.length)return 0;
  let response;try{response=await fetchImpl(base.origin+'/rest/v1/'+table+'?on_conflict=id&select=id',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authorization,apikey:key,Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(rows),signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw Error('DATABASE_FETCH_FAILED');}
  if(!response.ok)throw Error('DATABASE_HTTP_'+response.status);
  let inserted;try{inserted=await response.json();}catch{throw Error('DATABASE_INVALID_RESULT');}
  const requested=new Set(rows.map(row=>row.id));if(!Array.isArray(inserted)||inserted.length>rows.length||inserted.some(row=>typeof row?.id!=='string'||!requested.has(row.id))||new Set(inserted.map(row=>row.id)).size!==inserted.length)throw Error('DATABASE_INVALID_RESULT');return inserted.length;
 }};
}

/** Captures current price evidence only. No model or outcome table is writable here. */
export async function runNflPriceCollector({fetchImpl=fetch,clock=()=>new Date().toISOString(),store,cryptoImpl=globalThis.crypto}){
 const runId=cryptoImpl.randomUUID(),startedAt=iso(clock);let inserted=0,records=0,receivedAt=null,rawResponseSha256=null,rejected={};
 try{
  const source=await fetchSource(fetchImpl);receivedAt=iso(clock);
  rawResponseSha256=await digest(source.bytes,cryptoImpl);
  const capture=captureNflPrices(source.body,{receivedAt});records=capture.records.length;rejected=capture.rejected;
  if(records>5000)throw Error('NFL_SOURCE_TOO_MANY_RECORDS');
  await store.append('nfl_price_responses_v1',[{id:rawResponseSha256,payload:{sourceUrl:NFL_PRICE_URL,sha256:rawResponseSha256,rawText:source.rawText},received_at:receivedAt}]);
  const rows=await Promise.all(capture.records.map(async row=>({id:await digest(row.identity,cryptoImpl),payload:{...row,sourceHash:rawResponseSha256}})));
  for(let i=0;i<rows.length;i+=200)inserted+=await store.append('nfl_price_observations_v1',rows.slice(i,i+200));
  const report={ok:true,runId,startedAt,receivedAt,completedAt:iso(clock),sourceUrl:NFL_PRICE_URL,rawResponseSha256,records,inserted,rejected,productionEligible:false,productionWeight:0};
  await store.append('nfl_price_collection_runs_v1',[{id:runId,payload:report}]);return report;
 }catch(error){
  const report={ok:false,runId,startedAt,receivedAt,error:safeError(error),rawResponseSha256,records,inserted,rejected,productionEligible:false,productionWeight:0};
  try{await store.append('nfl_price_collection_runs_v1',[{id:runId,payload:report}]);}catch{}
  return report;
 }
}
