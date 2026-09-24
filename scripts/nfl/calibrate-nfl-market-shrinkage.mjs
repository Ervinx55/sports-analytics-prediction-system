import fs from "node:fs";
import path from "node:path";

import {
  leagueBaselines,
  loadNflData,
  projectEvent,
  teamSnapshot
} from "../../sharp-service/lib/nfl-model.js";

const SHRINKAGE_GRID = [0, 0.25, 0.5, 0.75, 1];

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function impliedProbability(odds) {
  const value = num(odds);
  if (value === null || value === 0) return null;
  return value > 0
    ? 100 / (value + 100)
    : -value / (-value + 100);
}

function noVig(side, opponent) {
  const a = impliedProbability(side);
  const b = impliedProbability(opponent);
  if (a === null || b === null || a + b <= 0) return null;
  return a / (a + b);
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const value = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * value);
  const y = 1 -
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) *
      t * Math.exp(-value * value);
  return sign * y;
}

function normalCdf(x, mean, sd) {
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

function independentProbability(record, market) {
  if (market === "moneyline") {
    return 1 - normalCdf(0, record.independentHomeMargin, 13.6);
  }
  if (market === "spread") {
    return 1 - normalCdf(
      record.spreadLine,
      record.independentHomeMargin,
      13.6
    );
  }
  return 1 - normalCdf(
    record.totalLine,
    record.independentTotal,
    13.8
  );
}

function blendedProbability(record, market, shrinkage) {
  const marketProbability = record[market].marketProbability;
  const independent = independentProbability(record, market);
  const effectiveWeight = record.dynamicIndependentWeight * shrinkage;
  return Math.min(
    1 - 1e-6,
    Math.max(
      1e-6,
      marketProbability +
        effectiveWeight * (independent - marketProbability)
    )
  );
}

function metrics(records, market, shrinkage) {
  const usable = records.filter((record) => record[market]);
  if (!usable.length) {
    return { rows: 0, brier: null, logLoss: null, ece: null };
  }
  let brier = 0;
  let logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({
    count: 0,
    probability: 0,
    outcome: 0
  }));
  for (const record of usable) {
    const probability = blendedProbability(record, market, shrinkage);
    const outcome = record[market].outcome;
    brier += (probability - outcome) ** 2;
    logLoss += -(
      outcome * Math.log(probability) +
      (1 - outcome) * Math.log(1 - probability)
    );
    const index = Math.min(9, Math.floor(probability * 10));
    bins[index].count += 1;
    bins[index].probability += probability;
    bins[index].outcome += outcome;
  }
  let ece = 0;
  for (const bin of bins) {
    if (!bin.count) continue;
    ece +=
      (bin.count / usable.length) *
      Math.abs(
        bin.probability / bin.count -
        bin.outcome / bin.count
      );
  }
  return {
    rows: usable.length,
    brier: brier / usable.length,
    logLoss: logLoss / usable.length,
    ece
  };
}

function objective(result) {
  return result.brier + 0.25 * result.logLoss + 0.05 * result.ece;
}

function marketObject(odds, line = null) {
  if (num(odds) === null) return null;
  return {
    consensus: { odds: num(odds), line },
    books: {
      close_a: { odds: num(odds), line, available: true },
      close_b: { odds: num(odds), line, available: true }
    }
  };
}

function eventFromGame(game) {
  const spreadLine = num(game.spread_line);
  const totalLine = num(game.total_line);
  return {
    eventID: game.game_id,
    startsAt: `${game.gameday}T12:00:00Z`,
    matchup: {
      away: { name: game.away_team, short: game.away_team },
      home: { name: game.home_team, short: game.home_team }
    },
    markets: {
      moneyline: {
        away: marketObject(game.away_moneyline),
        home: marketObject(game.home_moneyline)
      },
      spread: {
        away: marketObject(
          game.away_spread_odds,
          spreadLine === null ? null : spreadLine
        ),
        home: marketObject(
          game.home_spread_odds,
          spreadLine === null ? null : -spreadLine
        )
      },
      total: {
        over: marketObject(game.over_odds, totalLine),
        under: marketObject(game.under_odds, totalLine)
      }
    }
  };
}

async function seasonRecords(season, minWeek = 4) {
  const data = await loadNflData(season);
  const games = data.schedule
    .filter((game) =>
      num(game.season) === season &&
      game.game_type === "REG" &&
      (num(game.week) ?? 0) >= minWeek &&
      num(game.away_score) !== null &&
      num(game.home_score) !== null
    )
    .sort((a, b) =>
      String(a.gameday).localeCompare(String(b.gameday)) ||
      (num(a.week) ?? 0) - (num(b.week) ?? 0)
    );

  const teams = [...new Set(
    data.schedule
      .filter((game) => num(game.season) === season)
      .flatMap((game) => [game.away_team, game.home_team])
  )];

  const records = [];
  for (const game of games) {
    const week = num(game.week);
    const snapshots = new Map();
    for (const team of teams) {
      snapshots.set(
        team,
        teamSnapshot(
          data.schedule,
          data.stats,
          season,
          team,
          { beforeDate: game.gameday, beforeWeek: week }
        )
      );
    }
    const baseline = leagueBaselines([...snapshots.values()]);
    const projection = projectEvent({
      event: eventFromGame(game),
      schedule: data.schedule,
      stats: data.stats,
      depthCharts: [],
      snapshots,
      baseline,
      season,
      weatherContext: null,
      sourceHealth: null,
      disableAvailabilityAdjustments: true,
      simulationIterations: 500
    });
    if (!projection.available) continue;

    const homeScore = num(game.home_score);
    const awayScore = num(game.away_score);
    const margin = homeScore - awayScore;
    const total = homeScore + awayScore;
    const spreadLine = num(game.spread_line);
    const totalLine = num(game.total_line);

    const moneylineMarket = noVig(
      game.home_moneyline,
      game.away_moneyline
    );
    const spreadMarket = noVig(
      game.home_spread_odds,
      game.away_spread_odds
    );
    const totalMarket = noVig(game.over_odds, game.under_odds);

    const record = {
      gameId: game.game_id,
      season,
      week,
      independentHomeMargin: projection.model.independentHomeMargin,
      independentTotal: projection.model.independentTotal,
      dynamicIndependentWeight: projection.model.independentWeight,
      spreadLine,
      totalLine,
      moneyline:
        moneylineMarket !== null && margin !== 0
          ? {
              marketProbability: moneylineMarket,
              outcome: margin > 0 ? 1 : 0
            }
          : null,
      spread:
        spreadLine !== null &&
        spreadMarket !== null &&
        Math.abs(margin - spreadLine) > 1e-9
          ? {
              marketProbability: spreadMarket,
              outcome: margin - spreadLine > 0 ? 1 : 0
            }
          : null,
      total:
        totalLine !== null &&
        totalMarket !== null &&
        Math.abs(total - totalLine) > 1e-9
          ? {
              marketProbability: totalMarket,
              outcome: total - totalLine > 0 ? 1 : 0
            }
          : null
    };
    records.push(record);
  }
  return records;
}

function chooseShrinkage(records, market) {
  let best = null;
  for (const shrinkage of SHRINKAGE_GRID) {
    const result = metrics(records, market, shrinkage);
    const candidate = {
      shrinkage,
      metrics: result,
      objective: objective(result)
    };
    if (
      !best ||
      candidate.objective < best.objective - 1e-12 ||
      (
        Math.abs(candidate.objective - best.objective) <= 1e-12 &&
        candidate.shrinkage < best.shrinkage
      )
    ) {
      best = candidate;
    }
  }
  return best;
}

function testReport(records, market, shrinkage) {
  const selected = metrics(records, market, shrinkage);
  const baseline = metrics(records, market, 0);
  return {
    selectedShrinkage: shrinkage,
    model: selected,
    market: baseline,
    brierImprovement: baseline.brier - selected.brier,
    logLossImprovement: baseline.logLoss - selected.logLoss,
    passes:
      selected.rows >= 200 &&
      baseline.brier - selected.brier >= 0.001 &&
      baseline.logLoss - selected.logLoss >= 0.0015 &&
      selected.ece <= baseline.ece + 0.01
  };
}

async function main() {
  const outputDir = "artifacts/nfl-calibration";
  const validationSeason = 2024;
  const testSeason = 2025;
  const validation = await seasonRecords(validationSeason);
  const test = await seasonRecords(testSeason);

  const markets = ["moneyline", "spread", "total"];
  const selection = {};
  const testResults = {};
  for (const market of markets) {
    selection[market] = chooseShrinkage(validation, market);
    testResults[market] = testReport(
      test,
      market,
      selection[market].shrinkage
    );
  }

  const report = {
    version: "NFL Market Shrinkage Calibration v1",
    generatedAt: new Date().toISOString(),
    validationSeason,
    testSeason,
    shrinkageGrid: SHRINKAGE_GRID,
    rule:
      "2024 selects shrinkage. 2025 is untouched and determines whether the specialist can advance.",
    selection,
    test: testResults,
    productionEligible: false,
    allTestMarketsPass: markets.every(
      (market) => testResults[market].passes
    )
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log("NFL_CALIBRATION_SUMMARY=" + JSON.stringify(report));
}

await main();
