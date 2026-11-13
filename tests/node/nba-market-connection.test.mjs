import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNbaGames} from '../../sharp-service/lib/nba-vnext-baseline.js';
const asOf='2026-11-13T12:00:00Z',startsAt='2026-11-14T01:00:00Z';
const historicalGames=Array.from({length:8},(_,i)=>({eventId:`old${i}`,startsAt:`2026-11-${String(i+1).padStart(2,'0')}T01:00:00Z`,home:'NY',away:'WSH',homeScore:110,awayScore:100,completed:true}));
const upcomingGames=[{eventId:'espn1',startsAt,home:'NY',away:'WSH',completed:false}];
const quote=(odds,updatedAt='2026-11-13T11:59:00Z')=>({odds:String(odds),line:null,available:true,updatedAt});
const event=()=>({eventID:'sgo1',league:'NBA',startsAt,status:{started:false,live:false,completed:false},matchup:{home:{short:'NYK'},away:{short:'WAS'}},markets:{moneyline:{home:{books:{pinnacle:quote(-150),circa:quote(-150),bookmakereu:quote(-150),draftkings:quote(-120),unknown:quote(500)}},away:{books:{pinnacle:quote(150),circa:quote(150),bookmakereu:quote(150),draftkings:quote(100)}}}}});
const run=events=>projectNbaGames({historicalGames,upcomingGames,asOf,historyComplete:true,marketBoard:{fetchedAt:asOf,events}});
// The real board uses SGO IDs and NYK/WAS; forecasts use ESPN IDs and NY/WSH.
test('live two-sided prices attach across provider IDs without changing independent predictions',()=>{
 const before=projectNbaGames({historicalGames,upcomingGames,asOf,historyComplete:true});
 const report=run([event()]),row=report.rows[0];
 assert.equal(row.market?.eventID,'sgo1');assert.equal(row.market.homeFairProbability,.6);
 assert.equal(row.homeWinProbability,before.rows[0].homeWinProbability);
 assert.equal(row.market.homeBest.book,'draftkings');assert.equal(row.market.homeBest.odds,-120);
 assert.ok(!row.reasons.includes('NO_BOOK_QUOTE'));assert.ok(row.reasons.includes('UNCALIBRATED'));
 assert.ok(row.reasons.includes('NO_INJURY_ROTATION_ADJUSTMENT'));
 assert.equal(report.productionEligible,false);assert.equal(report.automaticBuyEnabled,false);
 assert.equal(report.evaluationSummary.matchedGames,1);
});
test('ranked winner forecasts and price comparisons are separate research outputs',()=>{
 const report=run([event()]);
 assert.equal(report.rankings?.winners?.[0]?.team,'NY');
 assert.equal(report.rankings?.value?.length,2);
 assert.equal(report.rankings.value[0].book,'draftkings');
 assert.equal(report.rankings.value[0].selection,'NY');
 assert.equal(report.rankings.value[0].status,'RESEARCH_ONLY');
 assert.ok(report.rankings.value[0].modelExpectedReturn>report.rankings.value[1].modelExpectedReturn);
});
test('stale, future, unavailable and unpaired sharp quotes cannot clear the price blocker',()=>{
 for(const change of [q=>q.updatedAt='2026-11-13T10:00:00Z',q=>q.updatedAt='2026-11-13T12:05:00Z',q=>q.available=false,q=>q.odds=null]){
  const e=event();for(const b of ['pinnacle','circa','bookmakereu'])change(e.markets.moneyline.away.books[b]);
  const row=run([e]).rows[0];assert.equal(row.market?.homeFairProbability,null);
  assert.ok(row.reasons.includes('NO_FRESH_SHARP_PAIR'));
 }
});
test('ambiguous, reversed, started and different-day events never receive model probabilities',()=>{
 const good=event(),other={...event(),eventID:'another'};
 for(const events of [[good,other],[{...good,matchup:{home:{short:'WAS'},away:{short:'NYK'}}}],[{...good,status:{started:true}}],[{...good,startsAt:'2026-11-15T01:00:00Z'}]]){
  const report=run(events);assert.equal(report.evaluationSummary?.matchedGames,0);
  assert.equal(report.rankings?.value?.length,0);
 }
});
test('one fresh sharp book is identified as a single reference rather than consensus',()=>{
 const e=event();delete e.markets.moneyline.away.books.circa;delete e.markets.moneyline.away.books.bookmakereu;
 const row=run([e]).rows[0];assert.equal(row.market?.referenceStatus,'SINGLE_SHARP_REFERENCE');
 assert.equal(row.market.referenceBooks.length,1);assert.ok(row.reasons.includes('SINGLE_SHARP_REFERENCE'));
});
