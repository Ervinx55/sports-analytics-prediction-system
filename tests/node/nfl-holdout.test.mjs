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
