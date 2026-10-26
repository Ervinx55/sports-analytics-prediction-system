import test from 'node:test';import assert from 'node:assert/strict';
import {createResearchLoader} from '../../sharp-service/research-loader.js';
const now=Date.parse('2026-10-25T18:00:00Z');
test('late sport response cannot replace the selected sport',async()=>{
 const pending=[];const loader=createResearchLoader({now:()=>now,fetchImpl:url=>new Promise(resolve=>pending.push({url,resolve}))});
 const a=loader.load('NBA');const b=loader.load('NFL');pending[1].resolve({ok:true,json:async()=>({generatedAt:'2026-10-25T18:00:00Z',candidates:[]})});await b;pending[0].resolve({ok:true,json:async()=>({events:[]})});await a;
 assert.equal(loader.state.sport,'NFL');assert.equal(loader.state.status,'ready');
});
test('failure clears previous quote data and permits retry',async()=>{
 let fail=false;const loader=createResearchLoader({fetchImpl:async()=>{if(fail)throw Error('private upstream detail');return {ok:true,json:async()=>({events:[]})};}});
 await loader.load('NBA');fail=true;await loader.load('NBA');assert.equal(loader.state.status,'error');assert.deepEqual(loader.state.rows,[]);assert.doesNotMatch(loader.state.message,/private/);
 fail=false;await loader.load('NBA');assert.equal(loader.state.status,'ready');
});
