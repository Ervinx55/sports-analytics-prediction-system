import test from "node:test";
import assert from "node:assert/strict";

import {
  backtestGames
} from "../../scripts/nba/backtest-nba-team-model.mjs";

function team(abbreviation, fullName) {
  return {
    abbreviation,
    full_name: fullName,
    name: fullName.split(" ").at(-1)
  };
}

const BOS = team("BOS", "Boston Celtics");
const LAL = team("LAL", "Los Angeles Lakers");

function game(id, date, homeScore, awayScore) {
  return {
    id,
    date,
    datetime: `${date}T23:30:00.000Z`,
    season: 2024,
    status: "Final",
    status_state: "final",
    postseason: false,
    home_team: id % 2 ? BOS : LAL,
    visitor_team: id % 2 ? LAL : BOS,
    home_team_score: homeScore,
    visitor_team_score: awayScore
  };
}

test("NBA backtest is chronological and enforces prior-game minimums", () => {
  const games = [
    game(1, "2024-10-22", 112, 108),
    game(2, "2024-10-24", 115, 110),
    game(3, "2024-10-26", 118, 111),
    game(4, "2024-10-28", 109, 107),
    game(5, "2024-10-30", 120, 114),
    game(6, "2024-11-01", 116, 112),
    game(7, "2024-11-03", 122, 115)
  ];

  const report = backtestGames(games, {
    season: 2024,
    minimumPriorGames: 4,
    simulationIterations: 500
  });

  assert.equal(report.season, 2024);
  assert.equal(report.gamesEvaluated, 3);
  assert.deepEqual(
    report.rows.map((row) => row.eventID),
    ["bdl:5", "bdl:6", "bdl:7"]
  );
  assert.ok(report.rows.every((row) => row.homePriorGames >= 4));
  assert.ok(report.rows.every((row) => row.awayPriorGames >= 4));
  assert.ok(Number.isFinite(report.metrics.margin.modelMae));
  assert.ok(Number.isFinite(report.metrics.total.modelMae));
  assert.ok(Number.isFinite(report.metrics.moneyline.modelBrier));
});
