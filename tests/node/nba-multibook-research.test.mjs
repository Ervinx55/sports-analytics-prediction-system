import test from 'node:test';
import assert from 'node:assert/strict';
import {researchPropsResponse as rawResearchPropsResponse} from '../../sharp-service/lib/nba-research-props.js';
import {propsResponse} from '../../sharp-service/api/nbaprops.js';
import {normalizeResearch,refreshResearchRow} from '../../sharp-service/research-data.js';
import {assessPropQuote,checkDfsPayout} from '../../sharp-service/prop-price-checks.js';
const researchPropsResponse=options=>rawResearchPropsResponse({...options,optimize:async()=>({blocked:false,effectiveLimit:16})});
const now=Date.parse('2026-11-14T15:00:00Z');
const stamp=new Date(now-30000).toISOString();
const playerID='PLAYER_ONE_1_NBA';
const q=(line=20.5,odds='-110',patch={})=>({overUnder:String(line),odds,available:true,lastUpdatedAt:stamp,...patch});
function event(id='g1'){
 const odds={};
 for(const side of ['over','under'])odds[`points-${playerID}-game-ou-${side}`]={oddID:`points-${playerID}-game-ou-${side}`,playerID,statID:'points',sideID:side,periodID:'game',betTypeID:'ou',byBookmaker:{draftkings:q(),bovada:q(21.5),prizepicks:q(22.5,'+100'),underdog:q(23.5,'+100'),kalshi:q(24.5,'+101')}};
 return {eventID:id,leagueID:'NBA',type:'match',status:{startsAt:'2026-11-14T20:00:00Z'},teams:{home:{teamID:'HOME_NBA',names:{long:'Home'}},away:{teamID:'AWAY_NBA',names:{long:'Away'}}},players:{[playerID]:{playerID,name:'Player One',teamID:'HOME_NBA'}},odds};
}
const page=events=>async()=>({payload:{success:true,data:events},fetchedAt:now,cacheStatus:'MISS'});

test('research requests all eight platforms without changing the default frozen request',async()=>{
 const urls=[];const fetchPage=async r=>{urls.push(new URL(r.url));return page([event()])();};
 const research=await researchPropsResponse({now,key:'test',fetchPage});
 const frozen=await propsResponse({now,key:'test',fetchPage});
 assert.equal(research.status,200);assert.equal(frozen.status,200);
 assert.deepEqual(urls[0].searchParams.get('bookmakerID').split(',').sort(),['bookmakereu','bovada','circa','draftkings','kalshi','pinnacle','prizepicks','underdog']);
 assert.equal(urls[1].searchParams.get('bookmakerID'),'draftkings');
 assert.equal(research.body.productionWeight,0);assert.equal(research.body.productionEligible,false);
 const rows=normalizeResearch(research.body,'NBA',now);
 assert.equal(rows.length,10);assert.equal(new Set(rows.map(r=>r.id)).size,10);
 assert.equal(rows.find(r=>r.book==='bovada').line,21.5);
 assert.ok(rows.every(r=>r.model===null&&r.status==='QUOTE ONLY'));
});
test('integer lines with possible pushes do not display an unconditional no-vig probability',()=>{
 const quote={line:20,odds:-110,available:true,updatedAt:stamp};
 const result=assessPropQuote({book:'bovada',quote,opposite:quote,generatedAt:stamp,now});
 assert.equal(result.marketProbability,null);assert.equal(result.breakEvenProbability,null);assert.match(result.reasons.join(' '),/push/);
});
test('research traffic preserves critical validation budget priority and query bounds',async()=>{
 let request;await researchPropsResponse({now,key:'test',fetchPage:async r=>{request=r;return page([event()])();}});
 assert.equal(request.priority,'background');assert.equal(request.consumer,'nba-research-quotes');assert.equal(request.staleMs,300000);
 const url=new URL(request.url);assert.equal(url.searchParams.get('includeAltLines'),'false');assert.equal(url.searchParams.get('limit'),'16');
});
test('only true same-book sportsbook pairs create a no-vig comparison',async()=>{
 const data=(await researchPropsResponse({now,key:'test',fetchPage:page([event()])})).body;
 const rows=normalizeResearch(data,'NBA',now);
 for(const row of rows){
  if(['draftkings','bovada'].includes(row.book)){assert.equal(row.market,.5);assert.equal(row.priceCheck.status,'COMPARABLE');}
  else {assert.equal(row.market,null);assert.equal(row.odds,null);assert.equal(row.priceCheck.status,'TERMS_MISSING');}
 }
 assert.equal(rows.find(r=>r.book==='prizepicks').platformType,'dfs');
 assert.equal(rows.find(r=>r.book==='kalshi').platformType,'exchange');
});
test('missing opposite, wrong lines and stale or future times cannot establish a sportsbook price comparison',()=>{
 const quote={line:20.5,odds:-110,available:true,updatedAt:stamp};
 for(const patch of [{line:21.5},{available:false},{odds:null},{updatedAt:null},{updatedAt:new Date(now+1).toISOString()},{updatedAt:new Date(now-300001).toISOString()}]){
  const result=assessPropQuote({book:'bovada',quote,opposite:{...quote,...patch},generatedAt:stamp,now});assert.equal(result.marketProbability,null);assert.notEqual(result.status,'COMPARABLE');
 }
 const result=assessPropQuote({book:'bovada',quote,opposite:quote,generatedAt:stamp,now});
 assert.equal(result.marketProbability,.5);assert.ok(Math.abs(result.breakEvenProbability-110/210)<1e-12);
});
test('research rejects bad player bindings, started events and unavailable offers; missing books remain explicit',async()=>{
 const e=event();delete e.odds[`points-${playerID}-game-ou-under`];
 delete e.odds[`points-${playerID}-game-ou-over`].byBookmaker.bovada;
 e.odds[`points-${playerID}-game-ou-over`].byBookmaker.kalshi.available=false;
 const malformed=event('bad');malformed.players[playerID].teamID='OTHER_NBA';
 const started=event('started');started.status.started=true;
 const result=await researchPropsResponse({now,key:'test',fetchPage:page([e,malformed,started])});
 assert.equal(result.body.events.length,1);
 assert.ok(result.body.bookCoverage.missingRequested.includes('bovada'));
 assert.ok(result.body.bookCoverage.missingRequested.includes('kalshi'));
 assert.equal(normalizeResearch(result.body,'NBA',now).length,3);
});
test('research pagination is bounded, deduplicated and honest about partial failures',async()=>{
 let calls=0;const result=await researchPropsResponse({now,key:'test',fetchPage:async()=>{
  calls++;if(calls===2)throw Error('secret provider error');return {payload:{success:true,data:[event()],nextCursor:'next'},fetchedAt:now,cacheStatus:'MISS'};
 }});
 assert.equal(result.status,200);assert.equal(calls,2);assert.equal(result.body.coverage.eventsComplete,false);assert.ok(result.body.coverage.reasons.includes('PAGE_UNAVAILABLE'));assert.ok(!JSON.stringify(result).includes('secret'));
 calls=0;const capped=await researchPropsResponse({now,key:'test',fetchPage:async()=>({payload:{success:true,data:[event()],nextCursor:String(++calls)},fetchedAt:now,cacheStatus:'HIT'})});
 assert.equal(calls,2);assert.equal(capped.body.events.length,1);assert.ok(capped.body.coverage.reasons.includes('PAGE_LIMIT_REACHED'));
});
test('research errors are bounded and unsupported bookmaker requests are rejected before fetching',async()=>{
 let calls=0;const fetchPage=async()=>{calls++;throw Error('secret');};
 assert.equal((await researchPropsResponse({now,key:'test',requestedBooks:['unknown'],fetchPage})).status,400);assert.equal(calls,0);
 assert.equal((await researchPropsResponse({now,key:'',fetchPage})).status,503);assert.equal(calls,0);
 assert.equal((await researchPropsResponse({now,key:'test',fetchPage})).status,503);assert.equal(calls,1);
});
test('aging a multi-book row removes a formerly comparable price without changing stored observations',async()=>{
 const body=(await researchPropsResponse({now,key:'test',fetchPage:page([event()])})).body;
 const original=normalizeResearch(body,'NBA',now).find(r=>r.book==='bovada');
 const aged=refreshResearchRow(original,now+301000);
 assert.equal(original.market,.5);assert.equal(aged.market,null);assert.notEqual(aged.priceCheck.status,'COMPARABLE');
});
test('DFS worksheets require full actual payout terms and never turn indicative +100 into 50 percent',()=>{
 const base={book:'prizepicks',mode:'all_or_nothing',stake:10,picks:2,multipliers:[0,0,3],termsReviewed:true};
 const r=checkDfsPayout(base);assert.equal(r.status,'USER_ENTERED');assert.equal(r.netReturns[2],20);assert.equal(r.netReturns[0],-10);assert.equal(r.allHitBreakEven,1/3);assert.equal(r.expectedValue,null);assert.equal(r.productionEligible,false);
 for(const patch of [{termsReviewed:false},{multipliers:[0,null,3]},{stake:0},{multipliers:[0,-1,3]},{multipliers:[0,1,3]},{picks:3},{multipliers:[0,0,'3']}])assert.equal(checkDfsPayout({...base,...patch}).status,'INCOMPLETE');
 const flex=checkDfsPayout({...base,book:'underdog',mode:'flex',multipliers:[0,.5,2]});assert.equal(flex.status,'USER_ENTERED');assert.equal(flex.netReturns[1],-5);assert.equal(flex.allHitBreakEven,null);assert.equal(flex.expectedValue,null);
});
test('NBA expansion preserves the same six-minute freshness behavior for existing NFL sportsbooks',()=>{
 const updatedAt=new Date(now-360000).toISOString();
 const books={draftkings:{line:20.5,odds:-110,available:true,updatedAt},fanduel:{line:20.5,odds:-110,available:true,updatedAt}};
 const data={generatedAt:stamp,candidates:[],events:[{eventID:'nfl',startsAt:'2026-11-14T20:00:00Z',players:[{prop:{playerID:'p',playerName:'Player',statID:'yards',over:{books},under:{books}}}]}]};
 const rows=normalizeResearch(data,'NFL',now);assert.equal(rows.length,4);assert.ok(rows.every(r=>r.freshness==='CURRENT'&&r.market===.5));
});
test('arrays booleans objects and whitespace cannot become real lines or American odds',async()=>{
 for(const value of [[20.5],true,{},' ']){
  const e=event();for(const o of Object.values(e.odds))o.byBookmaker={bovada:q(20.5,'-110',{overUnder:value})};
  const body=(await researchPropsResponse({now,key:'test',fetchPage:page([e])})).body;assert.equal(body.events.length,0,JSON.stringify(value));
 }
 for(const value of [[-110],true,{},' ']){
  const e=event();for(const o of Object.values(e.odds))o.byBookmaker={bovada:q(20.5,value)};
  const body=(await researchPropsResponse({now,key:'test',fetchPage:page([e])})).body;
  assert.ok(normalizeResearch(body,'NBA',now).every(r=>r.odds===null&&r.market===null),JSON.stringify(value));
 }
});
test('coverage counts fresh DFS and exchange lines while keeping execution readiness separate',async()=>{
 const body=(await researchPropsResponse({now,key:'test',fetchPage:page([event()])})).body;
 const books=Object.fromEntries(body.bookCoverage.books.map(row=>[row.id,row]));
 for(const id of ['prizepicks','underdog','kalshi']){assert.equal(books[id].availableQuoteSides,2);assert.equal(books[id].freshQuoteSides,2);assert.equal(books[id].comparablePriceSides,0);}
 assert.equal(books.bovada.comparablePriceSides,2);
});


test('sharp books use the existing strict research contract and exact opposing lines',async()=>{
 const e=event();for(const side of ['over','under'])Object.assign(e.odds[`points-${playerID}-game-ou-${side}`].byBookmaker,{pinnacle:q(),circa:q(21.5),bookmakereu:q()});
 const r=await researchPropsResponse({now,key:'test',fetchPage:page([e])});
 const rows=normalizeResearch(r.body,'NBA',now);
 for(const book of ['pinnacle','circa','bookmakereu']){
  const subset=rows.filter(r=>r.book===book);assert.equal(subset.length,2);assert.ok(subset.every(r=>r.priceCheck.status==='COMPARABLE'&&r.market===.5&&r.model===null));
 }
 assert.equal(r.body.productionEligible,false);
});
test('research quota exhaustion makes no quote requests',async()=>{
 let calls=0;const r=await rawResearchPropsResponse({key:'test',optimize:async()=>({blocked:true}),fetchPage:async()=>{calls++;}});
 assert.equal(r.status,429);assert.equal(calls,0);assert.equal(r.body.productionWeight,0);
});
test('research quota optimizer bounds page size and includes two-page fanout',async()=>{
 let policy,request;const r=await rawResearchPropsResponse({now,key:'test',optimize:async p=>{policy=p;return {blocked:false,effectiveLimit:2};},fetchPage:async p=>{request=p;return page([])();}});
 assert.equal(r.status,200);assert.equal(policy.fanout,2);assert.equal(policy.priority,'background');assert.equal(new URL(request.url).searchParams.get('limit'),'2');assert.equal(request.objectPolicy.effectiveLimit,2);
});
