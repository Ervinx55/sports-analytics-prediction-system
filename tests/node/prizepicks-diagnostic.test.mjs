import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePrizePicks,prizePicksDiagnosticResponse} from '../../sharp-service/lib/prizepicks-diagnostic.js';
import handler from '../../sharp-service/api/nbaprops.js';
import {resetProviderProtectionForTests} from '../../sharp-service/lib/provider-protection.js';

const now=Date.parse('2026-11-23T12:00:00Z'),stamp=new Date(now-30000).toISOString();
const playerID='PLAYER_ONE_NBA';
function event(id='g1',stats=['points','points+rebounds+assists','threePointersMade']){
 const odds={};
 for(const [i,stat] of stats.entries()){
  const side=i===1?'under':'over',oddID=`${stat}-${playerID}-game-ou-${side}`;
  odds[oddID]={oddID,statID:stat,sideID:side,playerID,periodID:'game',betTypeID:'ou',byBookmaker:{prizepicks:{available:true,overUnder:String([24.5,38.5,2.5][i]??1.5),odds:'+100',lastUpdatedAt:stamp}}};
 }
 return {eventID:id,leagueID:'NBA',type:'match',status:{startsAt:'2026-11-23T22:00:00Z'},teams:{home:{teamID:'HOME_NBA'},away:{teamID:'AWAY_NBA'}},players:{[playerID]:{playerID,teamID:'HOME_NBA',name:'Player One'}},odds};
}
const normalized=events=>normalizePrizePicks(events,{now,generatedAt:stamp});
const page=(data,nextCursor=null,fetchedAt=now)=>({payload:{success:true,data,nextCursor},fetchedAt,cacheStatus:'HIT'});
const response=options=>prizePicksDiagnosticResponse({now,key:'test',optimize:async()=>({blocked:false,effectiveLimit:16}),...options});

test('PrizePicks uses provider event times and preserves raw stat IDs without inventing prices',()=>{
 const result=normalized([event()]);
 assert.equal(result.quotes.length,3);
 assert.deepEqual(result.statCounts,{points:1,'points+rebounds+assists':1,threePointersMade:1});
 assert.equal(result.quotes[0].eventID,'sgo:g1');
 assert.equal(result.quotes[0].startsAt,'2026-11-23T22:00:00Z');
 assert.equal(result.quotes[0].line,24.5);
 for(const quote of result.quotes){
  assert.equal(quote.platformType,'dfs');assert.equal(quote.odds,null);
  assert.equal(quote.modelProbability,null);assert.equal(quote.marketProbability,null);
  assert.equal(quote.freshness,'CURRENT');assert.equal(quote.productionEligible,false);
 }
});

test('PrizePicks rejects coerced lines, wrong rosters and ineligible event states',()=>{
 for(const invalid of [null,'',' ',true,false,[],[24.5],{},'Infinity',-1]){
  const e=event();for(const odd of Object.values(e.odds))odd.byBookmaker.prizepicks.overUnder=invalid;
  assert.equal(normalized([e]).quotes.length,0,JSON.stringify(invalid));
 }
 for(const modify of [
  e=>{e.players[playerID].teamID='OTHER_NBA';},
  e=>{e.players[playerID].playerID='WRONG_NBA';},
  e=>{e.leagueID='NFL';},
  e=>{e.status.started=true;},e=>{e.status.cancelled=true;},
  e=>{e.status.startsAt='2026-11-23T11:59:59Z';},
  e=>{e.status.startsAt='2026-11-26T22:00:00Z';},
  e=>{for(const o of Object.values(e.odds))o.periodID='1h';},
  e=>{for(const o of Object.values(e.odds))o.oddID='wrong';},
  e=>{for(const o of Object.values(e.odds))o.byBookmaker.prizepicks.available=false;}
 ]){const e=event();modify(e);assert.equal(normalized([e]).quotes.length,0);}
});

test('duplicate provider events do not double-count quotes and old observations remain labeled old',()=>{
 const e=event();for(const odd of Object.values(e.odds))odd.byBookmaker.prizepicks.lastUpdatedAt=new Date(now-300001).toISOString();
 const result=normalized([e,e]);
 assert.equal(result.quotes.length,3);assert.ok(result.quotes.every(q=>q.freshness==='STALE'));
 assert.equal(result.quotes[0].updatedAt,new Date(now-300001).toISOString());
});

test('diagnostic uses the protected SGO background budget and bounded main-line query',async()=>{
 let request,policy;
 const r=await response({optimize:async p=>{policy=p;return {blocked:false,effectiveLimit:2};},fetchPage:async p=>{request=p;return page([event()]);}});
 assert.equal(r.status,200);assert.equal(r.body.quoteCount,3);
 assert.equal(r.body.complete,true);assert.equal(r.body.productionEligible,false);assert.equal(r.body.productionWeight,0);
 assert.equal(policy.priority,'background');assert.equal(policy.fanout,2);
 assert.equal(request.priority,'background');assert.equal(request.consumer,'nba-prizepicks-diagnostic');
 assert.equal(request.freshMs,60000);assert.equal(request.staleMs,300000);assert.ok(request.timeoutMs<=8000);
 assert.equal(request.objectPolicy.effectiveLimit,2);
 const url=new URL(request.url);
 assert.equal(url.origin,'https://api.sportsgameodds.com');
 assert.equal(url.pathname,'/v2/events');
 for(const [key,value] of Object.entries({leagueID:'NBA',bookmakerID:'prizepicks',limit:'2',type:'match',includeAltLines:'false',finalized:'false'}))assert.equal(url.searchParams.get(key),value);
 assert.equal(Date.parse(url.searchParams.get('startsBefore'))-Date.parse(url.searchParams.get('startsAfter')),48*3600000);
 assert.equal(url.searchParams.has('oddIDs'),false);
});

test('bounded pagination deduplicates events and preserves the oldest fetch time',async()=>{
 let calls=0;
 const r=await response({fetchPage:async()=>++calls===1?page([event()], 'next',now-60000):page([event(),event('g2')],null,now-120000)});
 assert.equal(calls,2);assert.equal(r.status,200);assert.equal(r.body.quoteCount,6);
 assert.equal(r.body.fetchedAt,'2026-11-23T11:58:00.000Z');assert.equal(r.body.complete,true);
 assert.equal(r.body.coverage.pagesFetched,2);assert.equal(r.body.coverage.providerEvents,2);
});

test('later provider failure preserves collected quotes with explicit incomplete coverage',async()=>{
 let calls=0;
 const r=await response({fetchPage:async()=>{if(++calls===2)throw Error('secret upstream error');return page([event()],'next');}});
 assert.equal(r.status,200);assert.equal(r.body.quoteCount,3);assert.equal(r.body.complete,false);
 assert.ok(r.body.coverage.reasons.includes('PAGE_UNAVAILABLE'));assert.ok(!JSON.stringify(r).includes('secret'));
});

test('bad, repeated and excessive cursors never become complete or unbounded coverage',async()=>{
 for(const next of [false,0,{},[]]){
  const r=await response({fetchPage:async()=>page([event()],next)});
  assert.equal(r.body.complete,false);assert.ok(r.body.coverage.reasons.includes('INVALID_CURSOR'));
 }
 let calls=0;const repeated=await response({fetchPage:async()=>{calls++;return page([event()],'same');}});
 assert.equal(calls,2);assert.equal(repeated.body.complete,false);assert.ok(repeated.body.coverage.reasons.includes('INVALID_CURSOR'));
 calls=0;const capped=await response({fetchPage:async()=>page([event()],String(++calls))});
 assert.equal(calls,2);assert.equal(capped.body.complete,false);assert.ok(capped.body.coverage.reasons.includes('PAGE_LIMIT_REACHED'));
});

test('quota exhaustion and missing credentials make no quote request',async()=>{
 let calls=0;const fetchPage=async()=>{calls++;throw Error('unexpected fetch');};
 assert.equal((await response({key:'',fetchPage})).status,503);
 const r=await response({optimize:async()=>({blocked:true,effectiveLimit:0}),fetchPage});
 assert.equal(r.status,429);assert.equal(r.body.reason,'PRIZEPICKS_OBJECT_QUOTA_EXHAUSTED');
 assert.equal(r.body.providerFailures[0].objectBudgetBlocked,true);assert.equal(calls,0);
});

test('invalid provider responses fail closed and access denials are not retried',async()=>{
 for(const result of [page([event()],null,now+1),page([event()],null,now-300001),{...page([]),payload:{success:false,data:[]}},page(Array.from({length:17},()=>event()))]){
  assert.equal((await response({fetchPage:async()=>result})).status,503);
 }
 let calls=0;const denied=await response({fetchPage:async()=>{calls++;throw Object.assign(Error('private token'),{status:403});}});
 assert.equal(calls,1);assert.equal(denied.status,502);assert.equal(denied.body.reason,'PRIZEPICKS_PROVIDER_ACCESS_DENIED');assert.ok(!JSON.stringify(denied).includes('private'));
 const empty=await response({fetchPage:async()=>page([])});
 assert.equal(empty.status,200);assert.equal(empty.body.status,'NO_QUOTES_RETURNED');assert.equal(empty.body.quoteCount,0);
});

test('provider access denial cannot be masked by cached or partially collected diagnostic quotes',async()=>{
 const cached=await response({fetchPage:async()=>({...page([event()]),cacheStatus:'STALE',upstreamError:{status:403}})});
 assert.equal(cached.status,502);assert.equal(cached.body.reason,'PRIZEPICKS_PROVIDER_ACCESS_DENIED');
 assert.equal(cached.body.quoteCount,0);
 let calls=0;const partial=await response({fetchPage:async()=>{if(++calls===2)throw Object.assign(Error('denied'),{status:401});return page([event()],'next');}});
 assert.equal(partial.status,502);assert.equal(partial.body.quoteCount,0);assert.equal(calls,2);
});

test('authenticated deployed diagnostic coalesces concurrent reads through real provider protection',async()=>{
 const names=['SHARP_MONITOR_TOKEN','SPORTS_ODDS_API_KEY','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SPORTS_ODDS_REQUESTS_PER_MINUTE','SPORTS_ODDS_OBJECT_OPTIMIZATION'];
 const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const previousFetch=globalThis.fetch,previousClock=Date.now;
 let release,started,calls=0;const beginning=new Promise(resolve=>{started=resolve;});
 const invoke=async(token='fixture-monitor')=>{
  const res={headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'GET',query:{view:'prizepicks'},headers:{'x-monitor-token':token}},res);return res;
 };
 const pending=[];
 try{
  resetProviderProtectionForTests();Date.now=()=>now;
  process.env.SHARP_MONITOR_TOKEN='fixture-monitor';process.env.SPORTS_ODDS_API_KEY='fixture-provider';
  process.env.SPORTS_ODDS_REQUESTS_PER_MINUTE='20';process.env.SPORTS_ODDS_OBJECT_OPTIMIZATION='0';
  delete process.env.SUPABASE_SECRET_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch=async(url,options)=>{
   assert.equal(new URL(url).origin,'https://api.sportsgameodds.com');
   assert.equal(new URL(url).pathname,'/v2/events');assert.equal(options.headers['x-api-key'],'fixture-provider');
   calls++;started();return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({success:true,data:[event()]}),{status:200}));});
  };
  pending.push(invoke(),invoke());await beginning;assert.equal(calls,1);release();
  const results=await Promise.all(pending);
  assert.deepEqual(results.map(r=>r.statusCode),[200,200]);assert.equal(calls,1);
  assert.deepEqual(results.map(r=>r.body.cache.statuses[0]).sort(),['COALESCED','MISS']);
  assert.ok(results.every(r=>r.body.quoteCount===3&&r.headers['Cache-Control']==='private, no-store'));
  assert.equal((await invoke()).body.cache.statuses[0],'HIT');
  assert.equal((await invoke('incorrect')).statusCode,401);assert.equal(calls,1);
 }finally{
  release?.();await Promise.allSettled(pending);globalThis.fetch=previousFetch;Date.now=previousClock;resetProviderProtectionForTests();
  for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];
 }
});
