import test from "node:test";
import assert from "node:assert/strict";
import {evaluateReadiness, blockBootstrapRoi} from "../../scripts/nba/evaluate-first-half-readiness.mjs";

const evidence = {
  independentSourceReview:true, frozenPregameModelProof:true,
  verifiedSharpExactLine:true, verifiedHalftimeResults:true,
  licensedOddsUseConfirmed:true,
  operatorReviewedAt:"2026-11-08T18:00:00Z", reviewer:"Independent reviewer"
};
function simulatedAudit({n=350,candidates=110,positive=true}={}) {
  // Synthetic fixtures test only program control flow; NEVER proof of success.
  const rows=Array.from({length:n},(_,i)=>({
    id:"SIMULATED_"+i,tipoff:new Date(Date.UTC(2025,0,1+i)).toISOString(),
    winProbability:0.62,pushProbability:0,lossProbability:0.38,
    shadowCandidate:i<candidates,outcome: i % 5 === 0 ? "LOSS":"WIN",
    returnPerDollar:i%5===0?-1:0.9090909,
    sharpFairCover:0.52
  }));
  if(!positive) for(const r of rows){r.outcome="LOSS";r.returnPerDollar=-1;}
  return {status:"SHADOW_ONLY",productionEligible:false,rows,evaluatedRows:n,
    model:{count:n},sharp:{count:n},
    brierImprovement:.01,logLossImprovement:.02,
    reliability:Array.from({length:10},(_,i)=>({
      count:i===6?n:0,averagePrediction:i===6?.60:null,
      realizedRate:i===6?.60:null
    }))};
}
test("no real data is NOT READY, even with no declared source problems",()=>{
  const r=evaluateReadiness({status:"SHADOW_ONLY",productionEligible:false,
    evaluatedRows:0, rows:[]},evidence);
  assert.equal(r.status,"NOT_READY");
  assert.equal(r.productionEligible,false);
});
test("excellent synthetic numbers with absent attestations cannot pass",()=>{
  const r=evaluateReadiness(simulatedAudit());
  assert.equal(r.status,"NOT_READY");
  assert.equal(r.productionEligible,false);
  assert.ok(r.checks.some(x=>x.code==="SOURCE_REVIEW"&&!x.passed));
});
test("even all proof flags and excellent metrics never enable BUY",()=>{
  const r=evaluateReadiness(simulatedAudit(),evidence);
  assert.equal(r.status,"MANUAL_REVIEW_REQUIRED");
  assert.equal(r.productionEligible,false);
  assert.equal(r.automaticBuyEnabled,false);
  assert.ok(r.checks.every(x=>x.passed));
});
test("negative ROI and confidence bound block promotion",()=>{
  const r=evaluateReadiness(simulatedAudit({positive:false}),evidence);
  assert.equal(r.status,"NOT_READY");
  assert.ok(r.checks.some(x=>x.code==="DAY_BLOCK_ROI_CI"&&!x.passed));
  assert.ok(r.checks.some(x=>x.code==="CANDIDATE_ROI"&&!x.passed));
});
test("day-block resampling is deterministic and retains within-day records",()=>{
  const rows=[];
  for(let i=0;i<40;i++){
    const tipoff=new Date(Date.UTC(2025,0,i+1)).toISOString();
    rows.push({tipoff,returnPerDollar:i%3?-1:1});
    rows.push({tipoff,returnPerDollar:i%3?-1:1});
  }
  assert.equal(blockBootstrapRoi(rows),blockBootstrapRoi(rows));
});
test("tampered or duplicate audit records fail structural integrity",()=>{
  const audit=simulatedAudit();
  audit.rows[1].id=audit.rows[0].id;
  const r=evaluateReadiness(audit,evidence);
  assert.equal(r.status,"NOT_READY");
  assert.ok(r.checks.some(x=>x.code==="ROW_INTEGRITY"&&!x.passed));
});
test("small data cannot pass the test-span or observation thresholds",()=>{
  const r=evaluateReadiness(simulatedAudit({n:20,candidates:10}),evidence);
  assert.equal(r.status,"NOT_READY");
  assert.ok(r.checks.some(x=>x.code==="HISTORICAL_VOLUME"&&!x.passed));
});
