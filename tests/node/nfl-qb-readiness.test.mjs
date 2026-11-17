import test from "node:test";
import assert from "node:assert/strict";
import { leagueBaselines, projectEvent } from "../../sharp-service/lib/nfl-model.js";

function fixture() {
  const quote = (odds, line = null) => ({
    consensus: { odds, line },
    books: Object.fromEntries(["draftkings", "fanduel", "betmgm"].map(
      (book) => [book, { odds, line, available: true }]
    ))
  });
  const snapshots = new Map(["BAL", "LAC"].map((team) => [team, {
    team, currentSeasonGames: 8, historicalGames: 8, statGames: 8,
    pointsFor: 22, pointsAgainst: 22, margin: 0, total: 44,
    offEpa: 0, defEpaAllowed: 0, offYpp: 5.5, defYppAllowed: 5.5,
    turnoverMargin: 0
  }]));
  return {
    event: {
      eventID: "nfl-qb-conflict", startsAt: "2026-11-17T01:15:00Z",
      matchup: {
        away: { name: "Los Angeles Chargers", short: "LAC" },
        home: { name: "Baltimore Ravens", short: "BAL" }
      },
      markets: {
        moneyline: { home: quote(-200), away: quote(180) },
        spread: { home: quote(-110, -4), away: quote(-110, 4) },
        total: { over: quote(-110, 44.5), under: quote(-110, 44.5) }
      }
    },
    schedule: [{
      game_id: "2026_10_LAC_BAL",
      season: "2026", game_type: "REG", gameday: "2026-11-16", week: "10",
      away_team: "LAC", home_team: "BAL", away_rest: "7", home_rest: "7",
      away_qb_name: "Justin Herbert", home_qb_name: "Jacoby Brissett"
    }],
    depthCharts: [
      { dt: "2026-11-16T12:00:00Z", team: "BAL", player_name: "Jacoby Brissett", pos_abb: "QB", pos_rank: "1" },
      { dt: "2026-11-16T12:00:00Z", team: "LAC", player_name: "Justin Herbert", pos_abb: "QB", pos_rank: "1" }
    ],
    stats: [], snapshots, baseline: leagueBaselines([...snapshots.values()]),
    season: 2026, asOf: "2026-11-16T20:00:00Z", simulationIterations: 100
  };
}

test("a conflicting scheduled quarterback blocks the forecast instead of selecting the stale name", () => {
  const input = fixture();
  input.schedule[0].home_qb_name = "Tyler Huntley";
  const result = projectEvent(input);
  assert.equal(result.available, false);
  assert.equal(result.startsAt, "2026-11-17T01:15:00Z");
  assert.equal(result.matchup.home.name, "Baltimore Ravens");
  assert.equal(result.forecastReadiness.available, false);
  assert.match(result.forecastReadiness.reasons.join(" "), /Tyler Huntley.*Jacoby Brissett/);
  assert.equal(result.gameContext.availability.home.expected, null);
  assert.equal(result.gameContext.availability.home.scheduleListed, "Tyler Huntley");
  assert.equal(result.gameContext.availability.home.depthChartQb1, "Jacoby Brissett");
  assert.equal(result.gameContext.availability.home.source.injuryReport, false);
  assert.deepEqual(result.markets, []);
  assert.equal(result.model, undefined);
  assert.equal(result.simulation, undefined);
});

test("an overnight UTC kickoff cannot use an earlier same-team schedule row to bypass a current QB conflict", () => {
  const input = fixture();
  input.schedule.unshift({
    ...input.schedule[0], game_id: "2026_02_LAC_BAL", gameday: "2026-09-14", week: "2"
  });
  input.schedule[1].home_qb_name = "Tyler Huntley";
  const result = projectEvent(input);
  assert.equal(result.available, false);
  assert.equal(result.gameContext.availability.home.source.scheduleGameId, "2026_10_LAC_BAL");
  assert.match(result.forecastReadiness.reasons.join(" "), /Tyler Huntley.*Jacoby Brissett/);
  assert.deepEqual(result.markets, []);
});

test("current schedule matching uses the Eastern source date in both daylight and standard time", () => {
  for (const [gameday, startsAt, asOf] of [
    ["2026-09-24", "2026-09-25T00:15:00Z", "2026-09-24T20:00:00Z"],
    ["2026-11-16", "2026-11-17T01:15:00Z", "2026-11-16T20:00:00Z"]
  ]) {
    const input = fixture();
    input.event.startsAt = startsAt;
    input.asOf = asOf;
    input.schedule[0].gameday = gameday;
    input.depthCharts.forEach((row) => { row.dt = `${gameday}T12:00:00Z`; });
    input.schedule.unshift({
      ...input.schedule[0], game_id: "earlier-same-pair", gameday: "2026-09-01", home_qb_name: "Tyler Huntley"
    });
    const result = projectEvent(input);
    assert.equal(result.available, true);
    assert.equal(result.gameContext.availability.home.source.scheduleGameId, "2026_10_LAC_BAL");
    assert.equal(result.gameContext.homeQB, "Jacoby Brissett");
  }
});

for (const [label, modify] of [
  ["missing exact source date", (input) => { input.schedule[0].gameday = "2026-09-14"; }],
  ["ambiguous exact source date", (input) => { input.schedule.push({ ...input.schedule[0], game_id: "duplicate" }); }]
]) {
  test(`${label} blocks the current forecast instead of falling back to another game`, () => {
    const input = fixture();
    modify(input);
    const result = projectEvent(input);
    assert.equal(result.available, false);
    assert.equal(result.forecastReadiness.available, false);
    assert.match(result.forecastReadiness.reasons.join(" "), /schedule/i);
    assert.deepEqual(result.markets, []);
  });
}

test("current agreeing QB sources permit a shadow forecast with explicit probability provenance", () => {
  const result = projectEvent(fixture());
  assert.equal(result.available, true);
  assert.equal(result.forecastReadiness.available, true);
  assert.deepEqual(result.forecastReadiness.reasons, []);
  assert.equal(result.gameContext.availability.home.expected, "Jacoby Brissett");
  for (const market of result.markets) {
    assert.equal(market.calibrationVersion, "NFL Market Shrinkage Calibration v1");
    assert.equal(market.productionEligible, false);
    if (market.marketType === "total") {
      assert.equal(market.probabilitySource, "market_blend");
      assert.equal(market.independentContributionWeight, 0.1225);
    } else {
      assert.equal(market.probabilitySource, "market_only");
      assert.equal(market.independentContributionWeight, 0);
      assert.equal(market.modelProbability, market.marketFairProbability);
    }
  }
});

for (const [label, modify] of [
  ["missing depth feed", (input) => { input.depthCharts = []; }],
  ["missing scheduled QB", (input) => { input.schedule[0].home_qb_name = ""; }],
  ["undated depth evidence", (input) => { input.depthCharts[0].dt = ""; }],
  ["depth evidence older than 48 hours", (input) => { input.depthCharts[0].dt = "2026-11-14T19:59:59Z"; }],
  ["future depth evidence", (input) => { input.depthCharts[0].dt = "2026-11-16T21:00:00Z"; }],
  ["after-kickoff depth evidence", (input) => {
    input.asOf = "2026-11-17T03:00:00Z";
    input.depthCharts[0].dt = "2026-11-17T01:16:00Z";
  }],
  ["backup-only depth evidence", (input) => { input.depthCharts[0].pos_rank = "2"; }],
  ["conflicting QB1 names", (input) => {
    input.depthCharts.push({ ...input.depthCharts[0], player_name: "Tyler Huntley" });
  }],
  ["invalid event time", (input) => { input.event.startsAt = "not-a-date"; }]
]) {
  test(`${label} cannot silently verify starter readiness`, () => {
    const input = fixture();
    modify(input);
    const result = projectEvent(input);
    assert.equal(result.available, false);
    assert.equal(result.forecastReadiness.available, false);
    assert.ok(result.forecastReadiness.reasons.length > 0);
    assert.deepEqual(result.markets, []);
    assert.equal(result.simulation, undefined);
  });
}

test("future rows cannot override the current agreeing depth chart", () => {
  const input = fixture();
  input.depthCharts.push({ ...input.depthCharts[0], dt: "2026-11-16T21:00:00Z", player_name: "Tyler Huntley" });
  const result = projectEvent(input);
  assert.equal(result.available, true);
  assert.equal(result.gameContext.availability.home.depthChartQb1, "Jacoby Brissett");
  assert.equal(result.gameContext.availability.home.expected, "Jacoby Brissett");
});

test("historical replay keeps the existing disabled-availability forecast semantics", () => {
  const input = fixture();
  input.schedule[0].home_qb_name = "Tyler Huntley";
  input.disableAvailabilityAdjustments = true;
  const result = projectEvent(input);
  assert.equal(result.available, true);
  assert.equal(result.gameContext.availability.home.expected, "Tyler Huntley");
  assert.equal(result.gameContext.availability.home.adjustmentPoints, -0.45);
  assert.equal(result.model.availabilityAdjustmentApplied, false);
  assert.equal(result.model.qbAdjustmentPoints, 0);
  assert.equal(result.model.independentHomeMargin, 2);
  assert.equal(result.model.projectedHomeMargin, 3.02);
  assert.equal(result.model.projectedTotal, 44.255);
  assert.equal(result.markets.length, 6);
  input.depthCharts = [];
  assert.equal(projectEvent(input).available, true);
});
