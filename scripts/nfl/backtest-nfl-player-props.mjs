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
    row.player ||
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

function playerKey(row = {}) {
  return playerId(row) || normalizePlayerName(playerName(row));
}

function indexBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows || []) {
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function mergeTeamAndPlayerRows(teamRows, playerRows, team) {
  const out = [...(teamRows || [])];
  for (const row of playerRows || []) {
    if (rowTeam(row) !== team) out.push(row);
  }
  return out;
}

function scheduleGame(schedule, season, week, team) {
  return schedule.find((game) =>
    num(game.season) === season &&
    num(game.week) === week &&
    String(game.game_type || "") === "REG" &&
    [game.home_team, game.away_team].includes(team)
  ) || null;
}

function zonedWallTimeToIso(
  dateText,
  timeText,
  timeZone = "America/New_York"
) {
  const dateMatch = String(dateText || "").match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );
  const timeMatch = String(timeText || "").match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!dateMatch || !timeMatch) return null;

  const desired = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: Number(timeMatch[3] || 0)
  };
  const desiredAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second
  );
  let guess = desiredAsUtc;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    const observedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    guess += desiredAsUtc - observedAsUtc;
  }

  return new Date(guess).toISOString();
}

function historicalKickoffIso(game) {
  const exact = zonedWallTimeToIso(
    game.gameday,
    game.gametime,
    "America/New_York"
  );
  if (exact) return exact;

  // Conservative fallback: noon UTC on game day. This intentionally
  // excludes uncertain same-day features rather than allowing leakage.
  return `${game.gameday}T12:00:00Z`;
}

function eventFromGame(game) {
  const spreadLine = num(game.spread_line);
  const totalLine = num(game.total_line);
  return {
    eventID: game.game_id,
    startsAt: historicalKickoffIso(game),
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

const RESIDUAL_WEIGHT_GRID = Array.from(
  { length: 21 },
  (_, index) => index / 20
);

function anchoredPrediction(row, weight) {
  if (!Number.isFinite(row.baseline)) return row.prediction;
  return row.baseline + weight * (row.prediction - row.baseline);
}

function metrics(rows, predictionFn = (row) => row.prediction) {
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
  let modelRows = 0;
  let baselineAbsolute = 0;
  let baselineRows = 0;

  for (const row of rows) {
    const prediction = predictionFn(row);
    if (Number.isFinite(prediction)) {
      const error = prediction - row.actual;
      absolute += Math.abs(error);
      squared += error ** 2;
      signed += error;
      modelRows += 1;
    }

    if (Number.isFinite(row.baseline)) {
      baselineAbsolute += Math.abs(row.baseline - row.actual);
      baselineRows += 1;
    }
  }

  const mae = modelRows > 0 ? absolute / modelRows : null;
  const baselineMae =
    baselineRows > 0 ? baselineAbsolute / baselineRows : null;

  return {
    rows: modelRows,
    mae,
    rmse: modelRows > 0 ? Math.sqrt(squared / modelRows) : null,
    bias: modelRows > 0 ? signed / modelRows : null,
    baselineRows,
    baselineMae,
    maeImprovementVsRollingMean:
      baselineMae === null || mae === null
        ? null
        : baselineMae - mae
  };
}

function residualCalibration(rows, {
  calibrationMaxWeek = 10,
  validationMinWeek = 11
} = {}) {
  const eligible = rows.filter(
    (row) =>
      Number.isFinite(row.actual) &&
      Number.isFinite(row.prediction) &&
      Number.isFinite(row.baseline)
  );
  const calibrationRows = eligible.filter(
    (row) => Number(row.week) <= calibrationMaxWeek
  );
  const validationRows = eligible.filter(
    (row) => Number(row.week) >= validationMinWeek
  );

  if (calibrationRows.length < 25 || validationRows.length < 25) {
    return {
      selectedWeight: 0,
      acceptedWeight: 0,
      calibrationRows: calibrationRows.length,
      validationRows: validationRows.length,
      accepted: false,
      reason: "Insufficient split-development rows.",
      calibration: metrics(calibrationRows, (row) =>
        anchoredPrediction(row, 0)
      ),
      validation: metrics(validationRows, (row) =>
        anchoredPrediction(row, 0)
      )
    };
  }

  const candidates = RESIDUAL_WEIGHT_GRID.map((weight) => ({
    weight,
    metrics: metrics(calibrationRows, (row) =>
      anchoredPrediction(row, weight)
    )
  })).sort((a, b) => {
    const aMae = Number.isFinite(a.metrics.mae)
      ? a.metrics.mae
      : Number.POSITIVE_INFINITY;
    const bMae = Number.isFinite(b.metrics.mae)
      ? b.metrics.mae
      : Number.POSITIVE_INFINITY;
    return aMae - bMae || a.weight - b.weight;
  });

  const selected = candidates[0];
  const validation = metrics(validationRows, (row) =>
    anchoredPrediction(row, selected.weight)
  );
  const baselineValidation = metrics(validationRows, (row) =>
    anchoredPrediction(row, 0)
  );
  const improvement =
    Number.isFinite(validation.mae) &&
    Number.isFinite(baselineValidation.mae)
      ? baselineValidation.mae - validation.mae
      : null;
  const minimumImprovement =
    Number.isFinite(baselineValidation.mae)
      ? Math.max(0.01, baselineValidation.mae * 0.0025)
      : Number.POSITIVE_INFINITY;
  const accepted =
    selected.weight > 0 &&
    Number.isFinite(improvement) &&
    improvement >= minimumImprovement;
  const acceptedWeight = accepted ? selected.weight : 0;

  return {
    selectedWeight: selected.weight,
    acceptedWeight,
    calibrationRows: calibrationRows.length,
    validationRows: validationRows.length,
    accepted,
    reason: accepted
      ? "Residual weight beat the rolling baseline on the later 2024 development split."
      : "Selected residual weight failed the later 2024 development gate; keep baseline-only.",
    minimumValidationImprovement: minimumImprovement,
    calibration: selected.metrics,
    validation,
    validationImprovementVsBaseline: improvement,
    acceptedValidation: metrics(validationRows, (row) =>
      anchoredPrediction(row, acceptedWeight)
    ),
    grid: candidates.map((candidate) => ({
      weight: candidate.weight,
      mae: candidate.metrics.mae
    }))
  };
}

async function backtestSeason(season, minWeek) {
  const [nflData, playerData] = await Promise.all([
    loadNflData(season),
    loadNflPlayerData(season)
  ]);

  const statsByTeam = indexBy(
    playerData.playerStats,
    (row) => rowTeam(row)
  );
  const statsByPlayer = indexBy(
    playerData.playerStats,
    (row) => playerKey(row)
  );
  const snapsByPlayer = indexBy(
    playerData.snapCounts,
    (row) => normalizePlayerName(playerName(row))
  );
  const ngsByTypePlayer = Object.fromEntries(
    Object.entries(playerData.ngs).map(([type, rows]) => [
      type,
      indexBy(rows, (row) => normalizePlayerName(playerName(row)))
    ])
  );
  const depthChartsByTeam = indexBy(
    nflData.depthCharts,
    (row) => rowTeam(row)
  );
  const opponentSnapshotCache = new Map();

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
    const normalizedPlayer = normalizePlayerName(playerName(target));
    const playerRows =
      statsByPlayer.get(playerKey(target)) || [];
    const scopedStats = mergeTeamAndPlayerRows(
      statsByTeam.get(team) || [],
      playerRows,
      team
    );
    const scopedSnaps =
      snapsByPlayer.get(normalizedPlayer) || [];
    const scopedNgs = Object.fromEntries(
      Object.entries(ngsByTypePlayer).map(([type, index]) => [
        type,
        index.get(normalizedPlayer) || []
      ])
    );
    const snapshotKey = `${game.game_id}|${opponent}`;
    let opponentSnapshot = opponentSnapshotCache.get(snapshotKey);
    if (!opponentSnapshot) {
      opponentSnapshot = teamSnapshot(
        nflData.schedule,
        nflData.stats,
        season,
        opponent,
        {
          beforeDate: game.gameday,
          beforeWeek: week
        }
      );
      opponentSnapshotCache.set(snapshotKey, opponentSnapshot);
    }

    const opportunity = projectPlayerOpportunity({
      playerName: playerName(target),
      event,
      schedule: nflData.schedule,
      season,
      playerStats: scopedStats,
      snapCounts: scopedSnaps,
      ngs: scopedNgs,
      depthCharts: depthChartsByTeam.get(team) || [],
      weatherContext: null,
      opponentSnapshot
    });

    qualityCounts[opportunity.dataQuality] =
      (qualityCounts[opportunity.dataQuality] || 0) + 1;
    targetPlayers += 1;

    for (const [market, actualField] of targetMarkets(target)) {
      const actual = num(target[actualField]);
      const projection = opportunity.projections?.[market];
      const prediction = num(
        projection?.opportunityMean ?? projection?.mean
      );
      if (actual === null || prediction === null) continue;

      const baseline = priorMetricMean({
        rows: playerRows,
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
  const developmentCalibration = Object.fromEntries(
    Object.entries(rowsByMarket).map(([market, rows]) => [
      market,
      residualCalibration(rows)
    ])
  );

  return {
    season,
    minWeek,
    targetPlayers,
    skippedNoGame,
    qualityCounts,
    marketMetrics,
    developmentCalibration,
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
    marketMetrics: season.marketMetrics,
    developmentCalibration: season.developmentCalibration
  }));

  const report = {
    version: "NFL Player Props v2 baseline-anchored development backtest",
    generatedAt: new Date().toISOString(),
    seasons,
    minWeek,
    leakagePolicy:
      "Target-game statistics are unavailable until the following day. Snap counts, NGS, and depth-chart rows are filtered by their live-availability timestamps before the actual scheduled kickoff (nflverse gametime, Eastern); missing kickoff times use a conservative noon-UTC cutoff.",
    historicalWeatherPolicy:
      "Historical finalized weather is intentionally excluded because it is not equivalent to a pregame forecast.",
    developmentPolicy:
      "Within 2024, weeks 4-10 select a residual weight and weeks 11+ must independently confirm improvement over the rolling player baseline. 2025 is not used by this development workflow.",
    marketCalibrationAvailable: false,
    promotion: {
      productionEligible: false,
      productionWeight: 0,
      blocker:
        "Historical sharp player-prop line/price snapshots have not yet been ingested. This report validates raw projection error only and cannot authorize production betting weight."
    },
    aggregate: aggregateMetrics,
    developmentCalibration:
      seasonReports.length === 1 && seasonReports[0].season === 2024
        ? seasonReports[0].developmentCalibration
        : null,
    seasonsDetail: compactSeasons
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  if (report.developmentCalibration) {
    fs.writeFileSync(
      path.join(outputDir, "v2-calibration.json"),
      JSON.stringify({
        version: report.version,
        policy: report.developmentPolicy,
        markets: report.developmentCalibration,
        frozenWeights: Object.fromEntries(
          Object.entries(report.developmentCalibration).map(
            ([market, item]) => [market, item.acceptedWeight]
          )
        )
      }, null, 2) + "\n"
    );
  }

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
        developmentCalibration: report.developmentCalibration,
        seasons: compactSeasons,
        promotion: report.promotion
      })
  );
}

await main();
