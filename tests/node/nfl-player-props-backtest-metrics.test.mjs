import test from "node:test";
import assert from "node:assert/strict";

import { metrics } from "../../scripts/nfl/player-props-metrics.mjs";

test("rolling-mean improvement uses only rows with both predictions", () => {
  const result = metrics([
    { actual: 10, prediction: 12, baseline: 11 },
    { actual: 10, prediction: 10, baseline: null },
    { actual: 10, prediction: null, baseline: 0 }
  ]);

  assert.equal(result.rows, 2);
  assert.equal(result.mae, 1);
  assert.equal(result.baselineRows, 2);
  assert.equal(result.baselineMae, 5.5);
  assert.equal(result.pairedRows, 1);
  assert.equal(result.pairedModelMae, 2);
  assert.equal(result.pairedBaselineMae, 1);
  assert.equal(result.maeImprovementVsRollingMean, -1);
});

test("nonfinite actuals never enter descriptive or paired errors", () => {
  const result = metrics([
    { actual: Number.NaN, prediction: 100, baseline: 100 },
    { actual: Number.POSITIVE_INFINITY, prediction: 100, baseline: 100 },
    { actual: 5, prediction: 7, baseline: 6 }
  ]);

  assert.equal(result.rows, 1);
  assert.equal(result.mae, 2);
  assert.equal(result.baselineRows, 1);
  assert.equal(result.baselineMae, 1);
  assert.equal(result.pairedRows, 1);
  assert.equal(result.maeImprovementVsRollingMean, -1);
});

test("improvement is unavailable when there are no complete pairs", () => {
  const result = metrics([
    { actual: 5, prediction: 7, baseline: null },
    { actual: 5, prediction: null, baseline: 6 }
  ]);

  assert.equal(result.rows, 1);
  assert.equal(result.baselineRows, 1);
  assert.equal(result.pairedRows, 0);
  assert.equal(result.pairedModelMae, null);
  assert.equal(result.pairedBaselineMae, null);
  assert.equal(result.maeImprovementVsRollingMean, null);
});
