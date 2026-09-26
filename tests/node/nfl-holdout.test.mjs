import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("NFL holdout refuses to run without a frozen 2024 calibration", () => {
  const result = spawnSync(process.execPath, [
    "scripts/nfl/backtest-nfl-player-props.mjs", "--seasons=2025"
  ], { encoding: "utf8", timeout: 2000 });
  assert.equal(result.error, undefined, "must fail before fetching historical data");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frozen 2024 calibration/);
});


test("NFL holdout rejects overwriting its frozen input before fetching", () => {
  const result = spawnSync(process.execPath, [
    "scripts/nfl/backtest-nfl-player-props.mjs", "--seasons=2025",
    "--frozen-calibration=artifacts/nfl-player-props-backtest/report.json"
  ], { encoding: "utf8", timeout: 2000 });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not be overwritten/);
});

test("holdout summary reports frozen zero-weight metrics and provenance", async () => {
  const { formatHoldoutSummary } = await import("../../scripts/nfl/backtest-nfl-player-props.mjs");
  const output = formatHoldoutSummary({ frozenCalibrationSha256: "frozen-hash",
    holdoutEvaluation: { passing_yards: { frozenBaselineWindow: 4, frozenWeight: 0,
      challenger: { rows: 10, mae: 12 }, incumbent: { mae: 14 } } } }).join("\n");
  assert.match(output, /frozen-hash/);
  assert.match(output, /passing_yards \| 4 \| 0 \| 10 \| 12 \| 14/);
});
