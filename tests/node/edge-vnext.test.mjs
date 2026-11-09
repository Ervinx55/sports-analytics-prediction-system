import test from "node:test";
import assert from "node:assert/strict";
import {
  americanOddsToProbability, removeVigTwoWay, poissonMass,
  thresholdProbability, priceKalshi, priceAmerican,
  comboProbability, summarizePositions, decisionGate
} from "../../sharp-service/lib/edge-vnext.js";
import { buildEdgeBoard } from "../../sharp-service/lib/edge-vnext-board.js";
import handler from "../../sharp-service/api/edge-vnext.js";

const close=(x,y,tol=1e-8)=>assert.ok(Math.abs(x-y)<=tol,"Expected "+x+" ~ "+y);

test("sportsbook odds and no-vig fair chances are not interchangeable",()=>{
  close(americanOddsToProbability(-110),110/210);
  close(americanOddsToProbability(+200),1/3);
  assert.equal(americanOddsToProbability(0),null);
  assert.equal(americanOddsToProbability(-99),null);
  const p=removeVigTwoWay(-120,+110);
  assert.ok(p.overround>0);
  close(p.a+p.b,1);
});

test("Poisson distribution sums to one and respects push versus half-integer boundaries",()=>{
  const d=poissonMass(4.5);
  close(d.reduce((a,b)=>a+b,0),1);
  const full=thresholdProbability({pmf:d,threshold:5,direction:"over"});
  const half=thresholdProbability({pmf:d,threshold:5.5,direction:"over"});
  assert.ok(full.pushProbability>0);
  close(half.pushProbability,0);
  close(full.winProbability,half.winProbability);
  const atLeast=thresholdProbability({pmf:d,threshold:5,direction:"at_least"});
  close(atLeast.winProbability,full.winProbability+full.pushProbability);
  assert.equal(poissonMass(-1),null);
  assert.equal(thresholdProbability({pmf:[.5,.2],threshold:1}),null);
});

test("Kalshi dollar contract EV deducts fees and correct break-even",()=>{
  const x=priceKalshi({winProbability:.60,contractPrice:.5,contracts:10,fees:.25});
  close(x.cost,5.25);
  close(x.expectedPayout,6);
  close(x.netEV,.75);
  close(x.breakEvenWinProbability,.525);
  assert.equal(priceKalshi({winProbability:.7,contractPrice:1}),null);
  assert.equal(priceKalshi({winProbability:.7,contractPrice:.5,fees:-1}),null);
});

test("Sportsbook expected return handles the push mass",()=>{
  const a=priceAmerican({winProbability:.5,pushProbability:.1,odds:-110});
  close(a.netEVPerDollar,.5*100/110-.4);
  close(a.breakEvenWinProbability,.9/(1+100/110));
  assert.equal(priceAmerican({winProbability:.95,pushProbability:.1,odds:-110}),null);
});

test("Combo probabilities never multiply correlated events without explicit evidence",()=>{
  const legs=[{outcomeKey:"NBA:BOS:ML",probability:.85},
              {outcomeKey:"NFL:KC:ML",probability:.8},
              {outcomeKey:"NFL:KC:ML",probability:.75}];
  const result=comboProbability({legs});
  close(result.lowerBound,.4);
  close(result.upperBound,.75);
  assert.equal(result.estimatedJoint,null);
  assert.equal(result.correlationStatus,"SHARED_OR_UNKNOWN_OUTCOMES");
  assert.equal(comboProbability({legs,independenceVerified:true}).estimatedJoint,null);
  const independent=comboProbability({legs:[{outcomeKey:"a",probability:.6},
    {outcomeKey:"b",probability:.5}],independenceVerified:true});
  close(independent.estimatedJoint,.3);
});

test("Reconciled ledger grades net profit, including losers",()=>{
  const x=summarizePositions([{stake:10,payout:50},{stake:10,payout:0}]);
  close(x.profit,30);close(x.roi,1.5);
  assert.equal(summarizePositions([{stake:10,payout:-10}]),null);
  assert.equal(summarizePositions([{stake:10,payout:10,settled:false}]),null);
});

test("Decision gate rejects stale, uncalibrated, anchored inputs even with 90% model probability",()=>{
  const t={modelProbability:.9,marketFairProbability:.5,
    modelCapturedAt:"2026-11-09T11:55:00Z",quoteCapturedAt:"2026-11-09T11:56:00Z",
    startsAt:"2026-11-09T12:30:00Z",now:"2026-11-09T12:00:00Z"};
  const bad=decisionGate(t);
  assert.equal(bad.decision,"AVOID");
  assert.ok(bad.reasons.includes("UNCALIBRATED"));
  assert.ok(bad.reasons.includes("MARKET_ANCHORED_OR_UNVERIFIED_MODEL"));
  assert.equal(bad.automaticBuyEnabled,false);
  const reviewed=decisionGate({...t,calibrated:true,independentForecast:true,
    sourceHealthy:true,approved:true});
  assert.equal(reviewed.decision,"MANUAL_BUY_REVIEW");
  assert.equal(reviewed.automaticBuyEnabled,false);
});

test("Model board never promotes old NFL rows or manufactures NBA probability",()=>{
  const now="2026-11-09T12:00:00Z";
  const nfl={league:"NFL",generatedAt:"2026-11-09T11:59:00Z",markets:[
    {eventID:"game1",startsAt:"2026-11-09T20:00:00Z",away:"BUF",home:"MIN",
      marketType:"moneyline",side:"home",label:"Minnesota",
      bestOdds:-200,modelProbability:.72,marketFairProbability:.7},
    {eventID:"game0",startsAt:"2026-11-08T19:00:00Z",marketType:"moneyline",
      modelProbability:.99,marketFairProbability:.5}
  ]};
  const board=buildEdgeBoard({nflResponse:nfl,now});
  assert.equal(board.rows.length,1);
  assert.equal(board.rows[0].modelProbability,.72);
  assert.equal(board.rows[0].decision,"AVOID");
  assert.ok(board.rows[0].reasons.includes("UNCALIBRATED"));
  assert.equal(board.sports.NBA.state,"NO_VERIFIED_INDEPENDENT_MODEL");
  assert.equal(board.productionEligible,false);
});

function res() {
 return {headers:{},statusCode:200,body:null,
   setHeader(k,v){this.headers[k]=v;return this;},
   status(v){this.statusCode=v;return this;},
   json(v){this.body=v;return this;}};
}
test("HTTP defaults to quota-safe status without triggering upstream fetch",async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error("Should not fetch remotely")};
 try{
   const r=res();
   await handler({method:"GET",query:{}},r);
   assert.equal(r.statusCode,200);
   assert.equal(r.body.requestRequired,true);
   assert.equal(r.body.rows.length,0);
   assert.equal(r.body.sports.NBA.state,"NO_VERIFIED_INDEPENDENT_MODEL");
 } finally{globalThis.fetch=previous;}
});

test("HTTP scenario, combo and ledger validate inputs with no provider calls",async()=>{
 const a=res();await handler({method:"GET",query:{mode:"alt",mean:"4.5",threshold:"5",
  direction:"at_least",odds:"-110",kalshiPrice:".50",fees:".02"}},a);
 assert.equal(a.statusCode,200);assert.equal(a.body.decision,"AVOID");
 assert.ok(a.body.probability.winProbability>0);
 const b=res();await handler({method:"GET",query:{mode:"combo",probabilities:".8,.7,.6"}},b);
 assert.equal(b.statusCode,200);assert.equal(b.body.joint.estimatedJoint,null);
 const c=res();await handler({method:"GET",query:{mode:"ledger",entries:'[{"stake":10,"payout":20}]'}},c);
 assert.equal(c.statusCode,200);assert.equal(c.body.profit,10);
 const d=res();await handler({method:"POST",query:{}},d);
 assert.equal(d.statusCode,405);
});
