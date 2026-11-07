import {normalizePrediction} from './performance-contract.mjs';
const timestamp=v=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const probability=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
/** Preserve live NBA forecasts for research without inventing settlement or identity evidence. */
export function adaptNbaTeamResponse(body,{capturedAt=new Date().toISOString()}={}){
 const predictions=[],diagnostics=[],coverage={sport:'NBA',kind:'team',modelAvailable:false,dataAvailable:false,complete:false,state:'UNAVAILABLE',productionWeight:0,received:0,adapted:0};
 const result={predictions,diagnostics,coverage};
 if(body?.league!=='NBA'||body?.sport!=='BASKETBALL'||typeof body.version!=='string'||!Array.isArray(body.markets)||body.markets.length>2000){diagnostics.push({reason:'INVALID_NBA_RESPONSE'});return result;}
 if(!timestamp(body.forecastAt)||!timestamp(capturedAt)||Date.parse(body.forecastAt)>Date.parse(capturedAt)||Date.parse(capturedAt)-Date.parse(body.forecastAt)>300000){diagnostics.push({reason:'INVALID_OR_STALE_FORECAST'});return result;}
 coverage.modelAvailable=true;coverage.received=body.markets.length;
 for(const [index,row] of body.markets.entries()){
  if(typeof row?.eventID!=='string'||!row.eventID||!['moneyline','spread','total'].includes(row.marketType)||!['home','away','over','under'].includes(row.side)||!probability(row.modelProbability)||!probability(row.marketFairProbability)){diagnostics.push({reason:'INVALID_NBA_MARKET',index});continue;}
  predictions.push(normalizePrediction({sourceKey:'nba:team:'+JSON.stringify([row.eventID,row.marketType,row.side,row.line??null,row.book??null,body.version,body.forecastAt]),sport:'NBA',eventKey:'nba-provider:'+row.eventID,marketType:row.marketType,side:row.side,line:row.line??null,modelVersion:body.version,modelMode:'SHADOW',modelAvailable:true,capturedAt:body.forecastAt,startsAt:row.startsAt,quoteAt:row.updatedAt??null,odds:row.odds,book:row.book,modelProbability:row.modelProbability,marketProbability:row.marketFairProbability,pushProbability:row.pushProbability??null,probabilityBasis:row.probabilityBasis??null,settlementRule:row.settlementRule??null,eligibilityReasons:['EXACT_RESULT_MAPPING_UNAVAILABLE','NON_INDEPENDENT_MODEL'],sourceIds:{provider:'nba-model-board',event:row.eventID},provenance:{source:'NBA team model',forecastAt:body.forecastAt,receivedAt:capturedAt,productionWeight:0,productionEligible:false,qualified:false,rawIndependentProbability:row.rawIndependentProbability??null,raw:structuredClone(row)}},{now:capturedAt}));
 }
 coverage.adapted=predictions.length;coverage.dataAvailable=predictions.length>0;coverage.state=predictions.length?'DIAGNOSTIC_ONLY':'EMPTY';
 return result;
}
