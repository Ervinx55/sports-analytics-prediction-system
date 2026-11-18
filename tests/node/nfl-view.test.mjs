import {teamScoringHtml} from '../../sharp-service/team-scoring-view.js';
import {deepDiveHtml} from '../../sharp-service/deep-dive.js';
import {decisionPresentation,decisionTime} from '../../sharp-service/decision-display.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { modelRows } from '../../sharp-service/nfl-view.js';
test('NFL view distinguishes independent props from market-only shadow probabilities and never promotes plays',()=>{
 const now=Date.parse('2026-09-28T12:00Z');
 const row={eventID:'one',startsAt:'2026-09-28T23:00Z',playerName:'Receiver',statID:'receiving_yards',side:'over',line:55.5,rawIndependentProbability:.64,shadowModelProbability:.5,marketFairProbability:.5,shadowStatus:'PLAY',status:'PLAY'};
 const [actual]=modelRows({candidates:[row],generatedAt:'2026-09-28T11:59Z'},'props',now);
 assert.equal(actual.model,.64);assert.equal(actual.market,.5);assert.equal(actual.status,'SHADOW');assert.equal(actual.stale,false);
 assert.equal(modelRows({candidates:[{...row,startsAt:'2026-09-27T23:00Z'}]},'props',now).length,0);
 assert.equal(modelRows({candidates:[{...row,rawIndependentProbability:null}]},'props',now)[0].model,null);
 assert.equal(modelRows({candidates:[row],generatedAt:'2026-09-27T12:00Z'},'props',now)[0].stale,true);
});
test('NFL view preserves exact lines and missing probabilities',()=>{
 const rows=modelRows({markets:[{startsAt:'2026-09-28T23:00Z',line:0,label:'Home +0',modelProbability:.54,marketFairProbability:null,probabilitySource:'market_blend',independentContributionWeight:.1}]},'teams',Date.parse('2026-09-28T12:00Z'));
 assert.equal(rows[0].line,0);assert.equal(rows[0].model,.54);assert.equal(rows[0].market,null);
});

test('market-only and unknown team probabilities cannot appear as an independent model forecast',()=>{
 const row={startsAt:'2026-09-28T23:00Z',marketType:'moneyline',modelProbability:.75,marketFairProbability:.75};
 const data={generatedAt:'2026-09-28T11:59Z',markets:[
  {...row,probabilitySource:'market_only',independentContributionWeight:0},
  {...row},
  {...row,probabilitySource:'market_blend',independentContributionWeight:0},
  {...row,probabilitySource:'market_blend',independentContributionWeight:.125,modelProbability:.73}
 ]};
 const rows=modelRows(data,'teams',Date.parse('2026-09-28T12:00Z'));
 assert.deepEqual(rows.map(r=>r.model),[null,null,null,.73]);
 assert.equal(rows[0].market,.75);
 assert.match(rows[0].probabilityNote,/market prices only/i);
 assert.match(rows[1].probabilityNote,/source.*unverified/i);
 assert.equal(rows[3].probabilityLabel,'Market + model blend');
 assert.match(rows[3].probabilityNote,/12.5%/);
});

test('unavailable future NFL forecasts keep their reason visible without a model percentage',()=>{
 const data={generatedAt:'2026-09-28T11:59Z',events:[
  {eventID:'blocked',startsAt:'2026-09-28T23:00Z',available:false,matchup:{away:{name:'Away'},home:{name:'Home'}},reason:'Quarterback sources disagree.',forecastReadiness:{available:false,reasons:['QB_SOURCE_CONFLICT']}},
  {eventID:'past',startsAt:'2026-09-27T23:00Z',available:false,reason:'Past game.'}
 ]};
 const rows=modelRows(data,'teams',Date.parse('2026-09-28T12:00Z'));
 assert.equal(rows.length,1);
 assert.equal(rows[0].forecastBlocked,true);
 assert.equal(rows[0].model,null);
 assert.equal(rows[0].away,'Away');
 assert.equal(rows[0].reason,'Quarterback sources disagree.');
 assert.deepEqual(modelRows(data,'props',Date.parse('2026-09-28T12:00Z')),[]);
});

test('future response timestamps are not accepted as fresh forecasts',()=>{
 const [row]=modelRows({generatedAt:'2026-09-29T12:00Z',markets:[{startsAt:'2026-09-30T23:00Z'}]},'teams',Date.parse('2026-09-28T12:00Z'));
 assert.equal(row.stale,true);
});
import {marketLabel} from '../../sharp-service/nfl-view.js';
test('NFL cards identify exact spread and total thresholds including zero',()=>{
 assert.equal(marketLabel({marketType:'spread',label:'Home',line:0},'teams'),'spread · Home · 0');
 assert.equal(marketLabel({marketType:'total',label:'Over',line:44.5},'teams'),'total · Over · 44.5');
 assert.equal(marketLabel({marketType:'moneyline',label:'Home',line:null},'teams'),'moneyline · Home');
});
import vm from 'node:vm';
import fs from 'node:fs';
test('failed refresh cannot restore old cards through a filter or timer render',async()=>{
 const elements=new Map(); const get=id=>{if(!elements.has(id))elements.set(id,{value:id==='kind'?'teams':'',innerHTML:'',textContent:'',disabled:false,addEventListener(){},replaceChildren(){this.innerHTML='';}});return elements.get(id);};
 const html=fs.readFileSync(new URL('../../sharp-service/nfl.html',import.meta.url),'utf8');
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
 const payload={generatedAt:new Date().toISOString(),markets:[{eventID:'one',away:'Away',home:'Home',startsAt:new Date(Date.now()+3600000).toISOString(),marketType:'total',label:'Over',line:44.5,modelProbability:.55,marketFairProbability:.5}]};
 const context=vm.createContext({document:{getElementById:get},teamScoringHtml,modelRows,marketLabel,decisionPresentation,decisionTime,deepDiveHtml,preserveDeepDives(){},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async()=>({ok:true,json:async()=>payload})});
 await vm.runInContext(script,context);assert.match(get('cards').innerHTML,/44.5/);assert.match(get('cards').innerHTML,/NOT CLEARED/);assert.match(get('cards').innerHTML,/Decision recorded: Not recorded/);
 context.fetch=async()=>{throw new Error('Upstream unavailable')};await vm.runInContext('load(true)',context);vm.runInContext('render()',context);
 assert.equal(get('cards').innerHTML,'');assert.match(get('status').textContent,/Upstream unavailable/);
});

test('NFL rendered cards distinguish market reference from model and show blocked-game reasons',async()=>{
 const elements=new Map(); const get=id=>{if(!elements.has(id))elements.set(id,{value:id==='kind'?'teams':'',innerHTML:'',textContent:'',disabled:false,addEventListener(){},replaceChildren(){this.innerHTML='';}});return elements.get(id);};
 const html=fs.readFileSync(new URL('../../sharp-service/nfl.html',import.meta.url),'utf8');
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
 const startsAt=new Date(Date.now()+3600000).toISOString();
 const payload={generatedAt:new Date().toISOString(),productionEligible:false,markets:[{eventID:'one',away:'Away',home:'Home',startsAt,marketType:'moneyline',label:'Home',modelProbability:.75,marketFairProbability:.75,probabilitySource:'market_only',independentContributionWeight:0}],events:[{eventID:'two',startsAt,available:false,matchup:{away:{name:'Visitor'},home:{name:'Host'}},reason:'Quarterback sources disagree: scheduled Old & depth New.'}]};
 const context=vm.createContext({document:{getElementById:get},teamScoringHtml,modelRows,marketLabel,decisionPresentation,decisionTime,deepDiveHtml,preserveDeepDives(){},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async()=>({ok:true,json:async()=>payload})});
 await vm.runInContext(script,context);
 const cards=get('cards').innerHTML;
 assert.match(cards,/Market prices only; independent model contribution is 0%/);
 assert.match(cards,/Market-implied chance/);
 assert.doesNotMatch(cards,/Calibrated model/);
 assert.match(cards,/Forecast unavailable/);
 assert.match(cards,/Quarterback sources disagree: scheduled Old &amp; depth New/);
 assert.equal((cards.match(/75.0%/g)||[]).length,2); // market in card and deep dive; never a model value
 assert.doesNotMatch(cards,/Model: 75.0%/);
});
