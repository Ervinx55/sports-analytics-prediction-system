import test from "node:test";
import assert from "node:assert/strict";
import { decisionGate } from "../../sharp-service/lib/edge-vnext.js";

const base = {
  modelProbability: .599, marketFairProbability: .56, offeredOdds: -130, pushProbability:0,
  modelCapturedAt: "2026-11-11T18:58:00Z",
  quoteCapturedAt: "2026-11-11T18:59:00Z",
  startsAt: "2026-11-11T20:00:00Z", now: "2026-11-11T19:00:00Z",
  calibrated: true, independentForecast: true, sourceHealthy: true, approved: true
};
const close = (a, b) => assert.ok(Math.abs(a-b) < 1e-9, `${a} != ${b}`);

test("59.9% may beat fair consensus and still lose money at the offered price", () => {
  const good = decisionGate(base);
  assert.equal(good.decision, "MANUAL_BUY_REVIEW");
  const expensive = decisionGate({...base, offeredOdds: -170});
  assert.equal(expensive.decision, "AVOID");
  assert.ok(expensive.edgePercentagePoints > 3);
  assert.ok(expensive.reasons.includes("NON_POSITIVE_EXPECTED_VALUE"));
  close(expensive.expectedROI, .599 * (1+100/170) - 1);
  assert.equal(expensive.automaticBuyEnabled, false);
});

test("missing prices and malformed thresholds cannot bypass the price check", () => {
  for (const offeredOdds of [undefined, null, "", 0, -99, NaN, Infinity]) {
    const result = decisionGate({...base, offeredOdds});
    assert.equal(result.decision, "AVOID");
    assert.equal(result.expectedROI, null);
  }
  for (const minimumEdge of [-.1, NaN, Infinity, "0.03", null]) {
    assert.ok(decisionGate({...base, minimumEdge}).reasons.includes("INVALID_DECISION_THRESHOLDS"));
  }
  for (const minimumExpectedROI of [-.1, NaN, Infinity, "0.03", null]) {
    assert.ok(decisionGate({...base, minimumExpectedROI}).reasons.includes("INVALID_DECISION_THRESHOLDS"));
  }
});

test("positive but insufficient EV and exact break-even are not enough", () => {
  const small = decisionGate({...base, modelProbability:.57, marketFairProbability:.53, offeredOdds:-130});
  assert.ok(small.expectedROI > 0 && small.expectedROI < .03);
  assert.ok(small.reasons.includes("EV_BELOW_THRESHOLD"));
  const zero = decisionGate({...base, modelProbability:.5, marketFairProbability:.45,
    offeredOdds:100, minimumExpectedROI:0});
  assert.ok(zero.reasons.includes("NON_POSITIVE_EXPECTED_VALUE"));
});

test("push-aware pricing compares the model and no-vig market on the same basis", () => {
  const result = decisionGate({...base, modelProbability:.45, pushProbability:.2,
    marketFairProbability:.50, offeredOdds:110});
  close(result.edgePercentagePoints, 6.25);
  close(result.expectedROI, .45*1.1 - .35);
  close(result.breakEvenWinProbability, .8/2.1);
  assert.equal(result.decision, "MANUAL_BUY_REVIEW");
  for (const pushProbability of [undefined, null, -.1, .9, 1, NaN]) {
    const invalid = decisionGate({...base, pushProbability});
    assert.ok(invalid.reasons.includes("INVALID_PUSH_PROBABILITY"));
    assert.equal(invalid.expectedROI, null);
  }
});

test("NHL props remain unvalidated regardless of high probability and approval", () => {
  for (const marketType of ["shots_on_goal", "points", "assists", "goals", "saves", "prop", null]) {
    const result = decisionGate({...base, sport:"NHL", marketType});
    assert.equal(result.decision, "AVOID");
    assert.ok(result.reasons.includes("NHL_PROP_MODEL_NOT_VALIDATED"));
  }
  assert.equal(decisionGate({...base, sport:"NHL", marketType:"total"}).decision, "MANUAL_BUY_REVIEW");
});

test("verification flags must be explicit booleans; fresh quotes cannot rescue stale models", () => {
  for (const key of ["calibrated", "independentForecast", "sourceHealthy", "approved"]) {
    assert.equal(decisionGate({...base, [key]:"false"}).decision, "AVOID");
  }
  assert.ok(decisionGate({...base, modelCapturedAt:"2026-11-11T18:30:00Z"}).reasons.includes("STALE_MODEL"));
  assert.ok(decisionGate({...base, quoteCapturedAt:"2026-11-11T18:30:00Z"}).reasons.includes("STALE_QUOTE"));
  assert.ok(decisionGate({...base, quoteCapturedAt:"2026-11-11T19:01:00Z"}).reasons.includes("INVALID_PREGAME_TIMESTAMPS"));
});
