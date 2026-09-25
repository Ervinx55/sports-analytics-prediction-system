import test from "node:test";
import assert from "node:assert/strict";

import {
  backtestPlayerStats
} from "../../scripts/nba/backtest-nba-player-props.mjs";

function row(id, date, season, pts, reb, ast, min = "36:00") {
  return {
    id,
    min,
    fga: 18,
    fta: 6,
    turnover: 3,
    pts,
    reb,
    ast,
    fg3m: 4,
    blk: 1,
    stl: 1,
    player: {
      id: 100,
      first_name: "Sample",
      last_name: "Player"
    },
    team: {
      id: 2,
      full_name: "Boston Celtics",
      abbreviation: "BOS"
    },
    game: {
      id,
      date,
      season,
      datetime: `${date}T23:30:00Z`
    }
  };
}

test("NBA player props backtest is chronological and keeps 2025 untouched", () => {
  const rows = [
    row(1, "2024-10-22", 2024, 20, 7, 4),
    row(2, "2024-10-24", 2024, 22, 8, 5),
    row(3, "2024-10-26", 2024, 24, 8, 5),
    row(4, "2024-10-28", 2024, 26, 9, 6),
    row(5, "2024-10-30", 2024, 28, 9, 6),
    row(6, "2024-11-01", 2024, 30, 10, 7),
    row(7, "2024-11-03", 2024, 32, 10, 7),
    row(8, "2025-10-22", 2025, 99, 20, 20)
  ];

  const report = backtestPlayerStats(rows, {
    season: 2024,
    minimumPriorGames: 4
  });

  assert.equal(report.season, 2024);
  assert.equal(report.holdoutSeason, 2025);
  assert.equal(report.holdoutTouched, false);
  assert.equal(report.markets.points.model.rows, 3);
  assert.equal(report.rowsByMarket.points[0].gameID, 5);
  assert.equal(report.rowsByMarket.points.at(-1).gameID, 7);
  assert.ok(
    report.rowsByMarket.points.every(
      (item) => item.gameID !== 8
    )
  );
  assert.ok(
    Number.isFinite(report.markets.points.model.mae)
  );
  assert.ok(
    Number.isFinite(report.markets.points.baseline.mae)
  );
});
