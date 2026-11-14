import test from 'node:test';import assert from 'node:assert/strict';
import {createCfbHandler} from '../../sharp-service/handlers/cfb-forecasts.js';
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.data=data;return this;}});
test('CFB private collection rejects missing/wrong auth before any upstream calls',async()=>{
 let calls=0;const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'server-key'},fetchImpl:async()=>{calls++;throw Error('never');}});
 for(const authorization of [undefined,'Bearer fake']){const r=response();await handler({method:'POST',headers:{authorization},body:{action:'refresh'}},r);assert.equal(r.code,401);}
 assert.equal(calls,0);
});
test('CFB public read returns explicit uninitialized state and never leaks private source records',async()=>{
 const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'server-key'},fetchImpl:async()=>({ok:true,json:async()=>[]})});const r=response();await handler({method:'GET'},r);assert.equal(r.code,200);assert.deepEqual(r.data.forecasts,[]);assert.equal(r.data.status,'AWAITING_COLLECTION');
});
test('CFB admin rejects arbitrary provider URLs, unknown actions and invalid season',async()=>{
 let calls=0;const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'server-key'},fetchImpl:async()=>{calls++;throw Error('never');}});
 for(const body of [{action:'fetch',url:'https://evil.example'},{action:'history',season:1800}]){const r=response();await handler({method:'POST',headers:{authorization:'Bearer server-key'},body},r);assert.equal(r.code,400);}
 assert.equal(calls,0);
});
test('CFB successful minimal database inserts do not cause a JSON parsing 503',async()=>{
 let providerCalls=0;const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'server-key',SPORTS_ODDS_API_KEY:'provider-key'},now:()=>Date.parse('2026-11-14T16:00:00Z'),optimize:async()=>({blocked:false,effectiveLimit:100}),providerFetch:async({url})=>{providerCalls++;assert.match(url,/finalized=true/);assert.doesNotMatch(url,/oddsAvailable/);return {payload:{data:[],nextCursor:null},fetchedAt:Date.parse('2026-11-14T16:00:00Z'),ageMs:0};},fetchImpl:async(url,options)=>url.includes('/rpc/')?{ok:true,status:200,text:async()=>'true'}:{ok:true,status:options.method==='DELETE'?204:201,text:async()=>''}});
 const r=response();await handler({method:'POST',headers:{authorization:'Bearer server-key'},body:{action:'history',season:2025}},r);assert.equal(r.code,200);assert.equal(r.data.status,'COLLECTED');assert.equal(providerCalls,1);
});
