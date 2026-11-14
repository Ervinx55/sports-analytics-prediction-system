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

test('quota exhaustion explains the data blocker without exposing upstream error text',async()=>{
 const loader=createResearchLoader({fetchImpl:async()=>({ok:false,status:429,json:async()=>({error:'secret upstream detail',providerFailures:[{objectBudgetBlocked:true}]})})});await loader.load('NBA');assert.match(loader.state.message,/quota.*exhausted/i);assert.doesNotMatch(loader.state.message,/secret|Refresh to retry/);assert.deepEqual(loader.state.rows,[]);
});

test('withheld roster mismatches are disclosed without exposing source error details',async()=>{
 const loader=createResearchLoader({fetchImpl:async()=>({ok:true,json:async()=>({events:[],sourceHealth:{playerIdentity:{matched:12,excluded:3,unverified:0,error:'secret'}}})})});
 await loader.load('NBA');assert.match(loader.state.message,/3.*withheld/);assert.doesNotMatch(loader.state.message,/secret/);
});

test('book coverage is disclosed as observed rather than assumed entitlement',async()=>{
 const loader=createResearchLoader({fetchImpl:async()=>({ok:true,json:async()=>({events:[],coverage:{bookmakerCoverage:{pinnacle:{status:'OBSERVED'},circa:{status:'NOT_OBSERVED'},bookmakereu:{status:'NOT_OBSERVED'},prizepicks:{status:'LINE_ONLY'}}}})})});
 await loader.load('NBA');assert.match(loader.state.message,/Pinnacle: quotes observed/);assert.match(loader.state.message,/Circa: not observed/);assert.match(loader.state.message,/PrizePicks: comparison lines only/);assert.match(loader.state.message,/not proof of access/);
});


test('research UI explicitly opts in without changing frozen validation callers',async()=>{
 const urls=[];const loader=createResearchLoader({fetchImpl:async url=>{urls.push(url);return {ok:true,json:async()=>({events:[]})};}});
 await loader.load('NBA');await loader.load('NFL');await loader.load('NBA');
 assert.deepEqual(urls,['/api/nbaprops?research=1','/api/nflprops','/api/nbaprops?research=1']);
});
