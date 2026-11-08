import test from "node:test";
import assert from "node:assert/strict";
import {parseCsv, normalizeRows, auditWalkForward, HEADERS} from "../../scripts/nba/backtest-first-half-shadow.mjs";

const start = Date.parse("2025-01-01T20:00:00Z");
function fixture(n = 40) {
  return Array.from({length:n}, (_, i) => {
    const tipoff = new Date(start + i * 86400000).toISOString();
    const checked = new Date(start + i * 86400000 - 300000).toISOString();
    return {
      game_id: "TEST_" + i, tipoff_utc: tipoff,
      quote_checked_utc: checked, sharp_checked_utc: checked,
      home_spread: "-3.5", sharp_home_spread: "-3.5", american_odds: "-110",
      model_captured_utc: checked,
      sharp_no_vig_home_cover: "0.54",
      pregame_expected_home_margin: "4",
      pregame_margin_stddev: "12",
      halftime_home_score: String(55 + i % 6),
      halftime_away_score: String(52 + i % 4),
      rotation_confirmed: "true"
    };
  });
}

test("CSV parsing validates names, quoted fields and missing columns", () => {
  const data = fixture(1);
  const csv = HEADERS.join(",") + "\n" + HEADERS.map(h => data[0][h]).join(",") + "\n";
  assert.equal(parseCsv(csv)[0].game_id, "TEST_0");
  assert.throws(() => parseCsv("game_id,tipoff_utc\n1,2\n"), /Missing column/);
  assert.throws(() => parseCsv(csv.replace("game_id", "home_spread")), /Duplicate CSV columns/);
});

test("normalize rejects post-tipoff odds, future data and duplicate IDs", () => {
  const data = fixture(2);
  assert.equal(normalizeRows(data).length, 2);
  assert.throws(() => normalizeRows([{...data[0],
    quote_checked_utc: data[0].tipoff_utc}]), /post-tipoff/);
  assert.throws(() => normalizeRows([data[0], {...data[1], game_id: data[0].game_id}]), /repeated game_id/);
  assert.throws(() => normalizeRows([{...data[0],
    sharp_checked_utc: "2025-01-01T19:00:00Z"}]), /stale price/);
  assert.throws(() => normalizeRows([{...data[0],
    halftime_home_score: ""}]), /missing halftime_home_score/);
  assert.throws(() => normalizeRows([{...data[0],
    sharp_home_spread: "-4.5"}]), /sharp line does not match/);
  assert.throws(() => normalizeRows([{...data[0],
    model_captured_utc: data[0].tipoff_utc}]), /post-tipoff/);
});

test("no in-game/previous-day leakage and push excluded from binary scoring", () => {
  const records = normalizeRows(fixture(40));
  const result = auditWalkForward(records, {minimumTrain: 5, minEv: 0});
  assert.equal(result.status, "SHADOW_ONLY");
  assert.equal(result.productionEligible, false);
  assert.equal(result.skippedForTraining, 5);
  assert.equal(result.evaluatedRows, 35);
  assert.equal(result.rows[0].trainingRows, 5);
  assert.equal(result.rows[0].tipoff, new Date(records[5].tipoff).toISOString());
  assert.ok(Number.isFinite(result.model.brier));
  assert.ok(Number.isFinite(result.sharp.brier));
  assert.equal(result.model.count, result.evaluatedRows);
  assert.equal(result.reliability.reduce((s, x) => s + x.count, 0), result.model.count);
});

test("unconfirmed rotations never enter training or evaluation", () => {
  const rows = fixture(40);
  rows[0].rotation_confirmed = "false";
  rows[20].rotation_confirmed = "false";
  const result = auditWalkForward(normalizeRows(rows), {minimumTrain: 5});
  assert.equal(result.skippedRotations, 2);
  assert.equal(result.rows[0].trainingRows, 5);
  assert.equal(result.rows[0].tipoff, rows[6].tipoff_utc);
});

test("zero qualifying historical records returns null metrics without fabrication", () => {
  const result = auditWalkForward(normalizeRows(fixture(3)), {minimumTrain: 30});
  assert.equal(result.evaluatedRows, 0);
  assert.equal(result.model.brier, null);
  assert.equal(result.shadowCandidateRoiPerDollar, null);
});

test("push outcomes are excluded from binary Brier but included in ticket ROI", () => {
  const rows = fixture(40);
  for (const row of rows) {
    row.home_spread = "-3";
    row.sharp_home_spread = "-3";
    row.halftime_home_score = "55";
    row.halftime_away_score = "52";
  }
  const report = auditWalkForward(normalizeRows(rows), {minimumTrain: 5, minEv: -1});
  assert.equal(report.evaluatedPushes, 35);
  assert.equal(report.model.count, 0);
  assert.equal(report.shadowCandidateRoiPerDollar, 0);
});
