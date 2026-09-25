import test from "node:test";
import assert from "node:assert/strict";

import {
  brier,
  calibrationBuckets,
  marketIntegrityState,
  roleState,
  summarize
} from "../../supabase/functions/nba-player-prop-calibration/nba-calibration.js";

const rows = [
  {
    outcome: "W",
    rawProbability: 0.55,
    contextProbability: 0.62,
    marketProbability: 0.57
  },
  {
    outcome: "L",
    rawProbability: 0.58,
    contextProbability: 0.48,
    marketProbability: 0.52
  },
  {
    outcome: "W",
    rawProbability: 0.52,
    contextProbability: 0.66,
    marketProbability: 0.54
  },
  {
    outcome: "PUSH",
    rawProbability: 0.99,
    contextProbability: 0.99,
    marketProbability: 0.99
  },
  {
    outcome: "VOID",
    rawProbability: 0.01,
    contextProbability: 0.01,
    marketProbability: 0.01
  }
];

test("NBA calibration excludes push and void from Brier scoring", () => {
  const decisive = rows.slice(0, 3);
  assert.equal(
    brier(rows, "contextProbability"),
    brier(decisive, "contextProbability")
  );
});

test("NBA calibration reports context improvement over raw v1", () => {
  const summary = summarize(rows);

  assert.equal(summary.graded, 5);
  assert.equal(summary.decisive, 3);
  assert.equal(summary.pushes, 1);
  assert.equal(summary.voids, 1);
  assert.ok(summary.brier.context < summary.brier.raw);
  assert.ok(summary.brier.contextImprovementVsRaw > 0);
});

test("NBA calibration probability buckets report observed win rate", () => {
  const buckets = calibrationBuckets(rows, "contextProbability");

  assert.ok(buckets["0.6-0.7"]);
  assert.equal(buckets["0.6-0.7"].rows, 2);
  assert.equal(buckets["0.6-0.7"].observedWinRate, 1);
});

test("NBA calibration classifies role stability from stored diagnostics", () => {
  assert.equal(
    roleState({ roleChangeDetected: true, roleStability: 0.9 }),
    "ROLE_CHANGE"
  );
  assert.equal(
    roleState({ roleStability: 0.9 }),
    "STABLE"
  );
  assert.equal(
    roleState({ roleStability: 0.75 }),
    "MIXED"
  );
});

test("NBA calibration classifies market integrity from stored diagnostics", () => {
  assert.equal(
    marketIntegrityState({
      marketIntegrity: { blocked: true, score: 1 }
    }),
    "BLOCKED"
  );
  assert.equal(
    marketIntegrityState({
      marketIntegrity: { blocked: false, score: 0.95 }
    }),
    "STRONG"
  );
  assert.equal(
    marketIntegrityState({
      marketIntegrity: { blocked: false, score: 0.74 }
    }),
    "OK"
  );
});
