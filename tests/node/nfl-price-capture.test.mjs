import test from 'node:test';
import assert from 'node:assert/strict';
import {captureNflPrices} from '../../scripts/nfl/price-capture-lib.mjs';
const now='2026-11-16T17:00:00Z';
function fixture(){return {league:'NFL',version:'v2.1',generatedAt:now,oddsProvider:'SportsGameOdds',sourceHealth:{provider:{servedStale:false}},events:[{eventID:'g1',startsAt:'2026-11-16T23:00:00Z',players:[{prop:{playerID:'p1',playerName:'Player One',statID:'receiving_yards',over:{side:'over',oddID:'receiving_yards-p1-game-ou-over',books:{draftkings:{line:45.5,odds:-110,available:true,updatedAt:now}}},under:{side:'under',oddID:'receiving_yards-p1-game-ou-under',books:{draftkings:{line:45.5,odds:-110,available:true,updatedAt:now}}}},candidates:[{playerID:'p1',statID:'receiving_yards',book:'draftkings',line:45.5,side:'over',odds:-110,rawIndependentProbability:.6}]}]}]};}
test('saves exact same-book pair and frozen raw probability separately from no-vig',()=>{
  const capture=captureNflPrices(fixture(),{receivedAt:now});
  assert.equal(capture.records.length,1);
  const row=capture.records[0];
  assert.equal(row.marketOverProbability,.5);
  assert.equal(row.baselineOverProbability,.6);
  assert.equal(row.overUpdatedAt,now);assert.equal(row.underUpdatedAt,now);
  assert.equal(row.productionEligible,false);
  assert.equal(capture.records[0].identity,captureNflPrices(fixture(),{receivedAt:now}).records[0].identity);
});
test('rejects absent opposite, cross-line, missing identity, stale side, stale response, future and poststart evidence',()=>{
  for(const modify of [x=>delete x.events[0].players[0].prop.under,x=>x.events[0].players[0].prop.under.books.draftkings.line=46.5,x=>x.events[0].players[0].prop.playerID=null,x=>x.events[0].players[0].prop.under.books.draftkings.updatedAt='2026-11-16T16:00:00Z',x=>x.sourceHealth.provider.servedStale=true,x=>x.events[0].players[0].prop.over.books.draftkings.updatedAt='2026-11-16T18:00:00Z',x=>x.events[0].startsAt=now]){
    const f=fixture();modify(f);assert.equal(captureNflPrices(f,{receivedAt:now}).records.length,0);
  }
});
test('does not manufacture fixed odds for DFS or exchange contracts',()=>{
  for(const book of ['prizepicks','underdog','kalshi']){
    const f=fixture();for(const side of ['over','under']){f.events[0].players[0].prop[side].books[book]=f.events[0].players[0].prop[side].books.draftkings;delete f.events[0].players[0].prop[side].books.draftkings;}
    assert.equal(captureNflPrices(f,{receivedAt:now}).records.length,0);
  }
});
test('does not silently call unknown player markets or missing availability valid',()=>{
  const f=fixture();f.events[0].players[0].prop.over.books.draftkings.available=null;
  assert.equal(captureNflPrices(f,{receivedAt:now}).records.length,0);
  f.events[0].players[0].prop.over.books.draftkings.available=true;f.events[0].players[0].prop.statID='future_unknown';
  assert.equal(captureNflPrices(f,{receivedAt:now}).records.length,0);
});
test('requires verified source identity and a finite freshness limit',()=>{
  const f=fixture();f.oddsProvider=null;
  assert.equal(captureNflPrices(f,{receivedAt:now}).records.length,0);
  assert.throws(()=>captureNflPrices(fixture(),{receivedAt:now,maxAgeMs:Infinity}),/freshness/);
});
test('rejects cross-player, period or side mismatch and preserves exact odd identities',()=>{
  for(const modify of [p=>p.over.side='under',p=>p.over.oddID='receiving_yards-p2-game-ou-over',p=>p.under.oddID='receiving_yards-p1-1h-ou-under',p=>delete p.over.oddID]){
    const f=fixture();modify(f.events[0].players[0].prop);
    assert.equal(captureNflPrices(f,{receivedAt:now}).records.length,0);
  }
  const row=captureNflPrices(fixture(),{receivedAt:now}).records[0];
  assert.equal(row.overOddID,'receiving_yards-p1-game-ou-over');
  assert.equal(row.underOddID,'receiving_yards-p1-game-ou-under');
});
