import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptNbaTeamResponse} from '../../supabase/functions/_shared/performance-nba-adapter.mjs';
const now='2026-10-29T12:00:00Z';
const body={league:'NBA',sport:'BASKETBALL',version:'nba-shadow',forecastAt:now,markets:[{eventID:'provider:event',startsAt:'2026-10-30T00:00:00Z',marketType:'moneyline',side:'home',book:'book',odds:110,updatedAt:now,modelProbability:.55,marketFairProbability:.48,rawIndependentProbability:.6,productionEligible:false,productionWeight:0}]};
test('NBA forecasts are captured as excluded shadow diagnostics, never qualified plays',()=>{
 const r=adaptNbaTeamResponse(body,{capturedAt:now});assert.equal(r.predictions.length,1);const p=r.predictions[0];assert.equal(p.modelMode,'SHADOW');assert.equal(p.provenance.productionWeight,0);assert.ok(p.eligibilityReasons.includes('EXACT_RESULT_MAPPING_UNAVAILABLE'));assert.ok(p.eligibilityReasons.includes('MISSING_SETTLEMENT_RULE'));assert.equal(p.modelProbability,.55);assert.equal(p.quoteAt,new Date(now).toISOString());
});
test('NBA rejects stale or malformed forecasts and does not invent probabilities',()=>{
 assert.equal(adaptNbaTeamResponse(body,{capturedAt:'2026-10-29T12:06:00Z'}).predictions.length,0);
 assert.equal(adaptNbaTeamResponse({...body,markets:[{...body.markets[0],modelProbability:null}]},{capturedAt:now}).predictions.length,0);
 assert.equal(adaptNbaTeamResponse({...body,league:'NFL'},{capturedAt:now}).predictions.length,0);
});
