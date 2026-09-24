import fs from "node:fs";
import path from "node:path";

import {
  loadNflData,
  normalizeTeam,
  teamSnapshot
} from "../../sharp-service/lib/nfl-model.js";
import {
  loadNflPlayerData,
  normalizePlayerName,
  projectPlayerOpportunity
} from "../../sharp-service/lib/nfl-player-props.js";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function playerName(row = {}) {
  return (
    row.player_display_name ||
    row.player_name ||
    row.full_name ||
    row.name ||
    ""
  );
}

function playerId(row = {}) {
  return (
    row.player_id ||
    row.player_gsis_id ||
    row.gsis_id ||
    row.pfr_player_id ||
    null
  );
}

function rowTeam(row = {}) {
  return normalizeTeam(
    row.team ||
    row.recent_team ||
    row.club_code ||
    row.team_abbr ||
    row.team_abbreviation
  );
}

function rowPosition(row = {}) {
  return String(
    row.position ||
    row.position_group ||
    row.pos ||
    row.pos_abb ||
    ""
  ).toUpperCase();
}

function scheduleGame(schedule, season, week, team) {
  return schedule.find((game) =>
    num(game.season) === season &&
    num(game.week) === week &&
    String(game.game_type || "") === "REG" &&
    [game.home_team, game.away_team].includes(team)
  ) || null;
}

function eventFromGame(game) {
  const spreadLine = num(game.spread_line);
  const totalLine = num(game.total_line);
  return {
    eventID: game.game_id,
    startsAt: `${game.gameday}T23:59:00Z`,
    matchup: {
      away: {
        name: game.away_team,
        short: game.away_team
      },
      home: {
        name: game.home_team,
        short: game.home_team
      }
    },
    markets: {
      spread: {
        away: {
          consensus: {
            line: spreadLine === null ? null : spreadLine
          }
        },
        home: {
          consensus: {
            line: spreadLine === null ? null : -spreadLine
          }
        }
      },
      total: {
        over: { consensus: { line: totalLine } },
        under: { consensus: { line: totalLine } }
      }
    }
  };
}

function targetMarkets(row) {
  const position = rowPosition(row);
  const markets = [];
  if (position === "QB") {
    markets.push(
      ["passing_yards", "passing_yards"],
      ["passing_touchdowns", "passing_tds"]
    );
  }
  if (["RB", "FB"].includes(position)) {
    markets.push(["rushing_yards", "rushing_yards"]);
  }
  if (["WR", "TE"].includes(position)) {
    markets.push(
      ["receiving_receptions", "receptions"],
      ["receiving_yards", "receiving_yards"]
    );
  }
  return markets;
}

function priorMetricMean({
  rows,
  schedule,
  targetRow,
  season,
  week,
  field,
  limit = 4
}) {
  const id = playerId(targetRow);
  const normalized = normalizePlayerName(playerName(targetRow));
  const team = rowTeam(targetRow);
  const values = rows
    .filter((row) => {
      if (num(row.season) !== season) return false;
      const rowWeek = num(row.week);
      if (rowWeek === null || rowWeek >= week) return false;
      if (rowTeam(row) !== team) return false;
      const samePlayer = id
        ? playerId(row) === id
        : normalizePlayerName(playerName(row)) === normalized;
      if (!samePlayer) return false;
      const game = scheduleGame(schedule, season, rowWeek, team);
      return Boolean(game);
    })
    .sort((a, b) => (num(b.week) ?? 0) - (num(a.week) ?? 0))
    .map((row) => num(row[field]))
    .filter(Number.isFinite)
    .slice(0, limit);

  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metrics(rows) {
  if (!rows.length) {
    return {
      rows: 0,
      mae: null,
      rmse: null,
      bias: null,
      baselineMae: null,
      maeImprovementVsRollingMean: null
    };
  }

  let absolute = 0;
  let squared = 0;
  let signed = 0;
  let baselineAbsolute = 0;
  let baselineRows = 0;

  for (const row of rows) {
    const error = row.prediction - row.actual;
    absolute += Math.abs(error);
    squared += error ** 2;
    signed += error;

    if (Number.isFinite(row.baseline)) {
      baselineAbsolute += Math.abs(row.baseline - row.actual);
      baselineRows += 1;
    }
  }

  const mae = absolute / rows.length;
  const baselineMae =
    baselineRows > 0 ? baselineAbsolute / baselineRows : null;

  return {
    rows: rows.length,
    mae,
    rmse: Math.sqrt(squared / rows.length),
    bias: signed / rows.length,
    baselineRows,
    baselineMae,
    maeImprovementVsRollingMean:
      baselineMae === null ? null : baselineMae - mae
  };
}

async function backtestSeason(season, minWeek) {
  const [nflData, playerData] = await Promise.all([
    loadNflData(season),
    loadNflPlayerData(season)
  ]);

  const targetRows = playerData.playerStats
    .filter((row) => {
      const week = num(row.week);
      return (
        num(row.season) === season &&
        week !== null &&
        week >= minWeek &&
        rowTeam(row) &&
        targetMarkets(row).length > 0
      );
    })
    .sort((a, b) => {
      const weekDiff = (num(a.week) ?? 0) - (num(b.week) ?? 0);
      if (weekDiff) return weekDiff;
      return playerName(a).localeCompare(playerName(b));
    });

  const rowsByMarket = {
    passing_yards: [],
    passing_touchdowns: [],
    rushing_yards: [],
    receiving_receptions: [],
    receiving_yards: []
  };
  const qualityCounts = { A: 0, B: 0, C: 0, D: 0 };
  let targetPlayers = 0;
  let skippedNoGame = 0;

  for (const target of targetRows) {
    const week = num(target.week);
    const team = rowTeam(target);
    const game = scheduleGame(nflData.schedule, season, week, team);
    if (!game) {
      skippedNoGame += 1;
      continue;
    }

    const event = eventFromGame(game);
    const opponent =
      game.home_team === team ? game.away_team : game.home_team;
    const opponentSnapshot = teamSnapshot(
      nflData.schedule,
      nflData.stats,
      season,
      opponent,
      {
        beforeDate: game.gameday,
        beforeWeek: week
      }
    );

    const opportunity = projectPlayerOpportunity({
      playerName: playerName(target),
      event,
      schedule: nflData.schedule,
      season,
      playerStats: playerData.playerStats,
      snapCounts: playerData.snapCounts,
      ngs: playerData.ngs,
      depthCharts: nflData.depthCharts,
      weatherContext: null,
      opponentSnapshot
    });

    qualityCounts[opportunity.dataQuality] =
      (qualityCounts[opportunity.dataQuality] || 0) + 1;
    targetPlayers += 1;

    for (const [market, actualField] of targetMarkets(target)) {
      const actual = num(target[actualField]);
      const prediction = num(opportunity.projections?.[market]?.mean);
      if (actual === null || prediction === null) continue;

      const baseline = priorMetricMean({
        rows: playerData.playerStats,
        schedule: nflData.schedule,
        targetRow: target,
        season,
        week,
        field: actualField
      });

      rowsByMarket[market].push({
        season,
        week,
        gameId: game.game_id,
        player: playerName(target),
        position: rowPosition(target),
        team,
        opponent,
        dataQuality: opportunity.dataQuality,
        prediction,
        actual,
        baseline
      });
    }
  }

  const marketMetrics = Object.fromEntries(
    Object.entries(rowsByMarket).map(([market, rows]) => [
      market,
      metrics(rows)
    ])
  );

  return {
    season,
    minWeek,
    targetPlayers,
    skippedNoGame,
    qualityCounts,
    marketMetrics,
    rowsByMarket
  };
}

function aggregate(seasonReports) {
  const markets = [
    "passing_yards",
    "passing_touchdowns",
    "rushing_yards",
    "receiving_receptions",
    "receiving_yards"
  ];
  const out = {};
  for (const market of markets) {
    const rows = seasonReports.flatMap(
      (season) => season.rowsByMarket[market]
    );
    out[market] = metrics(rows);
  }
  return out;
}

async function main() {
  const seasons = String(argValue("seasons", "2024,2025"))
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(Number.isFinite);
  const minWeek = Number(argValue("min-week", "4"));
  const outputDir = argValue(
    "output-dir",
    "artifacts/nfl-player-props-backtest"
  );

  const seasonReports = [];
  for (const season of seasons) {
    seasonReports.push(await backtestSeason(season, minWeek));
  }

  const aggregateMetrics = aggregate(seasonReports);
  const compactSeasons = seasonReports.map((season) => ({
    season: season.season,
    minWeek: season.minWeek,
    targetPlayers: season.targetPlayers,
    skippedNoGame: season.skippedNoGame,
    qualityCounts: season.qualityCounts,
    marketMetrics: season.marketMetrics
  }));

  const report = {
    version: "NFL Player Opportunity Engine v1.1 chronological backtest",
    generatedAt: new Date().toISOString(),
    seasons,
    minWeek,
    leakagePolicy:
      "Target-game statistics are unavailable until the following day. Snap counts, NGS, and depth-chart rows are filtered by their live-availability timestamps before each historical kickoff.",
    historicalWeatherPolicy:
      "Historical finalized weather is intentionally excluded because it is not equivalent to a pregame forecast.",
    marketCalibrationAvailable: false,
    promotion: {
      productionEligible: false,
      productionWeight: 0,
      blocker:
        "Historical sharp player-prop line/price snapshots have not yet been ingested. This report validates raw projection error only and cannot authorize production betting weight."
    },
    aggregate: aggregateMetrics,
    seasonsDetail: compactSeasons
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );

  const lines = [
    "# NFL Player Props Walk-Forward Backtest",
    "",
    `Seasons: ${seasons.join(", ")} | Minimum week: ${minWeek}`,
    "",
    "| Market | Rows | MAE | RMSE | Bias | Rolling-Mean MAE | Δ MAE vs Baseline |",
    "|---|---:|---:|---:|---:|---:|---:|"
  ];

  for (const market of Object.keys(aggregateMetrics)) {
    const item = aggregateMetrics[market];
    const fmt = (value) =>
      Number.isFinite(value) ? value.toFixed(3) : "n/a";
    lines.push(
      `| ${market} | ${item.rows} | ${fmt(item.mae)} | ${fmt(item.rmse)} | ${fmt(item.bias)} | ${fmt(item.baselineMae)} | ${fmt(item.maeImprovementVsRollingMean)} |`
    );
  }

  lines.push(
    "",
    "**Production eligible: no.**",
    "",
    "This stage measures projection accuracy only. Promotion remains blocked until historical sharp prop prices are available for 2024 calibration and untouched 2025 market validation."
  );

  fs.writeFileSync(
    path.join(outputDir, "summary.md"),
    lines.join("\n") + "\n"
  );

  console.log(
    "NFL_PLAYER_PROPS_BACKTEST_SUMMARY=" +
      JSON.stringify({
        aggregate: aggregateMetrics,
        seasons: compactSeasons,
        promotion: report.promotion
      })
  );
}

await main();
