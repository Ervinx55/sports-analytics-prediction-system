import test from 'node:test';import assert from 'node:assert/strict';
import {forecastGames,availableAfter,prospectiveEligible,scoreForecasts} from '../../sharp-service/lib/cfb-model.js';
const cfg={k:24,homeAdvantage:35,carry:0.75};
const game=(id,date,extra={})=>({id,season:Number(date.slice(0,4)),startsAt:date,homeID:'a',awayID:'b',homeName:'A',awayName:'B',homeScore:20,awayScore:10,completed:true,cancelled:false,neutralSite:false,fbsVerified:true,...extra});
const history=Array.from({length:10},(_,i)=>game('g'+i,`2025-10-${String(i+1).padStart(2,'0')}T17:00:00Z`));
const target=game('new','2026-11-14T17:00:00Z',{completed:false});
test('CFB probabilities complement and reflect opponent results and verified venue',()=>{
 const [a]=forecastGames(history,[target],cfg,'2026-11-14T15:00:00Z').forecasts;
 assert.ok(a.homeProbability>0.5);assert.equal(a.homeProbability+a.awayProbability,1);assert.equal(a.productionEligible,false);
 const [neutral]=forecastGames(history,[{...target,neutralSite:true}],cfg,'2026-11-14T15:00:00Z').forecasts;assert.ok(neutral.homeProbability<a.homeProbability);
});
test('CFB cannot learn from same-day or future scores or duplicate outcomes',()=>{
 const baseline=forecastGames(history,[target],cfg,'2026-11-14T15:00:00Z');
 const future=game('late','2026-11-14T13:00:00Z',{homeScore:0,awayScore:100});
 assert.deepEqual(forecastGames([...history,future],[target],cfg,'2026-11-14T15:00:00Z'),baseline);
 assert.throws(()=>forecastGames([...history,history[0]],[target],cfg,'2026-11-14T15:00:00Z'));
 assert.ok(availableAfter(game('night','2026-11-14T23:30:00Z'))>Date.parse('2026-11-15T04:00:00Z'));
});
test('CFB missing history, unknown venue/division and cancelled games cannot emit forecasts',()=>{
 for(const g of [{...target,neutralSite:null},{...target,fbsVerified:false},{...target,cancelled:true}])assert.equal(forecastGames(history,[g],cfg,'2026-11-14T15:00:00Z').forecasts.length,0);
 assert.equal(forecastGames(history.slice(0,7),[target],cfg,'2026-11-14T15:00:00Z').forecasts.length,0);
 assert.equal(forecastGames(history,[{...target,startsAt:'2028-11-14T17:00:00Z',season:2028}],cfg,'2028-11-14T15:00:00Z').forecasts.length,0);
});
test('CFB prospective window and proper scoring denominators are explicit',()=>{
 assert.equal(prospectiveEligible(target,'2026-11-14T15:00:00Z'),true);
 assert.equal(prospectiveEligible(target,'2026-11-14T16:31:00Z'),false);
 assert.equal(prospectiveEligible(target,'2026-11-13T16:59:00Z'),false);
 const m=scoreForecasts([{probability:0.75,outcome:1},{probability:0.25,outcome:0}]);assert.equal(m.n,2);assert.equal(m.brier,0.0625);assert.equal(m.accuracy,1);assert.ok(Math.abs(m.logLoss+Math.log(0.75))<1e-10);
 assert.equal(scoreForecasts([]).brier,null);
});
