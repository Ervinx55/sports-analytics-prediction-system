import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeResearch,filterResearch,refreshResearchRow} from '../../sharp-service/research-data.js';
const now=Date.parse('2026-10-25T18:00:00Z');
const nba={generatedAt:'2026-10-25T17:59:00Z',events:[{eventID:'g',startsAt:'2026-10-25T20:00:00Z',matchup:{home:{name:'Home'},away:{name:'Away'}},players:[{prop:{playerName:'Player',statID:'points',over:{books:{A:{line:20.5,odds:-110,updatedAt:'2026-10-25T17:59:00Z'},B:{line:21.5,odds:100,updatedAt:'2026-10-25T17:59:00Z'}}},under:{books:{A:{line:20.5,odds:-110,updatedAt:'2026-10-25T17:59:00Z'}}}}}]}]};
test('NBA keeps exact book line and side identity without inventing predictions',()=>{const rows=normalizeResearch(nba,'NBA',now);assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.id)).size,3);assert.ok(rows.every(r=>r.model===null&&r.status==='QUOTE ONLY'));assert.equal(rows[0].player,'Player');});
test('NFL uses independent probability in shadow, never promotes source PLAY',()=>{const rows=normalizeResearch({generatedAt:nba.generatedAt,candidates:[{eventID:'g',startsAt:'2026-10-25T20:00:00Z',playerName:'QB',statID:'yards',side:'OVER',line:200.5,bestBook:'A',bestOdds:-110,rawIndependentProbability:.6,modelProbability:.9,marketFairProbability:.52,status:'PLAY',updatedAt:nba.generatedAt}]},'NFL',now);assert.equal(rows[0].model,.6);assert.equal(rows[0].market,.52);assert.equal(rows[0].status,'SHADOW');});
test('unknown, future and old quote timestamps do not appear fresh',()=>{for(const stamp of [null,'bad','2026-10-25T18:05:00Z','2026-10-25T17:00:00Z']){const data=structuredClone(nba);data.events[0].players[0].prop.over.books.A.updatedAt=stamp;assert.notEqual(normalizeResearch(data,'NBA',now)[0].freshness,'CURRENT');}});
test('expired events and malformed contracts cannot become recommendations',()=>{const data=structuredClone(nba);data.events[0].startsAt='2026-10-25T17:00:00Z';assert.deepEqual(normalizeResearch(data,'NBA',now),[]);assert.throws(()=>normalizeResearch({error:'failure'},'NBA',now));assert.throws(()=>normalizeResearch({},'NBA',now));});
test('filters narrow exact quotes and null numeric values remain unavailable',()=>{const rows=normalizeResearch(nba,'NBA',now);assert.equal(filterResearch(rows,{query:'player',book:'A',market:'points'}).length,2);const data=structuredClone(nba);data.events[0].players[0].prop.over.books.A.odds=null;assert.equal(normalizeResearch(data,'NBA',now)[0].odds,null);});

test('NFL retains unmodeled quotes and joins estimates only to exact quote identity',()=>{
 const data=structuredClone(nba);data.candidates=[];
 assert.equal(normalizeResearch(data,'NFL',now).length,3);
 data.candidates=[{eventID:'g',startsAt:'2026-10-25T20:00:00Z',playerName:'Player',statID:'points',side:'over',line:20.5,book:'A',odds:-110,rawIndependentProbability:.6,marketFairProbability:.5}];
 const rows=normalizeResearch(data,'NFL',now);assert.equal(rows.filter(r=>r.model===.6).length,1);assert.equal(rows.find(r=>r.book==='B').model,null);assert.equal(rows.find(r=>r.side==='UNDER').model,null);
});

test('explicitly unavailable NFL prices cannot be shortlisted as available quotes',()=>{const data=structuredClone(nba);data.candidates=[];data.events[0].players[0].prop.over.books.A.available=false;assert.equal(normalizeResearch(data,'NFL',now).length,2);});

test('research derives market probability only from a fresh same-book exact-line pair',()=>{
 const rows=normalizeResearch(nba,'NBA',now);
 assert.equal(rows.find(r=>r.book==='A'&&r.side==='OVER').market,.5);
 assert.equal(rows.find(r=>r.book==='A'&&r.side==='UNDER').market,.5);
 assert.equal(rows.find(r=>r.book==='B').market,null);
 assert.ok(rows.every(r=>r.model===null));
});
test('stale unavailable mismatched and invalid opposite quotes do not establish market probability',()=>{
 for(const patch of [{line:21.5},{available:false},{odds:0},{odds:null},{updatedAt:'2026-10-25T17:00:00Z'}]){
  const data=structuredClone(nba);Object.assign(data.events[0].players[0].prop.under.books.A,patch);
  assert.equal(normalizeResearch(data,'NBA',now).find(r=>r.book==='A'&&r.side==='OVER').market,null);
 }
});

test('context evidence travels with NBA and NFL quotes without becoming a probability',()=>{
 const data=structuredClone(nba);
 data.events[0].players[0].context={version:'nba-prop-context-v1',baselineProjection:21,productionWeight:0};
 let rows=normalizeResearch(data,'NBA',now);
 assert.equal(rows[0].context.baselineProjection,21);assert.equal(rows[0].model,null);
 delete data.events[0].players[0].context;
 data.events[0].players[0].opportunity={player:{position:'WR'},context:{version:'nfl-prop-context-v1',productionWeight:0}};
 data.candidates=[];
 rows=normalizeResearch(data,'NFL',now);
 assert.equal(rows[0].context.version,'nfl-prop-context-v1');assert.equal(rows[0].position,'WR');assert.equal(rows[0].model,null);
});

test('aging quotes lose market comparison without mutating the saved observation',()=>{
 const original=normalizeResearch(nba,'NBA',now)[0];
 assert.equal(original.market,.5);
 const aged=refreshResearchRow(original,now+11*60_000);
 assert.equal(aged.freshness,'STALE');assert.equal(aged.market,null);assert.equal(original.market,.5);
 assert.equal(refreshResearchRow(original,now).market,.5);
});

test('market comparison expires when its older opposite side expires',()=>{
 const data=structuredClone(nba);
 data.events[0].players[0].prop.under.books.A.updatedAt='2026-10-25T17:51:00Z';
 const row=normalizeResearch(data,'NBA',now).find(r=>r.side==='OVER'&&r.book==='A');
 assert.equal(row.market,.5);
 const aged=refreshResearchRow(row,now+2*60_000);
 assert.equal(aged.freshness,'CURRENT');assert.equal(aged.market,null);
});
