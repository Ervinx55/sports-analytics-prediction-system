import test from "node:test";
import assert from "node:assert/strict";
import {backtestNbaBaseline} from "../../sharp-service/lib/nba-vnext-backtest.js";
import {collectDaily} from "../../scripts/edge-lab/daily-nba-vnext.mjs";
import {createHash} from 'node:crypto';

// Synthetic archived-final receipts for this fixture only. Production replay
// must never estimate an observation time by adding a duration to tipoff.
function archivedFinal(game,observedAt){
 const snapshot={eventId:game.eventId,startsAt:game.startsAt,home:game.home,away:game.away,
  homeScore:game.homeScore,awayScore:game.awayScore,completed:true};
 return {...game,finalObservation:{contract:'nba-final-observation-v1',...snapshot,observedAt,
  sourceUrl:`https://scores.example.test/nba/${game.eventId}.json`,
  sourceSha256:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}};
}

test("NBA walk-forward forecasts never use same-game or future scores",()=>{
 const games=[];
 const teams=["BOS","MIL","LAL","MIA","DEN","CHI"];
 let id=0;
 for(let d=1;d<=28;d++){
  const a=teams[d%teams.length],b=teams[(d+1)%teams.length];
  games.push(archivedFinal({eventId:String(++id),startsAt:"2026-10-"+String(d).padStart(2,"0")+"T20:00:00Z",
    home:a,away:b,homeScore:110+(d%7),awayScore:103+(d%6),completed:true},
    "2026-10-"+String(d).padStart(2,"0")+"T23:00:00Z"));
 }
 const one=backtestNbaBaseline({games,minimumEvaluated:1});
 assert.equal(one.marketBaselineBrier,null);
 assert.equal(one.payoutROI,null);
 assert.equal(one.productionEligible,false);
 assert.ok(one.evaluatedGames<=games.length);
 assert.ok(one.evaluatedGames > 0, "Walk-forward audit must produce scored predictions");
 assert.ok(one.records.every(r=>Date.parse(r.forecastAt) === Date.parse(r.startsAt)-1));
 // Alter only the last outcome: earlier forecasts cannot change.
 const altered=structuredClone(games);
 altered.at(-1).homeScore=50;altered.at(-1).awayScore=180;
 altered[altered.length-1]=archivedFinal(altered.at(-1),altered.at(-1).finalObservation.observedAt);
 const two=backtestNbaBaseline({games:altered,minimumEvaluated:1});
 for(let i=0;i<Math.min(one.records.length,two.records.length);i++){
  assert.equal(one.records[i].predictedHomeWinProbability,two.records[i].predictedHomeWinProbability);
 }
});

test("daily collector respects source completeness and performs no provider quote requests",async()=>{
 const seen=[];
 const model=await collectDaily({
  date:"2026-11-09",days:10,
  fetchDay:async d=>{seen.push(d);return [];}
 });
 assert.equal(seen.length,11);
 assert.equal(model.source.complete,true);
 assert.equal(model.paidRequests,0);
 assert.equal(model.providerSecretUsed,false);
 assert.equal(model.forecast.rows.length,0);
 assert.equal(model.backtest.evaluatedGames,0);
 assert.equal(model.productionEligible,false);
});

test("daily collector fails closed if historical scoreboards are missing",async()=>{
 const model=await collectDaily({date:"2026-11-09",days:10,
  fetchDay:async d=>{if(d.endsWith("-04")||d.endsWith("-05"))throw Error("offline");return [];}});
 assert.equal(model.source.complete,false);
 assert.ok(model.source.failedDates.length>=2);
 assert.equal(model.productionEligible,false);
 await assert.rejects(()=>collectDaily({date:"bad",days:10}),/Invalid date/);
});
