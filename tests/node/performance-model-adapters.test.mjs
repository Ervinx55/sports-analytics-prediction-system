import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adaptModelResponse,fetchModelResponse} from '../../supabase/functions/_shared/performance-model-adapters.mjs';
import {projectEvent,teamSnapshot,leagueBaselines} from '../../sharp-service/lib/nfl-model.js';
import {gradePropMarket} from '../../sharp-service/lib/nfl-player-props.js';
const at='2026-10-06T12:00:00Z';
const options={sport:'NFL',kind:'team',capturedAt:at,sourceRequestId:'request-1'};
const body=JSON.parse(readFileSync(new URL('../fixtures/performance/nfl-team-response.json',import.meta.url),'utf8'));
test('NFL canonicalizes FOOTBALL, retains exact quote identity and shadow-only market forecast',()=>{
 const r=adaptModelResponse(body,options),p=r.predictions[0];
 assert.equal(p.sport,'NFL');assert.equal(p.modelMode,'SHADOW');assert.equal(p.provenance.productionWeight,0);assert.equal(p.provenance.qualified,false);assert.equal(p.provenance.originalShadowStatus,'PLAY');assert.equal(p.provenance.forecastClass,'MARKET_ONLY');assert.equal(p.provenance.independentModel,false);assert.equal(p.quoteAt,new Date(at).toISOString());assert.equal(p.sourceIds.event,'event');
 assert.ok(p.eligibilityReasons.includes('MISSING_CANONICAL_EVENT_MAPPING'));assert.equal(r.coverage.modelAvailable,true);
 const provider=adaptModelResponse({...body,oddsProvider:'SportsGameOdds',boardProviderCache:{status:'HIT'}},options).predictions[0];assert.equal(provider.sourceIds.provider,'SportsGameOdds');assert.equal(provider.provenance.providerCache.status,'HIT');
});
test('stable source forecast identity ignores request retries and preserves source time',()=>{
 const first=adaptModelResponse(body,options).predictions[0];
 const retry=adaptModelResponse(body,{...options,sourceRequestId:'another',capturedAt:'2026-10-06T12:01:00Z'}).predictions[0];
 assert.equal(first.sourceKey,retry.sourceKey);assert.equal(first.capturedAt,retry.capturedAt);assert.equal(first.provenance.forecastAt,new Date(at).toISOString());
});
test('fresh response envelope cannot mask stale or absent source forecast time',()=>{
 for(const forecastAt of ['2026-10-06T11:00:00Z',null]) {
 const r=adaptModelResponse({...body,forecastAt},options);assert.equal(r.predictions.length,0);assert.equal(r.coverage.complete,false);assert.ok(r.diagnostics.some(d=>['STALE_FORECAST','MISSING_FORECAST_TIME'].includes(d.reason)));
 }
});
test('NBA and CFB never invent forecasts from schedules or sportsbook data',()=>{
 for(const sport of ['NBA','CFB']){const r=adaptModelResponse({events:[{id:1}],markets:body.markets},{...options,sport});assert.equal(r.predictions.length,0);assert.equal(r.coverage.modelAvailable,false);}
});
test('props retain raw independent probability, quote time and missing canonical player exclusion',()=>{
 const r=adaptModelResponse({...body,version:'props',candidates:[{eventID:'e',playerID:'provider-player',statID:'passing_yards',startsAt:'2026-10-06T14:00:00Z',side:'over',line:250.5,odds:-110,book:'book',updatedAt:at,rawIndependentProbability:.65,shadowModelProbability:.55,marketFairProbability:.5,pushProbability:0,effectiveIndependentWeight:.25,marketShrinkage:.75,shadowStatus:'PLAY'}]},{...options,kind:'props'});
 const p=r.predictions[0];assert.equal(p.line,250.5);assert.equal(p.provenance.rawIndependentProbability,.65);assert.equal(p.modelProbability,.55);assert.equal(p.provenance.forecastClass,'MARKET_ANCHORED');assert.ok(p.eligibilityReasons.includes('MISSING_CANONICAL_PLAYER_MAPPING'));
});
test('invalid rows and empty responses have explicit coverage',()=>{
 assert.equal(adaptModelResponse({...body,markets:[]},options).coverage.state,'EMPTY');
 assert.equal(adaptModelResponse({...body,markets:[{}]},options).coverage.complete,false);
 assert.equal(adaptModelResponse('<html>',options).coverage.state,'ERROR');
});
test('bounded model response cannot certify upstream league pagination',()=>{
 const r=adaptModelResponse(body,options);assert.equal(r.coverage.responseComplete,true);assert.equal(r.coverage.dataSourceComplete,null);assert.equal(r.coverage.complete,false);
 const full=adaptModelResponse({...body,dataSourceComplete:true},options);assert.equal(full.coverage.complete,true);
 const missingPage=adaptModelResponse({...body,dataSourceComplete:true,nextCursor:'page2'},options);assert.equal(missingPage.coverage.complete,false);
});
test('provider failures are bounded and do not claim complete coverage',async()=>{
 for(const status of [429,500]){let n=0;const r=await fetchModelResponse('https://fixture',{fetchImpl:async()=>{n++;return new Response('sensitive provider text',{status});}});assert.equal(n,2);assert.equal(r.ok,false);assert.equal(r.complete,false);assert.equal(r.error,`PROVIDER_HTTP_${status}`);}
 for(const value of ['<html>','not json']){let n=0;const r=await fetchModelResponse('https://fixture',{fetchImpl:async()=>{n++;return new Response(value);}});assert.equal(n,1);assert.equal(r.error,'MALFORMED_JSON');}
 const timeout=await fetchModelResponse('https://fixture',{timeoutMs:5,fetchImpl:(_u,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('abort'))))});assert.equal(timeout.error,'PROVIDER_TIMEOUT');assert.equal(timeout.attempts,2);
 const healthy=await fetchModelResponse('https://fixture',{fetchImpl:async()=>new Response(JSON.stringify(body))});assert.equal(healthy.ok,true);
});
test('team output preserves raw independent probability and chosen book quote without changing weights',()=>{
 const snapshots=new Map(['GB','MIN'].map(t=>[t,teamSnapshot([],[],2026,t)]));
 const price={odds:-110,updatedAt:at,available:true};
 const event={eventID:'provider-e',startsAt:'2026-10-06T14:00:00Z',matchup:{away:{name:'Green Bay Packers'},home:{name:'Minnesota Vikings'}},markets:{moneyline:{home:{books:{book:price}},away:{books:{book:price}}}}};
 const projection=projectEvent({event,schedule:[],stats:[],snapshots,baseline:leagueBaselines([...snapshots.values()]),season:2026,simulationIterations:10});
 const p=projection.markets[0];assert.equal(p.quoteAt,at);assert.equal(typeof p.rawIndependentProbability,'number');assert.equal(p.effectiveIndependentWeight,0);assert.equal(p.modelProbability,p.marketFairProbability);assert.equal(p.productionEligible,false);
});
test('kickoff-crossing receipt keeps source payload immutable; ledger owns first receipt eligibility',()=>{
 const source={...body,forecastAt:'2026-10-06T11:59:00Z',markets:[{...body.markets[0],startsAt:'2026-10-06T11:59:30Z'}]};
 const first=adaptModelResponse(source,{...options,capturedAt:'2026-10-06T11:59:20Z'}).predictions[0];
 const retry=adaptModelResponse(source,{...options,capturedAt:'2026-10-06T11:59:40Z'}).predictions[0];assert.deepEqual(retry,first);assert.equal(retry.eligibilityReasons.includes('POST_START_RECEIPT'),false);
});
test('provider cap counts streaming bytes and cancels before allocating full oversized response',async()=>{
 let cancelled=false,pulls=0;
 const response=new Response(new ReadableStream({pull(controller){pulls++;if(pulls>8){controller.close();return;}controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}}));
 const r=await fetchModelResponse('https://fixture',{fetchImpl:async()=>response});assert.equal(r.error,'PROVIDER_RESPONSE_TOO_LARGE');assert.equal(cancelled,true);assert.ok(pulls<=6);
 const unicode='"'+'é'.repeat(3*1024*1024)+'"';let cancelledHeader=false;
 const oversized=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(unicode));},cancel(){cancelledHeader=true;}}),{headers:{'content-length':String(6*1024*1024)}});
 const header=await fetchModelResponse('https://fixture',{fetchImpl:async()=>oversized});assert.equal(header.error,'PROVIDER_RESPONSE_TOO_LARGE');assert.equal(cancelledHeader,true);
 const bytes=await fetchModelResponse('https://fixture',{fetchImpl:async()=>new Response(unicode)});assert.equal(bytes.error,'PROVIDER_RESPONSE_TOO_LARGE');
});
test('props chosen side retains its own quote timestamp',()=>{
 const underAt='2026-10-06T11:59:00Z';
 const prop={statID:'passing_yards',over:{books:{book:{odds:-110,line:250.5,available:true,updatedAt:at}}},under:{books:{book:{odds:-110,line:250.5,available:true,updatedAt:underAt}}}};
 const rows=gradePropMarket(prop,{dataQuality:'A',projections:{passing_yards:{mean:250,sd:45}}});
 assert.equal(rows.find(r=>r.side==='over').updatedAt,at);assert.equal(rows.find(r=>r.side==='under').updatedAt,underAt);
});
