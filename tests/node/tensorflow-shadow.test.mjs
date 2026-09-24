import test from "node:test";
import assert from "node:assert/strict";

import {
  scorePlayerPropTensorflowShadow,
  tensorflowShadowMetadata
} from "../../sharp-service/lib/tensorflow-shadow.js";

const capturedAt = Date.parse("2026-09-23T21:25:03.583Z");

const fixtures = [
  {
    expected: 0.5547936,
    row: {
      startsAt: "2026-09-23T22:40:00Z",
      statID: "batting_hits",
      line: 0.5,
      side: "over",
      modelMean: 0.931,
      rawIndependentProbability: 0.6537,
      modelProbability: 0.5953,
      pushProbability: 0,
      marketFairProbability: 0.4869,
      edgePctPoints: 10.84,
      bestOdds: -103,
      exactLineBookCount: 4,
      pairedBooks: 2,
      evPct: 17.33,
      dataQuality: 1
    }
  },
  {
    expected: 0.5243080,
    row: {
      startsAt: "2026-09-23T22:40:00Z",
      statID: "batting_totalBases",
      line: 0.5,
      side: "over",
      modelMean: 1.469,
      rawIndependentProbability: 0.6537,
      modelProbability: 0.5976,
      pushProbability: 0,
      marketFairProbability: 0.4935,
      edgePctPoints: 10.41,
      bestOdds: -109,
      exactLineBookCount: 2,
      pairedBooks: 2,
      evPct: 14.59,
      dataQuality: 1
    }
  },
  {
    expected: 0.5673208,
    row: {
      startsAt: "2026-09-23T22:40:00Z",
      statID: "batting_hits",
      line: 0.5,
      side: "over",
      modelMean: 1.119,
      rawIndependentProbability: 0.7282,
      modelProbability: 0.6819,
      pushProbability: 0,
      marketFairProbability: 0.596,
      edgePctPoints: 8.59,
      bestOdds: -164,
      exactLineBookCount: 4,
      pairedBooks: 2,
      evPct: 9.77,
      dataQuality: 1
    }
  }
];

test("JavaScript shadow inference matches TensorFlow golden fixtures", () => {
  for (const fixture of fixtures) {
    const scored = scorePlayerPropTensorflowShadow(
      fixture.row,
      capturedAt
    );
    assert.equal(scored.available, true);
    assert.ok(
      Math.abs(scored.probability - fixture.expected) < 2e-6,
      `expected ${fixture.expected}, got ${scored.probability}`
    );
  }
});

test("TensorFlow challenger is hard-zero weighted until promotion", () => {
  const meta = tensorflowShadowMetadata();
  assert.equal(meta.mode, "SHADOW");
  assert.equal(meta.eligibleForProduction, false);
  assert.equal(meta.productionWeight, 0);

  const scored = scorePlayerPropTensorflowShadow(
    fixtures[0].row,
    capturedAt
  );
  assert.equal(scored.affectsDecision, false);
  assert.equal(
    scored.ensembleProbability,
    fixtures[0].row.modelProbability
  );
});

test("missing core features never influence a decision", () => {
  const scored = scorePlayerPropTensorflowShadow(
    { statID: "batting_hits", side: "over" },
    capturedAt
  );
  assert.equal(scored.available, false);
  assert.equal(scored.affectsDecision, false);
});
