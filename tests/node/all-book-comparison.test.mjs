import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGameResearch,compareResearchPrices} from '../../sharp-service/research-comparison.js';
import {platformType,canonicalBookmaker} from '../../sharp-service/book-catalog.js';
import {refreshResearchRow} from '../../sharp-service/research-data.js';
import {normalizeTheOddsApiBoard} from '../../sharp-service/lib/the-odds-api-provider.js';
import {normalizeSharpApiBoardRows} from '../../sharp-service/lib/sharpapi-provider.js';
import {boardPriority} from '../../sharp-service/api/board.js';
test('game research cannot consume the protected live-decision request reserve',()=>{
 assert.equal(boardPriority('true',null,{research:true}),'background');
 assert.equal(boardPriority('true',null),'critical');
});
const now=Date.parse('2026-11-14T15:00:00Z'),stamp=new Date(now-10000).toISOString();
const price=(odds=-110,line=null)=>({odds,line,available:true,updatedAt:stamp});
const side=(name,books,market='ml',period='game',entity=name)=>({oddID:`points-${entity}-${period}-${market}-${name}`,books});
function board(){return {fetchedAt:stamp,providerObservations:[{league:'NBA',provider:'SportsGameOdds',fetchedAt:stamp,eventsComplete:true}],events:[{eventID:'game',league:'NBA',sport:'BASKETBALL',startsAt:'2026-11-14T20:00:00Z',status:{},matchup:{home:{id:'H',name:'Home'},away:{id:'A',name:'Away'}},markets:{moneyline:{home:side('home',{draftkings:price(110),pinnacle:price(-110),circa:price(-110)}),away:side('away',{draftkings:price(-130),pinnacle:price(-110),circa:price(-110)})}}}]};}
test('catalog aliases and platform types remain explicit',()=>{
 assert.equal(canonicalBookmaker('Bookmaker.eu'),'bookmakereu');
 assert.equal(platformType('fanduel'),'sportsbook');assert.equal(platformType('sleeper'),'dfs');
 assert.equal(platformType('novig'),'exchange');assert.equal(platformType('newunknown'),'unknown');
});
test('games compare exact selections, best observed prices and leave target out of reference',()=>{
 const rows=normalizeGameResearch(board(),'NBA',now),comparisons=compareResearchPrices(rows,now);
 assert.equal(rows.length,6);
 const row=rows.find(r=>r.book==='draftkings'&&r.side==='HOME'),c=comparisons.get(row.id);
 assert.equal(c.best,true);assert.equal(c.eligibleBooks,3);assert.equal(c.referenceProbability,.5);
 assert.equal(c.referenceBooks.length,2);assert.ok(!c.referenceBooks.includes('draftkings'));
 assert.equal(row.model,null);assert.equal(row.productionEligible,false);
 assert.equal(comparisons.get(rows.find(r=>r.book==='pinnacle').id).referenceProbability,null);
});
test('source fetch time, complete outcomes, explicit availability and exact periods are required',()=>{
 for(const change of [
  d=>d.providerObservations=[],
  d=>d.providerObservations[0].fetchedAt=new Date(now-300001).toISOString(),
  d=>d.providerObservations[0].fetchedAt=new Date(now+1).toISOString(),
  d=>delete d.events[0].markets.moneyline.away.books.draftkings,
  d=>d.events[0].markets.moneyline.away.books.draftkings.available=false,
  d=>d.events[0].markets.moneyline.away.oddID='points-away-reg-ml-away',
 ]){
  const data=board();change(data);const rows=normalizeGameResearch(data,'NBA',now);
  const r=rows.find(r=>r.book==='draftkings'&&r.side==='HOME');
  assert.equal(r.market,null);assert.equal(compareResearchPrices(rows,now).get(r.id).best,false);
 }
 const row=normalizeGameResearch(board(),'NBA',now)[0];
 assert.equal(refreshResearchRow(row,now+300001).market,null);
});
test('three-way markets require draw and cannot mix into two-way references',()=>{
 const d=board(),m=d.events[0].markets;
 m.threeWay={home:side('home',{draftkings:price(110)},'ml3way','reg'),away:side('away',{draftkings:price(150)},'ml3way','reg')};
 let r=normalizeGameResearch(d,'NBA',now).find(r=>r.marketType==='threeWay');assert.equal(r.market,null);
 m.threeWay.draw=side('draw',{draftkings:price(250)},'ml3way','reg','all');
 const rows=normalizeGameResearch(d,'NBA',now);r=rows.find(r=>r.marketType==='threeWay');
 assert.ok(r.market>0);assert.equal(compareResearchPrices(rows,now).get(r.id).eligibleBooks,1);
});
test('draw-capable two-way moneylines cannot imply an unconditional win probability',()=>{
 const d=board();d.events[0].league='NFL';d.providerObservations[0].league='NFL';
 assert.ok(normalizeGameResearch(d,'NFL',now).every(r=>r.market===null));
 for(const side of Object.values(d.events[0].markets.moneyline))side.oddID=side.oddID.replace('-game-','-reg-');
 d.events[0].league='NBA';d.providerObservations[0].league='NBA';
 assert.ok(normalizeGameResearch(d,'NBA',now).every(r=>r.market===null));
});
test('fallback provider quotes stay visible while unverified period is withheld from comparisons',()=>{
 const startsAt='2026-11-14T20:00:00Z';
 const theOdds=normalizeTheOddsApiBoard([{id:'o1',sport_title:'NBA',sport_key:'basketball_nba',home_team:'Home',away_team:'Away',commence_time:startsAt,bookmakers:[{key:'fanduel',markets:[{key:'h2h',last_update:stamp,outcomes:[{name:'Home',price:-110},{name:'Away',price:-110}]}]}]}],{league:'NBA',now});
 const sharp=normalizeSharpApiBoardRows(['home','away'].map(side=>({event_id:'s1',event_start_time:startsAt,sportsbook:'fanduel',league:'NBA',sport:'basketball',home_team:'Home',away_team:'Away',market_type:'moneyline',selection_type:side,odds_american:-110,timestamp:stamp})),{league:'NBA',now});
 for(const [events,provider] of [[theOdds,'The Odds API'],[sharp,'SharpAPI']]){
  assert.ok(events.length>0);
  const rows=normalizeGameResearch({events,source:provider,providerObservations:[{league:'NBA',provider,fetchedAt:stamp}]},'NBA',now);
  assert.equal(rows.length,2);assert.ok(rows.every(r=>r.period==='unverified'&&r.market===null));
  assert.ok([...compareResearchPrices(rows,now).values()].every(c=>c.eligibleBooks===0));
 }
});
test('spread opposites must negate, totals must match, integer lines withhold unconditional chance',()=>{
 for(const [kind,bet,sides,lines] of [['spread','sp',['home','away'],[-3.5,3.5]],['total','ou',['over','under'],[220.5,220.5]]]){
  const d=board(),m=d.events[0].markets={};
  m[kind]=Object.fromEntries(sides.map((s,i)=>[s,side(s,{draftkings:price(-110,lines[i])},bet,'game',kind==='total'?'all':s)]));
  assert.ok(normalizeGameResearch(d,'NBA',now).every(r=>r.market===.5));
  m[kind][sides[1]].books.draftkings.line++;
  assert.ok(normalizeGameResearch(d,'NBA',now).every(r=>r.market===null));
  for(const [i,s] of sides.entries())m[kind][s].books.draftkings.line=kind==='spread'?(i?3:-3):220;
  assert.ok(normalizeGameResearch(d,'NBA',now).every(r=>r.market===null));
 }
});
test('unknown/DFS/exchange prices and malformed lines do not enter sportsbook comparisons',()=>{
 const d=board();for(const s of Object.values(d.events[0].markets.moneyline))for(const b of ['unknown','prizepicks','kalshi'])s.books[b]=price(1000);
 const rows=normalizeGameResearch(d,'NBA',now),c=compareResearchPrices(rows,now);
 for(const r of rows.filter(r=>['unknown','prizepicks','kalshi'].includes(r.book))){assert.equal(r.market,null);assert.equal(c.get(r.id).best,false);}
 for(const v of [true,[],{},'']){const x=board();x.events[0].markets.moneyline.home.books.draftkings.odds=v;assert.equal(normalizeGameResearch(x,'NBA',now).find(r=>r.side==='HOME'&&r.book==='draftkings').market,null);}
});
test('duplicate aliases, different lines, periods and games cannot inflate comparisons',()=>{
 const rows=normalizeGameResearch(board(),'NBA',now);
 const original=rows.find(r=>r.side==='HOME');
 const other={...original,id:'other',eventID:'other',book:'fanduel',odds:200};
 const a={...original,id:'alias-a',book:'bookmaker',odds:110};
 const b={...original,id:'alias-b',book:'bookmaker.eu',odds:110};
 const comparisons=compareResearchPrices([...rows,other,a,b],now);
 assert.equal(comparisons.get(original.id).eligibleBooks,4);
 assert.equal(comparisons.get(other.id).eligibleBooks,1);
 assert.equal(comparisons.get(original.id).best,true);
 assert.equal(compareResearchPrices(rows,now+300001).get(original.id).eligibleBooks,0);
});
