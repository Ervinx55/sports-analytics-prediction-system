import {normalizePrediction} from './performance-contract.mjs';
import {adaptLegacyObservation,MLB_TABLES} from './performance-mlb-adapter.mjs';

const number=v=>(typeof v==='number'||typeof v==='string'&&v.trim())&&Number.isFinite(Number(v))?Number(v):null;
const text=v=>typeof v==='string'&&v.trim()?v.trim():null;
const time=v=>text(v)&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
export const MODEL_TTL_MS=5*60*1000;
export function adaptModelResponse(body,{sport,kind,capturedAt,sourceRequestId}={}) {
 const diagnostics=[];
 const coverage={sport,kind,modelAvailable:false,dataAvailable:false,complete:false,responseComplete:false,dataSourceComplete:null,state:'UNAVAILABLE',received:0,adapted:0,productionWeight:0};
 const result={predictions:[],diagnostics,coverage};
 const reject=(reason,index=null)=>diagnostics.push({reason,index});
 if(sport==='NBA'||sport==='CFB'){reject('MODEL_SOURCE_UNAVAILABLE');return result;}
 if(!body||typeof body!=='object'||Array.isArray(body)){coverage.state='ERROR';reject('MALFORMED_MODEL_RESPONSE');return result;}
 if(sport==='MLB') {
  if(!MLB_TABLES.includes(kind)||!Array.isArray(body.rows)){reject('INVALID_MLB_OBSERVATION_PAGE');return result;}
  coverage.modelAvailable=true;coverage.dataAvailable=true;coverage.received=body.rows.length;
  for(const [index,row] of body.rows.entries())try{result.predictions.push(adaptLegacyObservation(row,kind));}catch{reject('INVALID_MLB_OBSERVATION',index);}
  coverage.adapted=result.predictions.length;coverage.responseComplete=diagnostics.length===0;coverage.dataSourceComplete=body.complete===true;coverage.complete=coverage.dataSourceComplete&&coverage.responseComplete;coverage.state=diagnostics.length||!coverage.complete?'PARTIAL':body.rows.length?'COMPLETE':'EMPTY';return result;
 }
 if(sport!=='NFL'||!['team','props'].includes(kind)||body.league!=='NFL'||!['NFL','FOOTBALL'].includes(body.sport)){reject('UNSUPPORTED_MODEL_SOURCE');return result;}
 const rows=kind==='props'?body.candidates:body.markets;
 if(!Array.isArray(rows)){coverage.state='ERROR';reject('MISSING_MODEL_ROWS');return result;}
 coverage.modelAvailable=true;coverage.received=rows.length;coverage.dataAvailable=rows.length>0;
 // The envelope generatedAt is deliberately not a forecast timestamp fallback.
 const forecastAt=time(body.forecastAt),receivedAt=time(capturedAt);
 if(!forecastAt){reject('MISSING_FORECAST_TIME');return result;}
 if(!receivedAt||Date.parse(forecastAt)>Date.parse(receivedAt)){reject('INVALID_FORECAST_TIME');return result;}
 if(Date.parse(receivedAt)-Date.parse(forecastAt)>MODEL_TTL_MS){reject('STALE_FORECAST');return result;}
 const props=kind==='props';
 for(const [index,row] of rows.entries()) {
  const event=text(row?.eventID),market=props?text(row?.statID):text(row?.marketType),side=text(row?.side),version=text(body.version);
  const probability=number(props?row?.shadowModelProbability:row?.modelProbability);
  if(!event||!market||!side||!version||probability===null){reject('INVALID_MODEL_ROW',index);continue;}
  const reasons=[],canonicalEvent=text(row.canonicalEventID),canonicalPlayer=text(row.canonicalPlayerID);
  if(Date.parse(receivedAt)>=Date.parse(row.originalStartsAt??row.startsAt))reasons.push('POST_START_RECEIPT');
  if(!canonicalEvent)reasons.push('MISSING_CANONICAL_EVENT_MAPPING');
  if(props&&!canonicalPlayer)reasons.push('MISSING_CANONICAL_PLAYER_MAPPING');
  const independentWeight=number(row.effectiveIndependentWeight);
  const forecastClass=independentWeight===0?'MARKET_ONLY':independentWeight!==null&&independentWeight===1?'INDEPENDENT':independentWeight!==null?'MARKET_ANCHORED':props?'UNKNOWN':market==='total'?'MARKET_ANCHORED':'MARKET_ONLY';
  if(forecastClass!=='INDEPENDENT')reasons.push('NON_INDEPENDENT_MODEL');
  const identity=[event,props?text(row.playerID):null,market,side,number(row.line),props?text(row.book):text(row.bestBook),version,forecastAt];
  const p=normalizePrediction({sourceKey:`nfl:${kind}:${JSON.stringify(identity)}`,sport:'NFL',eventKey:canonicalEvent?`nfl:${canonicalEvent}`:`nfl-provider:${event}`,playerKey:props?(canonicalPlayer?`nfl:${canonicalPlayer}`:null):null,
   marketType:props?`player_${market}`:market,side,line:row.line,modelVersion:version,modelMode:'SHADOW',modelAvailable:true,capturedAt:forecastAt,startsAt:row.startsAt,eligibilityStartsAt:row.originalStartsAt??row.startsAt,
   quoteAt:props?row.updatedAt:row.quoteAt,odds:props?row.odds:row.bestOdds,book:props?row.book:row.bestBook,modelProbability:probability,marketProbability:row.marketFairProbability,pushProbability:row.pushProbability,
   probabilityBasis:row.probabilityBasis??null,settlementRule:row.settlementRule??null,eligibilityReasons:reasons,
   sourceIds:{provider:body.oddsProvider??'nfl-model-provider',event,player:props?text(row.playerID):null,canonicalEvent,canonicalPlayer},
   provenance:{forecastAt,forecastClass,independentModel:forecastClass==='INDEPENDENT',rawIndependentProbability:number(row.rawIndependentProbability),effectiveIndependentWeight:number(row.effectiveIndependentWeight),marketShrinkage:number(row.marketShrinkage),productionWeight:0,productionEligible:false,qualified:false,originalShadowStatus:row.shadowStatus??null,sourceHealth:structuredClone(body.sourceHealth??null),providerCache:structuredClone(body.boardProviderCache??null),raw:structuredClone(row)}
  },{now:receivedAt});
  result.predictions.push(p);
 }
 const health=body.sourceHealth??{};
 if(health.provider?.servedStale===true||body.boardProviderCache?.servedStale===true)reject('STALE_PROVIDER_DATA');
 if(Array.isArray(body.providerFailures)&&body.providerFailures.length)reject('PROVIDER_FALLBACK');
 coverage.adapted=result.predictions.length;coverage.responseComplete=diagnostics.length===0&&body.complete!==false&&!body.nextCursor&&!body.nextPage;
 coverage.dataSourceComplete=body.dataSourceComplete===true?true:body.dataSourceComplete===false?false:null;
 coverage.complete=coverage.responseComplete&&coverage.dataSourceComplete===true;
 coverage.state=!rows.length&&coverage.responseComplete?'EMPTY':coverage.complete?'COMPLETE':'PARTIAL';
 if(!coverage.responseComplete&&!diagnostics.length)reject('INCOMPLETE_PROVIDER_PAGE');
 if(coverage.dataSourceComplete===null)reject('UPSTREAM_COVERAGE_UNKNOWN');
 return result;
}

/** Two attempts maximum; never expose provider bodies, URLs or credentials in errors. */
export async function fetchModelResponse(url,{fetchImpl=fetch,timeoutMs=10000}={}) {
 for(let attempts=1;attempts<=2;attempts++) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
   const response=await fetchImpl(url,{signal:controller.signal,headers:{accept:'application/json'},cache:'no-store'});
   if(!response.ok){if([429,500,502,503,504].includes(response.status)&&attempts===1)continue;return {ok:false,complete:false,error:`PROVIDER_HTTP_${response.status}`,attempts};}
   const raw=await response.text();
   if(raw.length>4*1024*1024)return {ok:false,complete:false,error:'PROVIDER_RESPONSE_TOO_LARGE',attempts};
   try{return {ok:true,body:JSON.parse(raw),attempts};}catch{return {ok:false,complete:false,error:'MALFORMED_JSON',attempts};}
  }catch{if(attempts===2)return {ok:false,complete:false,error:controller.signal.aborted?'PROVIDER_TIMEOUT':'PROVIDER_UNAVAILABLE',attempts};}
  finally{clearTimeout(timer);}
 }
}
