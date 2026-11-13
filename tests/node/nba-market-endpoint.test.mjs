import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../sharp-service/lib/edge-vnext-handler.js';
const res=()=>({statusCode:200,setHeader(){},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}});
test('explicit NBA price comparison connects the board and returns evaluation coverage',async()=>{
 const original=globalThis.fetch;let boardCalls=0;
 globalThis.fetch=async input=>{
  const u=new URL(String(input));
  if(u.pathname==='/api/board'){
   boardCalls++;assert.equal(u.searchParams.get('leagues'),'NBA');
   return {ok:true,json:async()=>({fetchedAt:new Date().toISOString(),events:[]})};
  }
  assert.equal(u.hostname,'site.api.espn.com');return {ok:true,json:async()=>({events:[]})};
 };
 try{const r=res();await handler({method:'GET',query:{mode:'nba',live:'1',quotes:'1'}},r);
  assert.equal(r.body.quoteSource?.status,'OBSERVED');assert.equal(r.body.evaluationSummary?.games,0);
  assert.equal(boardCalls,1);assert.equal(r.body.productionEligible,false);
 }finally{globalThis.fetch=original;}
});
test('quote outage preserves the independent model response and exposes the failed connection',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async input=>{
  const u=new URL(String(input));if(u.pathname==='/api/board')throw Error('private transport details');
  return {ok:true,json:async()=>({events:[]})};
 };
 try{const r=res();await handler({method:'GET',query:{mode:'nba',live:'1',quotes:'1'}},r);
  assert.equal(r.body.status,'RESEARCH_SHADOW');assert.equal(r.body.quoteSource?.status,'UNAVAILABLE');
  assert.equal(r.body.scoreboardCoverage?.daysAvailable,21);assert.ok(!JSON.stringify(r.body).includes('private transport'));
 }finally{globalThis.fetch=original;}
});
