/**
 * Edge Lab NBA first-half promotion readiness audit.
 *
 * This is a RESEARCH EVIDENCE GATE, not a deployment switch.
 * An automated report cannot authorize production BUYs. Even passing this
 * evidence gate requires separate manual risk review and a new code change.
 *
 * Usage:
 *   node scripts/nba/evaluate-first-half-readiness.mjs \
 *       --input=artifacts/nba-first-half-audit.json \
 *       --evidence=secure/evidence.json \
 *       --output=artifacts/nba-first-half-readiness.json
 *
 * Evidence schema is an attestation of verified dataset provenance:
 * {
 *   "independentSourceReview": true,
 *   "frozenPregameModelProof": true,
 *   "verifiedSharpExactLine": true,
 *   "verifiedHalftimeResults": true,
 *   "licensedOddsUseConfirmed": true,
 *   "operatorReviewedAt": "2026-11-08T18:00:00Z",
 *   "reviewer": "name or team"
 * }
 * Never set evidence flags automatically based on a fixture or a test pass.
 */
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

export const DEFAULT_GATE = Object.freeze({
  minEvaluated: 300,
  minCandidateBets: 100,
  minDistinctDays: 60,
  minTestSpanDays: 120,
  minMeanBrierImprovement: 0.002,
  minMeanLogLossImprovement: 0.003,
  minCandidateRoi: 0,
  minBlockBootstrapRoiLower95: 0,
  maxCalibrationEce: 0.05,
  bootstrapReps: 2000
});

const isFiniteNumber = n => typeof n === "number" && Number.isFinite(n);
function numeric(x, fallback = null) {return isFiniteNumber(x) ? x : fallback;}
const iso = x => typeof x === "string" && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(x) &&
  Number.isFinite(Date.parse(x));
function fail(code, detail, findings) {findings.push({code, detail, passed: false});}
function pass(code, detail, findings) {findings.push({code, detail, passed: true});}
function verified(flag, name, findings) {
  if (flag === true) pass(name, "Independent source attestation provided", findings);
  else fail(name, "Independent source attestation missing or false", findings);
}
function quantile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const a = Math.floor(index), b = Math.ceil(index);
  return sorted[a] + (sorted[b] - sorted[a]) * (index - a);
}
export function blockBootstrapRoi(rows, reps = 2000) {
  if (!Number.isInteger(reps) || reps < 100 || reps > 10000) {
    throw new RangeError("Invalid bootstrap replications");
  }
  const byDate = new Map();
  for (const r of rows) {
    if (!iso(r.tipoff) || !isFiniteNumber(r.returnPerDollar)) {
      throw new Error("Candidate rows require valid tipoff and realized returns");
    }
    const day = r.tipoff.slice(0, 10);
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day).push(r.returnPerDollar);
  }
  const days = [...byDate.values()];
  if (!days.length) return null;
  // Reproducible date-block resampling preserves within-day market dependence.
  let state = 0x1a2b3c4d;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const samples = [];
  for (let i = 0; i < reps; i++) {
    let total = 0, count = 0;
    for (let j = 0; j < days.length; j++) {
      const block = days[Math.floor(random() * days.length)];
      for (const val of block) {total += val; count++;}
    }
    samples.push(total / count);
  }
  return quantile(samples.sort((a,b) => a-b), .025);
}
function eceFromBins(bins, total) {
  if (!Array.isArray(bins) || total < 1) return null;
  const count = bins.reduce((s,b) => s + (b.count || 0), 0);
  if (count !== total) return null;
  return bins.reduce((s,b) =>
    s + (b.count || 0) / total *
    Math.abs((b.averagePrediction || 0) - (b.realizedRate || 0)),0);
}

export function evaluateReadiness(report, evidence = {}, gate = DEFAULT_GATE) {
  const findings = [];
  // Fail closed even with apparent good metrics. The report is untrusted input
  // until a separate, actual evidence review verifies its frozen data sources.
  verified(evidence.independentSourceReview, "SOURCE_REVIEW", findings);
  verified(evidence.frozenPregameModelProof, "PRE_GAME_MODEL_PROOF", findings);
  verified(evidence.verifiedSharpExactLine, "SHARP_EXACT_LINE", findings);
  verified(evidence.verifiedHalftimeResults, "HALFTIME_RESULTS", findings);
  verified(evidence.licensedOddsUseConfirmed, "ODDS_LICENSE", findings);
  if (iso(evidence.operatorReviewedAt) && typeof evidence.reviewer === "string" &&
      evidence.reviewer.trim().length >= 2) {
    pass("REVIEW_ATTESTATION", "Named reviewer and timestamp supplied", findings);
  } else fail("REVIEW_ATTESTATION", "Named, timestamped evidence review missing", findings);

  if (report?.status !== "SHADOW_ONLY" ||
      report?.productionEligible !== false ||
      !Array.isArray(report?.rows) ||
      !Number.isInteger(report.evaluatedRows) ||
      report.evaluatedRows !== report.rows.length) {
    fail("AUDIT_INTEGRITY", "Malformed or non-shadow historical audit", findings);
    return {status:"NOT_READY",productionEligible:false,automaticBuyEnabled:false,
      checks:findings,metrics:null};
  }
  const rows = report.rows;
  const dates = [];
  const ids = new Set();
  let consistent = true;
  for (const r of rows) {
    if (!iso(r.tipoff) || ids.has(r.id) || !r.id ||
        !["WIN","LOSS","PUSH"].includes(r.outcome) ||
        !isFiniteNumber(r.returnPerDollar) ||
        !isFiniteNumber(r.winProbability) ||
        !isFiniteNumber(r.pushProbability) ||
        !isFiniteNumber(r.lossProbability) ||
        Math.abs(r.winProbability+r.pushProbability+r.lossProbability-1) > 1e-5 ||
        !isFiniteNumber(r.sharpFairCover)) consistent = false;
    ids.add(r.id);
    if (iso(r.tipoff)) dates.push(Date.parse(r.tipoff));
  }
  if (!consistent) fail("ROW_INTEGRITY", "Incomplete, repeated or invalid forecast observations", findings);
  else pass("ROW_INTEGRITY", "Audit rows structurally consistent", findings);
  const distinctDays = new Set(rows.filter(r => iso(r.tipoff)).map(r => r.tipoff.slice(0,10))).size;
  const testSpan = dates.length ? (Math.max(...dates)-Math.min(...dates))/86400000 : 0;
  const candidates = rows.filter(r => r.shadowCandidate === true);
  const candidateRoi = candidates.length ?
    candidates.reduce((s,r) => s + r.returnPerDollar,0)/candidates.length : null;
  let roiLow = null;
  try {roiLow = blockBootstrapRoi(candidates, gate.bootstrapReps);}
  catch {fail("BOOTSTRAP_VALIDITY", "Candidate return series contains invalid values", findings);}
  const model = report.model, sharp = report.sharp;
  const brierGain = numeric(report.brierImprovement);
  const logGain = numeric(report.logLossImprovement);
  const ece = eceFromBins(report.reliability, model?.count || 0);

  const checks = [
    ["HISTORICAL_VOLUME", rows.length >= gate.minEvaluated, `${rows.length} evaluated / ${gate.minEvaluated} required`],
    ["CANDIDATE_VOLUME", candidates.length >= gate.minCandidateBets, `${candidates.length} candidates / ${gate.minCandidateBets} required`],
    ["DISTINCT_DAYS", distinctDays >= gate.minDistinctDays, `${distinctDays} / ${gate.minDistinctDays} days`],
    ["HOLDOUT_SPAN", testSpan >= gate.minTestSpanDays, `${Math.floor(testSpan)} / ${gate.minTestSpanDays} calendar days`],
    ["SCORE_COMPARABILITY", model?.count > 0 && model.count === sharp?.count &&
      model.count === rows.filter(r=>r.outcome!=="PUSH").length, "Model and sharp measured on identical non-push outcomes"],
    ["BRIER_VS_SHARP", brierGain !== null && brierGain >= gate.minMeanBrierImprovement, `Gain ${brierGain ?? "missing"}`],
    ["LOG_LOSS_VS_SHARP", logGain !== null && logGain >= gate.minMeanLogLossImprovement, `Gain ${logGain ?? "missing"}`],
    ["CALIBRATION_ECE", ece !== null && ece <= gate.maxCalibrationEce, `ECE ${ece ?? "missing"}`],
    ["CANDIDATE_ROI", candidateRoi !== null && candidateRoi > gate.minCandidateRoi, `Mean net ROI ${candidateRoi ?? "missing"}`],
    ["DAY_BLOCK_ROI_CI", roiLow !== null && roiLow > gate.minBlockBootstrapRoiLower95, `One-sided bootstrap lower 95% ${roiLow ?? "missing"}`],
  ];
  for(const [code,ok,detail] of checks) {
    if(ok) pass(code,detail,findings); else fail(code,detail,findings);
  }
  const evidenceComplete = findings.every(f=>f.passed);
  return {
    status:evidenceComplete ? "MANUAL_REVIEW_REQUIRED" : "NOT_READY",
    productionEligible:false,
    automaticBuyEnabled:false,
    checks:findings,
    metrics:{evaluated:rows.length,candidates:candidates.length,distinctDays,
      holdoutSpanDays:testSpan,brierGain,logLossGain,ece,
      candidateRoi,lowerRoiConfidenceBound95:roiLow},
    note:"Passing automated checks only permits independent human review. Deployment and production BUY require a separate change."
  };
}

function option(name) {
  const item = process.argv.find(x => x.startsWith("--"+name+"="));
  return item ? item.slice(name.length+3) : null;
}
if(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const input=option("input"), output=option("output"), att=option("evidence");
  if(!input || !output) {
    process.stderr.write("Usage: node scripts/nba/evaluate-first-half-readiness.mjs --input=audit.json --output=readiness.json [--evidence=evidence.json]\n");
    process.exitCode=2;
  } else {
    try {
      const report=JSON.parse(fs.readFileSync(input,"utf8"));
      const evidence=att ? JSON.parse(fs.readFileSync(att,"utf8")) : {};
      const outcome=evaluateReadiness(report,evidence);
      fs.mkdirSync(path.dirname(output),{recursive:true});
      fs.writeFileSync(output,JSON.stringify(outcome,null,2)+"\n");
      process.stdout.write(JSON.stringify({status:outcome.status,
        checksPassed:outcome.checks.filter(x=>x.passed).length,
        checksTotal:outcome.checks.length,productionEligible:false})+"\n");
    } catch(e) {
      process.stderr.write("Readiness audit failed: "+e.message+"\n");
      process.exitCode=1;
    }
  }
}
