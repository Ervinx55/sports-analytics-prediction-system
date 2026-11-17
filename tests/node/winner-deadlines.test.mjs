import test from 'node:test';
import assert from 'node:assert/strict';
import {createWinnerHandler,createWinnerStore,WINNER_PHASE_BUDGET_MS} from '../../sharp-service/handlers/winner-forecasts.js';

const env={SUPABASE_SERVICE_ROLE_KEY:'test-service-secret'};
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
const request={method:'POST',headers:{authorization:'Bearer test-service-secret'},body:{action:'settle'}};
const emptySource=()=>({groups:{},sources:[],finals:[],quotes:[],coverage:{}});

test('winner phase budgets reserve an eleven-second append inside the thirty-second request budget',async()=>{
 assert.deepEqual(WINNER_PHASE_BUDGET_MS,{status:2500,pending:2500,sources:14000,append:11000});
 assert.equal(WINNER_PHASE_BUDGET_MS.pending+WINNER_PHASE_BUDGET_MS.sources+WINNER_PHASE_BUDGET_MS.append,27500);
 const budgets=[],calls=[];
 const store=createWinnerStore({env,deadlineSignal:ms=>{budgets.push(ms);return new AbortController().signal;},fetchImpl:async(url,options)=>{calls.push({url,options});return new Response('{}');}});
 await store.status();await store.pending();await store.append({p_sources:[]});
 assert.deepEqual(budgets,[2500,2500,11000]);
 assert.ok(calls.every(c=>c.options.method==='POST'&&c.options.redirect==='error'));
});

test('append timeout is explicitly unconfirmed and retryable without retrying inside the exhausted request',async()=>{
 const logs=[];let writes=0;
 const handler=createWinnerHandler({env,logger:entry=>logs.push(entry),loadSources:async()=>emptySource(),store:{pending:async()=>[],append:async()=>{writes++;throw Object.assign(new Error('https://secret.test/private test-service-secret body'),{name:'TimeoutError'});}}});
 const res=response();await handler(request,res);
 assert.equal(res.code,503);assert.equal(writes,1);assert.equal(res.headers['Retry-After'],'5');
 assert.equal(res.body.error,'WINNER_APPEND_UNCONFIRMED');assert.equal(res.body.appendStatus,'UNKNOWN');assert.equal(res.body.retryable,true);assert.equal(res.body.retryAction,'settle');
 assert.equal(logs.length,1);assert.equal(logs[0].phase,'append');assert.equal(logs[0].category,'TIMEOUT');assert.equal(logs[0].commitStatus,'UNKNOWN');
 assert.equal(JSON.stringify({logs,body:res.body}).includes('secret'),false);
});

test('pending and source failures identify their phase without suggesting an append occurred',async()=>{
 for(const phase of ['pending','sources']){
  const logs=[];let writes=0;
  const handler=createWinnerHandler({env,logger:entry=>logs.push(entry),store:{pending:async()=>{if(phase==='pending')throw new Error('private input');return[];},append:async()=>{writes++;}},loadSources:async()=>{throw new Error('private source');}});
  const res=response();await handler(request,res);
  assert.equal(res.code,503);assert.equal(writes,0);assert.equal(res.body.phase,phase);assert.equal(res.body.appendStatus,'NOT_ATTEMPTED');
  assert.equal(logs[0].phase,phase);assert.equal(logs[0].commitStatus,'NOT_ATTEMPTED');assert.equal(JSON.stringify(logs).includes('private'),false);
 }
});

test('status timeout reports only a sanitized status phase diagnostic',async()=>{
 const logs=[];const handler=createWinnerHandler({env,logger:entry=>logs.push(entry),store:{status:async()=>{throw Object.assign(new Error('database payload'),{name:'AbortError'});}}});
 const res=response();await handler({method:'GET'},res);
 assert.equal(res.code,503);assert.equal(res.body.phase,'status');assert.equal(res.body.appendStatus,'NOT_ATTEMPTED');assert.equal('retryAction' in res.body,false);
 assert.equal(logs[0].category,'TIMEOUT');assert.equal(JSON.stringify(logs).includes('payload'),false);
});
