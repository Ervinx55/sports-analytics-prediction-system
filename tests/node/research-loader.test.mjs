import test from 'node:test';import assert from 'node:assert/strict';
import {createResearchLoader} from '../../sharp-service/research-loader.js';
const now=Date.parse('2026-10-25T18:00:00Z');
test('NBA research explicitly uses the multi-book view and retains missing platform coverage',async()=>{
 let url;const loader=createResearchLoader({fetchImpl:async target=>{url=target;return {ok:true,json:async()=>({events:[],bookCoverage:{configured:['draftkings','bovada','prizepicks','underdog','kalshi'],missingRequested:['bovada']},coverage:{eventsComplete:false,reasons:['PAGE_LIMIT_REACHED']}})};}});
 await loader.load('NBA');assert.equal(url,'/api/nbaprops?view=research');assert.ok(loader.state.bookCoverage.configured.includes('bovada'));assert.match(loader.state.message,/partial/i);
});
test('late sport response cannot replace the selected sport',async()=>{
 const pending=[];const loader=createResearchLoader({now:()=>now,fetchImpl:url=>new Promise(resolve=>pending.push({url,resolve}))});
 const a=loader.load('NBA');const b=loader.load('NFL');pending[1].resolve({ok:true,json:async()=>({generatedAt:'2026-10-25T18:00:00Z',events:[],candidates:[]})});pending[2].resolve({ok:true,json:async()=>({candidates:[]})});await b;pending[0].resolve({ok:true,json:async()=>({events:[]})});await a;
 assert.equal(loader.state.sport,'NFL');assert.equal(loader.state.status,'ready');
});
test('NFL all-book quotes survive an unavailable frozen estimate endpoint',async()=>{
 const calls=[];const loader=createResearchLoader({fetchImpl:async url=>{calls.push(url);if(!url.includes('view=research'))throw Error('private');return {ok:true,json:async()=>({events:[],candidates:[]})};}});
 await loader.load('NFL');assert.deepEqual(calls,['/api/nflprops?view=research','/api/nflprops']);
 assert.equal(loader.state.status,'ready');assert.match(loader.state.message,/estimates.*unavailable/i);
});
test('game view is bounded to one league and never adds a bookmaker restriction',async()=>{
 let url;const loader=createResearchLoader({now:()=>now,fetchImpl:async u=>{url=new URL(u,'http://test');return {ok:true,json:async()=>({events:[],providerObservations:[{league:'NHL',eventsComplete:false}]})};}});
 await loader.load('NHL','games');assert.equal(url.pathname,'/api/board');assert.equal(url.searchParams.get('leagues'),'NHL');
 assert.equal(url.searchParams.has('books'),false);assert.equal(url.searchParams.get('view'),'research');assert.equal(loader.state.kind,'games');assert.match(loader.state.message,/partial/i);
 await assert.rejects(loader.load('NBA,NFL','games'),/Unsupported/);
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
