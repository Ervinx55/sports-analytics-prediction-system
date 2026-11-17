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

test('any missing historical scoreboard withholds NBA winner forecasts even with enough team games',async()=>{
 const original=globalThis.fetch;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const part=name=>parts.find(p=>p.type===name).value;
 const target=part('year')+part('month')+part('day');
 try{for(const missing of [0,1,2]){
  let historicalRequests=0;
  globalThis.fetch=async input=>{
   const u=new URL(String(input)),date=u.searchParams.get('dates'),upcoming=date===target;
   if(!upcoming&&historicalRequests++<missing)throw Error('Historical scoreboard unavailable');
   const startsAt=upcoming?new Date(Date.now()+3600000).toISOString():date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)+'T01:00:00Z';
   return {ok:true,json:async()=>({events:[{id:date,date:startsAt,status:{type:{completed:!upcoming,state:upcoming?'pre':'post'}},competitions:[{competitors:[
    {homeAway:'home',team:{abbreviation:'BOS'},score:upcoming?'0':'110'},
    {homeAway:'away',team:{abbreviation:'CHI'},score:upcoming?'0':'100'}
   ]}]}]})};
  };
  const r=res();await handler({method:'GET',query:{mode:'nba',live:'1'}},r);
  assert.equal(r.body.scoreboardCoverage.daysRequested,21);
  assert.equal(r.body.scoreboardCoverage.daysAvailable,21-missing);
  assert.equal(r.body.rows.length,1);
  assert.equal(r.body.historyComplete,missing===0);
  assert.equal(r.body.status,missing?'SOURCE_INCOMPLETE':'RESEARCH_SHADOW');
  assert.equal(r.body.productionEligible,false);
  if(missing){
   assert.equal(r.body.rows[0].homeWinProbability,null);
   assert.equal(r.body.rows[0].awayWinProbability,null);
   assert.ok(r.body.rows[0].reasons.includes('INSUFFICIENT_OR_INCOMPLETE_HISTORICAL_GAMES'));
  }else assert.equal(typeof r.body.rows[0].homeWinProbability,'number');
 }}finally{globalThis.fetch=original;}
});
