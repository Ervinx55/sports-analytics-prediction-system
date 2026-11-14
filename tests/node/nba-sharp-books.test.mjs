import test from 'node:test';
import assert from 'node:assert/strict';
import {directSgoProps} from '../../sharp-service/lib/nba-direct-props.js';
const now='2026-11-14T00:00:00Z';
const q=(line,odds=-110)=>({overUnder:line,odds,lastUpdatedAt:now,available:true});
const event={eventID:'e',leagueID:'NBA',type:'match',status:{startsAt:'2026-11-15T00:00:00Z'},players:{p:{playerID:'p',name:'Player'}},odds:{
 over:{playerID:'p',statID:'points',periodID:'game',betTypeID:'ou',sideID:'over',oddID:'points-p-game-ou-over',byBookmaker:{draftkings:q(20.5),pinnacle:q(20.5,-105),circa:q(21.5),bookmakereu:q(20.5,-115),prizepicks:q(20.5,null),unknown:q(20.5)}},
 under:{playerID:'p',statID:'points',periodID:'game',betTypeID:'ou',sideID:'under',oddID:'points-p-game-ou-under',byBookmaker:{draftkings:q(20.5),pinnacle:q(20.5,-115),circa:q(21.5),bookmakereu:q(20.5,-105)}}}};
test('requests sharp books together, preserving book prices and distinct lines',async()=>{
 let params;const body=await directSgoProps({clock:()=>now,page:async p=>{params=p;return {events:[event],observedAt:now};}});
 assert.equal(params.bookmakerID,'pinnacle,circa,bookmakereu,draftkings,prizepicks');
 const rows=body.events[0].players.map(p=>p.prop);
 assert.equal(rows.length,2);
 const line20=rows.find(p=>p.over.books.pinnacle);
 assert.deepEqual(Object.keys(line20.over.books).sort(),['bookmakereu','draftkings','pinnacle']);
 assert.equal(line20.over.books.pinnacle.odds,-105);
 assert.equal(line20.under.books.pinnacle.odds,-115);
 assert.equal(rows.find(p=>p.over.books.circa).over.books.circa.line,21.5);
 assert.equal(body.coverage.bookmakerCoverage.prizepicks.status,'LINE_ONLY');
 assert.equal(body.comparisonLines[0].book,'prizepicks');
});
test('missing bookmakers are explicitly not observed, not claimed available',async()=>{
 const body=await directSgoProps({clock:()=>now,page:async()=>({events:[],observedAt:now})});
 assert.deepEqual(body.coverage.observedBookmakers,[]);
 assert.equal(body.coverage.bookmakerCoverage.pinnacle.status,'NOT_OBSERVED');
});

import {propsResponse} from '../../sharp-service/api/nbaprops.js';
test('object quota exhaustion prevents quote calls without changing eligibility',async()=>{
 let calls=0;const r=await propsResponse({key:'test',optimize:async()=>({blocked:true,effectiveLimit:0}),fetchPage:async()=>{calls++;}});
 assert.equal(calls,0);assert.equal(r.status,429);assert.equal(r.body.productionEligible,false);
});
test('object quota caps page size and accounts for both pages',async()=>{
 let request,policy;const r=await propsResponse({now:Date.parse(now),key:'test',optimize:async p=>{policy=p;return {blocked:false,effectiveLimit:2,pressure:'HIGH'};},fetchPage:async p=>{request=p;return {payload:{success:true,data:[]},fetchedAt:Date.parse(now),cacheStatus:'HIT'};}});
 assert.equal(r.status,200);assert.equal(policy.fanout,2);assert.equal(new URL(request.url).searchParams.get('limit'),'2');assert.equal(request.objectPolicy.pressure,'HIGH');
});
