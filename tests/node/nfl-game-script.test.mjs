import test from "node:test";
import assert from "node:assert/strict";
import { projectGameScriptScenarios } from "../../sharp-service/lib/nfl-game-script.js";

const base = { projectedPlays: 64, historicalPassRate: 0.56, baselineYardsPerAttempt: 7.0 };

test("trailing increases pass volume without assuming better efficiency", () => {
  const result = projectGameScriptScenarios({ ...base, teamSpread: 10, pressureRateAllowed: 0.50 });
  assert.equal(result.status, "SHADOW_UNCALIBRATED");
  assert.equal(result.appliedToProduction, false);
  const [lead, close, trail] = result.scenarios;
  assert.ok(trail.passingAttempts > close.passingAttempts);
  assert.ok(close.passingAttempts > lead.passingAttempts);
  assert.ok(trail.efficiencyFactor <= close.efficiencyFactor);
  assert.ok(trail.weight > lead.weight);
});

test("favorite is more likely to lead and rush than trailing", () => {
  const result = projectGameScriptScenarios({ ...base, teamSpread: -10 });
  assert.ok(result.scenarios[0].weight > result.scenarios[2].weight);
  assert.ok(result.scenarios[0].rushingAttempts > result.scenarios[2].rushingAttempts);
});

test("missing efficiency and possession evidence does not introduce guessed adjustments", () => {
  const result = projectGameScriptScenarios({ projectedPlays: 60, historicalPassRate: 0.55 });
  assert.equal(result.expectedPassingYards, null);
  assert.equal(result.inputs.pressureRateAvailable, false);
  assert.equal(result.inputs.thirdDownRateAvailable, false);
  assert.ok(result.scenarios.every(s => s.plays === 60 && s.efficiencyFactor === 1));
});

test("does not use final results or absent pregame baseline", () => {
  const invalid = projectGameScriptScenarios({ projectedPlays: null, historicalPassRate: 0.56 });
  assert.equal(invalid.status, "UNAVAILABLE");
  assert.equal(invalid.scenarios.length, 0);
});

test("weights stay nonnegative and approximately sum to one for extreme spreads", () => {
  for (const teamSpread of [-50, 0, 50]) {
    const result = projectGameScriptScenarios({ ...base, teamSpread });
    assert.ok(result.scenarios.every(s => s.weight >= 0 && s.weight <= 1));
    assert.ok(Math.abs(result.scenarios.reduce((sum, s) => sum + s.weight, 0) - 1) < 0.002);
  }
});
