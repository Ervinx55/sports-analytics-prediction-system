import test from "node:test";
import assert from "node:assert/strict";
import {
  normalCdf, estimateFirstHalfMargin, spreadOutcome, decimalOdds,
  sportsbookEv, comboEv, gradeCombo, evaluateFirstHalfShadow
} from "../../sharp-service/lib/nba-first-half-shadow.js";

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test("normal CDF is symmetric and bounded", () => {
  close(normalCdf(0), 0.5, 2e-7);
  close(normalCdf(-1) + normalCdf(1), 1);
});

test("small-sample first-half rating is shrunk toward season prior", () => {
  const out = estimateFirstHalfMargin({
    firstHalfNetRating: 30, seasonNetRating: 2,
    firstHalfSampleGames: 5, possessionEstimate: 50,
    homeCourtPoints: 1, marginStdDev: 12
  });
  close(out.shrinkageWeight, 5 / 30);
  close(out.expectedHomeMargin, (2 + (30 - 2) * 5 / 30) * 0.5 + 1);
  assert.throws(() => estimateFirstHalfMargin({
    firstHalfNetRating: 30, seasonNetRating: 2, firstHalfSampleGames: 5,
    possessionEstimate: 50, marginStdDev: undefined
  }));
});

test("home -3.5 requires margin >=4, exact numeric win probability", () => {
  const out = spreadOutcome({expectedHomeMargin: 3.5, marginStdDev: 10}, -3.5);
  close(out.win, 0.5, 2e-7);
  close(out.push, 0);
  close(out.win + out.push + out.loss, 1);
});

test("integer spread has push mass; half point does not", () => {
  const params = {expectedHomeMargin: 3, marginStdDev: 10};
  const a = spreadOutcome(params, -3);
  const b = spreadOutcome(params, -3.5);
  assert.ok(a.push > 0);
  close(b.push, 0);
  close(a.win + a.loss + a.push, 1);
});

test("sportsbook EV handles -110 and positive prices with pushes", () => {
  close(decimalOdds(-110), 1 + 100 / 110);
  close(decimalOdds(120), 2.2);
  close(sportsbookEv({win: 0.5, push: 0, loss: 0.5}, -110), -0.0454545454545);
  close(sportsbookEv({win: 0.5, push: 0.1, loss: 0.4}, 120), 0.2);
  assert.throws(() => sportsbookEv({win: 0.5, push: 0.1, loss: 0.5}, -110));
});

test("Kalshi combo accounts for stake, actual payout and win fees", () => {
  const result = gradeCombo({cost: 35.38, payout: 0, legs: ["LOSS", "WIN", "WIN"]});
  assert.equal(result.wins, 2);
  close(result.legHitRate, 2 / 3);
  close(result.netProfit, -35.38);
  assert.equal(result.ticketWon, false);
  const grossThreshold = 35.38 / 241.80;
  close(comboEv({cost: 35.38, maxPayout: 241.80, winProbability: grossThreshold}), 0);
  assert.ok(comboEv({cost: 35.38, maxPayout: 241.80,
    winProbability: grossThreshold, winFee: 2}) < 0);
});

const base = () => ({
  distribution: {expectedHomeMargin: 8, marginStdDev: 10,
    modelType: "normal_margin_unfitted_shadow_v1"},
  quote: {homeSpread: -3.5, americanOdds: -110, checkedAt: "2026-11-07T19:50:00Z"},
  sharp: {homeSpread: -3.5, noVigHomeCover: 0.55,
    checkedAt: "2026-11-07T19:50:00Z"},
  now: "2026-11-07T19:55:00Z",
  tipoff: "2026-11-07T20:00:00Z",
  availabilityConfirmed: true,
  modelCalibrated: false
});

test("strong-looking estimates remain shadow-only until calibrated", () => {
  const grade = evaluateFirstHalfShadow(base());
  assert.equal(grade.status, "SHADOW_CANDIDATE");
  assert.equal(grade.productionDecision, "DISABLED");
  assert.deepEqual(grade.reasons, ["MODEL_UNCALIBRATED"]);
});

test("stale quotes, mismatched lines and missing rotation block candidate", () => {
  assert.equal(evaluateFirstHalfShadow({...base(), now: "2026-11-07T19:59:00Z",
    quote: {...base().quote, checkedAt: "2026-11-07T19:40:00Z"}}).status, "AVOID");
  assert.equal(evaluateFirstHalfShadow({...base(),
    sharp: {...base().sharp, homeSpread: -4.5}}).status, "AVOID");
  assert.equal(evaluateFirstHalfShadow({...base(), availabilityConfirmed: false}).status, "AVOID");
  assert.equal(evaluateFirstHalfShadow({...base(), now: "2026-11-07T20:01:00Z"}).status, "AVOID");
});

test("nonpositive expected value fails gate even with a large projected favorite", () => {
  const grade = evaluateFirstHalfShadow({
    ...base(), distribution: {expectedHomeMargin: 3, marginStdDev: 14},
    modelCalibrated: true
  });
  assert.equal(grade.status, "AVOID");
  assert.ok(grade.reasons.includes("EV_BELOW_GATE"));
});
