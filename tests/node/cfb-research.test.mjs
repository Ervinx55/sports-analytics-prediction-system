import test from 'node:test';import assert from 'node:assert/strict';
import {attachCfbForecasts,currentCfbForecasts} from '../../sharp-service/cfb-research.js';
import {refreshResearchRow} from '../../sharp-service/research-data.js';
const now=Date.parse('2026-11-14T16:00:00Z'),stamp=new Date(now).toISOString(),startsAt='2026-11-14T17:00:00Z';
const row={kind:'games',league:'NCAAF',eventID:'game',homeID:'H',awayID:'A',participant:'H',side:'HOME',marketType:'moneyline',period:'game',startsAt,provider:'SportsGameOdds',model:null,productionEligible:false};
const f={eventID:'game',homeID:'H',awayID:'A',startsAt,homeProbability:.6,awayProbability:.4,modelVersion:'v1',inputCutoff:stamp,generatedAt:stamp,productionEligible:false,marketType:'moneyline',period:'game'};
const payload={contract:'cfb-research-v1',status:'RESEARCH_NOT_CLEARED',modelVersion:'v1',generatedAt:stamp,forecasts:[f]};
test('CFB verified research remains visible without agreeing quotes, but cannot attach to conflicting prices',()=>{
 const p={...payload,forecasts:[{...f,quoteComparisonEligible:false,providerStartsAt:'2026-11-14T16:00Z'}]};
 assert.equal(currentCfbForecasts(p,now).length,1);
 assert.equal(attachCfbForecasts([row],p,now)[0].model,null);
 assert.deepEqual(currentCfbForecasts(p,now+1800001),[]);
 assert.deepEqual(currentCfbForecasts({...p,forecasts:[p.forecasts[0],p.forecasts[0]]},now),[]);
});
test('CFB attaches only the exact independent moneyline forecast without clearing a play',()=>{
 const result=attachCfbForecasts([row],payload,now)[0];assert.equal(result.model,.6);assert.equal(result.productionEligible,false);assert.equal(result.status,'RESEARCH');
 for(const patch of [{awayID:'other'},{side:'OVER'},{marketType:'spread'},{period:'reg'},{startsAt:'2026-11-14T18:00:00Z'},{provider:'SharpAPI'}])assert.equal(attachCfbForecasts([{...row,...patch}],payload,now)[0].model,null);
});
test('CFB withholds stale, future, duplicate, invalid and wrong-version forecasts',()=>{
 for(const p of [{...payload,generatedAt:new Date(now-1800001).toISOString()},{...payload,generatedAt:new Date(now+1).toISOString()},{...payload,forecasts:[f,f]},{...payload,forecasts:[{...f,modelVersion:'wrong'}]},{...payload,forecasts:[{...f,homeProbability:1.2}]},{...payload,forecasts:[{...f,inputCutoff:new Date(now+1).toISOString()}]}])assert.equal(attachCfbForecasts([row],p,now)[0].model,null);
});
test('CFB model expires on an open board even without another API response',()=>{
 const attached=attachCfbForecasts([row],payload,now)[0];assert.equal(refreshResearchRow(attached,now+1800001).model,null);
});
