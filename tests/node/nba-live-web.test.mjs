import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../sharp-service/handlers/nba-live-decisions.js';
import {isCurrentPlay} from '../../sharp-service/nba-live.js';
test('browser requires fresh server verification and current approval-backed PLAY',()=>{
 const now=Date.parse('2026-11-10T18:00:00Z');
 const data={contract:'nba-reviewed-live-v1',generatedAt:new Date(now).toISOString()};
 const row={status:'PLAY',productionEligible:true,productionWeight:1,approvalId:'review',issuedAt:data.generatedAt,validUntil:new Date(now+600000).toISOString(),startsAt:new Date(now+3600000).toISOString()};
 assert.equal(isCurrentPlay(row,data,now),true);
 for(const patch of [{status:'PASS'},{productionEligible:false},{productionWeight:0},{approvalId:null},{validUntil:data.generatedAt},{startsAt:data.generatedAt}])assert.equal(isCurrentPlay({...row,...patch},data,now),false);
 assert.equal(isCurrentPlay(row,data,now+30000),false);
});
test('read endpoint never exposes credentials or clears on errors',async()=>{
 const saved={key:process.env.SUPABASE_SECRET_KEY,legacy:process.env.SUPABASE_SERVICE_ROLE_KEY,fetch:globalThis.fetch};
 const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
 try{
 delete process.env.SUPABASE_SECRET_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 let r=res();await handler({method:'GET'},r);assert.equal(r.code,503);
 process.env.SUPABASE_SECRET_KEY='test-private-secret';
 globalThis.fetch=async()=>({ok:true,json:async()=>({contract:'nba-reviewed-live-v1',decisions:[]})});
 r=res();await handler({method:'GET'},r);assert.equal(r.code,200);assert.equal(r.headers['Cache-Control'],'no-store');assert.ok(!JSON.stringify(r.body).includes('test-private-secret'));
 globalThis.fetch=async()=>{throw Error('test-private-secret');};
 r=res();await handler({method:'GET'},r);assert.equal(r.code,503);assert.ok(!JSON.stringify(r.body).includes('test-private-secret'));
 r=res();await handler({method:'POST'},r);assert.equal(r.code,405);
 }finally{globalThis.fetch=saved.fetch;for(const [key,value] of [['SUPABASE_SECRET_KEY',saved.key],['SUPABASE_SERVICE_ROLE_KEY',saved.legacy]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

