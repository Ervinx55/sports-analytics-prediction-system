import test from 'node:test';
import assert from 'node:assert/strict';
import {propsResponse as response} from '../../sharp-service/api/nbaprops.js';
const propsResponse=options=>response({optimize:async()=>({effectiveLimit:16,blocked:false}),...options});
test('NBA endpoint returns bounded native quotes and preserves cache timestamp',async()=>{
 let request;const now=Date.parse('2026-11-10T08:00:00Z');
 const result=await propsResponse({now,key:'test',fetchPage:async r=>{request=r;return {payload:{success:true,data:[]},fetchedAt:now-120000,cacheStatus:'HIT'};}});
 assert.equal(result.status,200);assert.equal(result.body.generatedAt,'2026-11-10T07:58:00.000Z');assert.equal(result.body.partialCoverage,true);
 const url=new URL(request.url);assert.equal(url.searchParams.get('leagueID'),'NBA');assert.ok(Number(url.searchParams.get('limit'))>=15);assert.equal(url.searchParams.get('bookmakerID'),'pinnacle,circa,bookmakereu,draftkings,prizepicks');
});
test('NBA endpoint fails closed on missing keys, malformed data and provider errors',async()=>{
 assert.equal((await propsResponse({key:''})).status,503);
 assert.equal((await propsResponse({key:'test',fetchPage:async()=>({payload:{success:true,data:'bad'}})})).status,503);
 const r=await propsResponse({key:'test',fetchPage:async()=>{throw Error('private API key');}});assert.equal(r.status,503);assert.ok(!JSON.stringify(r).includes('private API'));
});
test('provider query window is stable across requests within one minute',async()=>{
 const urls=[];for(const offset of [1000,2000])await propsResponse({now:Date.parse('2026-11-10T08:00:00Z')+offset,key:'test',fetchPage:async r=>{urls.push(r.url);return {payload:{success:true,data:[]},fetchedAt:Date.parse('2026-11-10T08:00:00Z'),cacheStatus:'HIT'};}});
 assert.equal(urls[0],urls[1]);
});
