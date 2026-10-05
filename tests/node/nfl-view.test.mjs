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
 const rows=modelRows({markets:[{startsAt:'2026-09-28T23:00Z',line:0,label:'Home +0',modelProbability:.54,marketFairProbability:null}]},'teams',Date.parse('2026-09-28T12:00Z'));
 assert.equal(rows[0].line,0);assert.equal(rows[0].model,.54);assert.equal(rows[0].market,null);
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
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/m,'');
 const payload={generatedAt:new Date().toISOString(),markets:[{eventID:'one',away:'Away',home:'Home',startsAt:new Date(Date.now()+3600000).toISOString(),marketType:'total',label:'Over',line:44.5,modelProbability:.55,marketFairProbability:.5}]};
 const context=vm.createContext({document:{getElementById:get},modelRows,marketLabel,AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async()=>({ok:true,json:async()=>payload})});
 await vm.runInContext(script,context);assert.match(get('cards').innerHTML,/44.5/);
 context.fetch=async()=>{throw new Error('Upstream unavailable')};await vm.runInContext('load(true)',context);vm.runInContext('render()',context);
 assert.equal(get('cards').innerHTML,'');assert.match(get('status').textContent,/Upstream unavailable/);
});
