import test from "node:test";
import assert from "node:assert/strict";
import {parseEspnScoreboard,fitNbaRatings,projectNbaGames,NBA_BASELINE_VERSION}
 from "../../sharp-service/lib/nba-vnext-baseline.js";
import handler from "../../sharp-service/lib/edge-vnext-handler.js";

const at=(day)=>"2026-11-"+String(day).padStart(2,"0")+"T01:00:00Z";
const game=(id,home,away,hs,as,day)=>({
 eventId:String(id),startsAt:at(day),home,away,homeScore:hs,awayScore:as,completed:true
});
test("ESPN NBA parser excludes scheduled games and only reads finished two-sided scores",()=>{
 const payload={events:[{id:"101",date:at(6),status:{type:{completed:true}},competitions:[{
  competitors:[
   {homeAway:"home",team:{abbreviation:"BOS"},score:"125"},
   {homeAway:"away",team:{abbreviation:"MIL"},score:"105"}]}]},
  {id:"102",date:at(7),status:{type:{completed:false}},competitions:[{
  competitors:[
   {homeAway:"home",team:{abbreviation:"MIN"},score:"0"},
   {homeAway:"away",team:{abbreviation:"UTA"},score:"0"}]}]}]};
 const parsed=parseEspnScoreboard(payload);
 assert.equal(parsed.length,2);
 assert.equal(parsed[0].completed,true);
 assert.equal(parsed[0].homeScore,125);
 assert.equal(parsed[1].completed,false);
 assert.equal(parsed[1].homeScore,null);
});

test("Independent NBA ratings use no market odds and exclude games after the forecast cutoff",()=>{
 const games=[
   game(1,"BOS","MIL",125,100,1),game(2,"BOS","MIA",115,90,2),
   game(3,"BOS","LAL",117,90,3),game(4,"BOS","DEN",110,87,4),
   game(5,"MIL","BOS",500,0,10) // invalid even if cutoff wrong
 ];
 const model=fitNbaRatings({games,asOf:at(8)});
 assert.equal(model.eligibleGames,4);
 assert.ok(model.ratings.BOS > model.ratings.MIL);
 assert.equal(model.version,NBA_BASELINE_VERSION);
});

test("NBA forecast is explicitly uncalibrated and blocks missing/incomplete coverage",()=>{
 const hist=[
   game(1,"BOS","MIL",120,100,1),game(2,"BOS","LAL",115,95,2),
   game(3,"BOS","NYK",118,102,3),game(4,"MIA","BOS",95,105,4),
   game(5,"MIL","LAL",100,90,5),game(6,"NYK","MIL",85,95,6),
   game(7,"MIL","MIA",110,100,7),game(8,"MIL","BOS",95,105,8)
 ];
 const upcoming=[{eventId:"nba-x",startsAt:at(12),away:"MIL",home:"BOS",completed:false}];
 const report=projectNbaGames({historicalGames:hist,upcomingGames:upcoming,
   asOf:at(9),historyComplete:true});
 assert.equal(report.status,"RESEARCH_SHADOW");
 assert.equal(report.productionEligible,false);
 assert.equal(report.rows.length,1);
 assert.ok(report.rows[0].homeWinProbability>.5);
 assert.ok(report.rows[0].homeWinProbability<1);
 assert.equal(report.rows[0].decision,"AVOID");
 assert.ok(report.rows[0].reasons.includes("UNCALIBRATED"));
 const missing=projectNbaGames({historicalGames:hist,upcomingGames:upcoming,
   asOf:at(9),historyComplete:false});
 assert.equal(missing.rows[0].homeWinProbability,null);
 assert.equal(missing.status,"SOURCE_INCOMPLETE");
});

function fakeRes(){return {statusCode:200,body:null,
 setHeader(){return this;},status(code){this.statusCode=code;return this;},
 json(body){this.body=body;return this;}};}
test("NBA HTTP endpoint never fetches remote scoreboards before explicit refresh",async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=()=>{throw Error("Should not fetch")};
 try{
  const res=fakeRes();
  await handler({method:"GET",query:{mode:"nba"}},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.state,"NOT_REQUESTED");
  assert.equal(res.body.productionEligible,false);
 }finally{globalThis.fetch=old;}
});

test("NBA manual refresh optionally returns honest walk-forward audit without paid APIs",async()=>{
 const previous=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async input=>{
   const url=new URL(String(input));calls++;
   assert.equal(url.hostname,"site.api.espn.com");
   return {ok:true,json:async()=>({events:[]})};
 };
 try {
   const response=fakeRes();
   await handler({method:"GET",query:{mode:"nba",live:"1",audit:"1"}},response);
   assert.equal(response.statusCode,200);
   assert.equal(response.body.scoreboardCoverage.daysAvailable,21);
   assert.equal(response.body.backtest.evaluatedGames,0);
   assert.equal(response.body.backtest.status,"INSUFFICIENT_HOLDOUT");
   assert.equal(response.body.backtest.marketBaselineBrier,null);
   assert.equal(response.body.productionEligible,false);
   assert.equal(calls,22);
 } finally {globalThis.fetch=previous;}
});
