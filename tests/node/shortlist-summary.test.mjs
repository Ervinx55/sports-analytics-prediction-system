import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeShortlist} from '../../sharp-service/shortlist-summary.js';

const now=Date.parse('2026-11-16T20:00:00Z');
const row=(overrides={})=>({id:'pinnacle-over',sport:'NBA',eventID:'game-a',startsAt:'2026-11-17T00:00:00Z',away:'Away',home:'Home',playerID:'PLAYER_NBA',player:'Player One',marketType:'points',side:'OVER',line:20.5,book:'pinnacle',...overrides});

test('the same selection at two books is one selection, not two independent legs',()=>{
 const result=summarizeShortlist([row(),row({id:'circa-over',book:'circa'})],now);
 assert.equal(result.quoteCount,2);assert.equal(result.selectionCount,1);assert.equal(result.gameCount,1);
 assert.equal(result.repeatedSelections.length,1);assert.deepEqual(result.repeatedSelections[0].books,['pinnacle','circa']);
 assert.equal(result.sharedGames.length,0);
});

test('a winner and player prop from the same event share one game despite different views',()=>{
 const result=summarizeShortlist([row(),row({id:'winner',kind:'games',player:'Home',playerID:'',participant:'HOME_NBA',marketType:'moneyline',period:'game',outcomeStructure:'ml',side:'HOME',line:null})],now);
 assert.equal(result.selectionCount,2);assert.equal(result.gameCount,1);
 assert.equal(result.sharedGames.length,1);assert.equal(result.sharedGames[0].selectionCount,2);
});

test('side, threshold, period, structure and participant remain separate selections',()=>{
 const rows=[row(),row({id:'under',side:'UNDER'}),row({id:'line',line:21.5}),row({id:'period',period:'reg'}),row({id:'structure',outcomeStructure:'other'}),row({id:'player',playerID:'OTHER_NBA',player:'Player Two'})];
 const result=summarizeShortlist(rows,now);
 assert.equal(result.selectionCount,6);assert.equal(result.repeatedSelections.length,0);
 assert.equal(result.sharedGames[0].selectionCount,6);
});

test('different dates, events and leagues do not merge into one game',()=>{
 const result=summarizeShortlist([row(),row({id:'other-event',eventID:'game-b'}),row({id:'other-league',sport:'NFL'}),row({id:'other-date',startsAt:'2026-11-18T00:00:00Z'})],now);
 assert.equal(result.gameCount,4);assert.equal(result.sharedGames.length,0);assert.equal(result.repeatedSelections.length,0);
});

test('SportsGameOdds NBA prop prefixes match the raw game ID without merging other provider namespaces',()=>{
 const pair=[row({eventID:'sgo:game-a',provider:'SportsGameOdds'}),row({id:'winner',kind:'games',eventID:'game-a',provider:'SportsGameOdds',participant:'HOME_NBA',marketType:'moneyline',period:'game',outcomeStructure:'ml',side:'HOME',line:null})];
 assert.equal(summarizeShortlist(pair,now).gameCount,1);
 const result=summarizeShortlist([...pair,row({id:'other-provider',eventID:'game-a',provider:'The Odds API'})],now);
 assert.equal(result.gameCount,2);assert.equal(result.sharedGames.length,1);assert.equal(result.sharedGames[0].selectionCount,2);
});

test('book aliases and repeated observations cannot inflate counts or duplicate warnings',()=>{
 const result=summarizeShortlist([row({book:'bookmaker'}),row({id:'alias',book:'bookmaker.eu'}),row({id:'same-canonical',book:'bookmakereu'}),row({book:'bookmaker'})],now);
 assert.equal(result.quoteCount,1);assert.equal(result.selectionCount,1);
 assert.equal(result.repeatedSelections.length,0);assert.equal(result.sharedGames.length,0);
});

test('started selections are excluded and incomplete identities are explicitly uncounted',()=>{
 const result=summarizeShortlist([row(),row({id:'started',startsAt:'2026-11-16T20:00:00Z'}),row({id:'missing-event',eventID:''}),row({id:'missing-date',startsAt:null}),row({id:'unknown-period',kind:'games',period:'unverified'}),row({id:'missing-player',playerID:'',player:'Player unavailable'})],now);
 assert.equal(result.quoteCount,1);assert.equal(result.excludedCount,1);assert.equal(result.unidentifiedCount,4);
 assert.equal(result.selectionCount,1);assert.equal(result.sharedGames.length,0);
});

test('summary never reads probabilities or alters saved observations',()=>{
 const rows=[row({model:.99,market:.98}),row({id:'other-book',book:'circa',model:.01,market:.02})],before=structuredClone(rows);
 const first=summarizeShortlist(rows,now);
 assert.deepEqual(rows,before);
 assert.deepEqual(first,summarizeShortlist(rows.map(({model,market,...rest})=>rest),now));
 assert.equal(summarizeShortlist([],now).quoteCount,0);
});

