import test from 'node:test';
import assert from 'node:assert/strict';
import {collectWinnerSpreadQuotes,WINNER_SPREAD_ODD_IDS} from '../../sharp-service/lib/winner-spread-quotes.js';

const issuedAt='2026-11-18T20:00:00.000Z';
const event={sport:'NBA',eventID:'espn:1',startsAt:'2026-11-19T00:30:00.000Z',identityVerified:true,status:'SCHEDULED',sourceIds:{sgo:'sgo1'}};
const source={source_hash:'a'.repeat(64),source_url:'https://api.sportsgameodds.com/v2/events?leagueID=NBA',fetched_at:'2026-11-18T19:59:50.000Z'};
function fixture(){return {event,source,issuedAt,books:['draftkings','fanduel'],raw:{eventID:'sgo1',leagueID:'NBA',type:'match',status:{startsAt:event.startsAt},odds:{
 'points-home-game-sp-home':{oddID:'points-home-game-sp-home',periodID:'game',bookSpread:-4.5,byBookmaker:{draftkings:{available:true,odds:'-110',spread:'-4.5',lastUpdatedAt:'2026-11-18T19:59:00.000Z'}}},
 'points-away-game-sp-away':{oddID:'points-away-game-sp-away',periodID:'game',bookSpread:4.5,byBookmaker:{draftkings:{available:true,odds:'-110',spread:'+4.5',lastUpdatedAt:'2026-11-18T19:58:00.000Z'}}}
}}};}
const home=b=>b.raw.odds[WINNER_SPREAD_ODD_IDS[0]],away=b=>b.raw.odds[WINNER_SPREAD_ODD_IDS[1]];
test('exact same-book spread pairs retain source receipt and only price evidence',()=>{
 const b=fixture(),before=structuredClone(b),r=collectWinnerSpreadQuotes(b);
 assert.deepEqual(b,before);assert.equal(r.pairs.length,1);assert.equal(r.pairedPriceEligible,true);
 assert.equal(r.pairs[0].homeLine,-4.5);assert.equal(r.pairs[0].awayLine,4.5);assert.equal(r.pairs[0].homeOdds,-110);
 assert.equal(r.pairs[0].sourceHash,source.source_hash);assert.equal(r.pairs[0].fetchedAt,source.fetched_at);
 assert.equal(r.pairs[0].eventID,event.eventID);assert.equal(r.pairs[0].period,'FULL_GAME');
 assert.equal(r.purpose,'PRICE_EVIDENCE_ONLY');assert.equal(r.coverProbabilityAvailable,false);assert.equal(r.productionEligible,false);
 assert.equal(JSON.stringify(r).includes('NoVig'),false);assert.equal('homeProbability' in r,false);
 for(const line of [0,-3,2.5]){home(b).byBookmaker.draftkings.spread=line;away(b).byBookmaker.draftkings.spread=-line;assert.equal(collectWinnerSpreadQuotes(b).pairs.length,1);}
});
test('mixed, missing and unsupported handicaps never use aggregate or other-book lines',()=>{
 for(const change of [b=>away(b).byBookmaker.draftkings.spread=5.5,b=>delete home(b).byBookmaker.draftkings.spread,b=>home(b).byBookmaker.draftkings.spread=null,b=>home(b).byBookmaker.draftkings.spread='',b=>home(b).byBookmaker.draftkings.spread=false,b=>{home(b).byBookmaker.draftkings.spread=-4.25;away(b).byBookmaker.draftkings.spread=4.25;}]){
  const b=fixture();change(b);const r=collectWinnerSpreadQuotes(b);assert.equal(r.pairs.length,0);assert.ok(r.reasons.includes('SPREAD_LINE_INVALID_OR_NOT_OPPOSITE'));
 }
 const b=fixture();away(b).byBookmaker.fanduel=away(b).byBookmaker.draftkings;delete away(b).byBookmaker.draftkings;
 const r=collectWinnerSpreadQuotes(b);assert.equal(r.pairs.length,0);assert.equal(r.oneSidedBooks,2);assert.ok(r.reasons.includes('SPREAD_ONE_SIDED_BOOK'));
});
test('stale, future, unpaired timestamps and post-start receipts fail closed',()=>{
 for(const change of [b=>home(b).byBookmaker.draftkings.lastUpdatedAt='2026-11-18T19:54:59.999Z',b=>home(b).byBookmaker.draftkings.lastUpdatedAt='2026-11-18T19:59:51.000Z',b=>delete home(b).byBookmaker.draftkings.lastUpdatedAt,b=>away(b).byBookmaker.draftkings.lastUpdatedAt='2026-11-18T19:56:59.999Z',b=>b.source={...source,fetched_at:'2026-11-18T20:00:01.000Z'},b=>b.source={...source,fetched_at:'2026-11-18T19:54:59.999Z'},b=>{b.issuedAt=event.startsAt;b.source={...source,fetched_at:event.startsAt};}]){
  const b=fixture();change(b);assert.equal(collectWinnerSpreadQuotes(b).pairs.length,0);
 }
 const b=fixture();home(b).byBookmaker.draftkings.lastUpdatedAt='2026-11-18T19:57:00.000Z';away(b).byBookmaker.draftkings.lastUpdatedAt='2026-11-18T19:55:00.000Z';assert.equal(collectWinnerSpreadQuotes(b).pairs.length,1);
});
test('identity, period, availability, American odds and overround are validated',()=>{
 for(const change of [b=>b.raw.eventID='other',b=>b.raw.leagueID='NFL',b=>b.raw.status.startsAt='2026-11-19T00:31:00.000Z',b=>b.raw.status.started=true,b=>home(b).periodID='reg',b=>home(b).oddID=WINNER_SPREAD_ODD_IDS[1],b=>home(b).ended=true,b=>home(b).byBookmaker.draftkings.available=false,b=>home(b).byBookmaker.draftkings.odds=0,b=>home(b).byBookmaker.draftkings.odds='bad',b=>home(b).byBookmaker.draftkings.odds=1e9,b=>home(b).byBookmaker.draftkings.odds=-500,b=>b.source={...source,source_hash:'bad'},b=>b.source={...source,source_url:'http://insecure.test'}]){
  const b=fixture();change(b);assert.equal(collectWinnerSpreadQuotes(b).pairs.length,0);
 }
});
