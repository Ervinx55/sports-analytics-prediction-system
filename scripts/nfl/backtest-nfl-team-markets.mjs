import fs from "node:fs";
import path from "node:path";

import {
  leagueBaselines,
  loadNflData,
  projectEvent,
  teamSnapshot
} from "../../sharp-service/lib/nfl-model.js";

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

function market(odds, line = null) {
  if (num(odds) === null) return null;
  return {
    consensus: { odds: num(odds), line },
    books: {
      historical_close_a: { odds: num(odds), line, available: true },
      historical_close_b: { odds: num(odds), line, available: true }
    }
  };
}

function eventFromGame(game) {
  const spreadLine = num(game.spread_line);
  const totalLine = num(game.total_line);
  const homeSpread = spreadLine === null ? null : -spreadLine;
  const awaySpread = spreadLine === null ? null : spreadLine;

  return {
    eventID: game.game_id,
    startsAt: `${game.gameday}T12:00:00Z`,
    matchup: {
      away: { name: game.away_team, short: game.away_team },
      home: { name: game.home_team, short: game.home_team }
    },
    markets: {
      moneyline: {
        away: market(game.away_moneyline),
        home: market(game.home_moneyline)
      },
      spread: {
        away: market(game.away_spread_odds, awaySpread),
        home: market(game.home_spread_odds, homeSpread)
      },
      total: {
        over: market(game.over_odds, totalLine),
        under: market(game.under_odds, totalLine)
      }
    }
  };
}

function binaryMetrics(rows) {
  if (!rows.length) {
    return {
      rows: 0,
      brier: null,
      logLoss: null,
      ece: null,
      accuracy: null
    };
  }

  let brier = 0;
  let logLoss = 0;
  let correct = 0;
  const bins = Array.from({ length: 10 }, () => ({
    count: 0,
    probability: 0,
    outcome: 0
  }));

  for (const row of rows) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, row.probability));
    const y = row.outcome;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    if ((p >= 0.5 ? 1 : 0) === y) correct += 1;
    const index = Math.min(9, Math.floor(p * 10));
    bins[index].count += 1;
    bins[index].probability += p;
    bins[index].outcome += y;
  }

  let ece = 0;
  for (const bin of bins) {
    if (!bin.count) continue;
    const averageP = bin.probability / bin.count;
    const averageY = bin.outcome / bin.count;
    ece += (bin.count / rows.length) * Math.abs(averageP - averageY);
  }

  return {
    rows: rows.length,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
    ece,
    accuracy: correct / rows.length
  };
}

function comparison(modelRows, marketRows) {
  const model = binaryMetrics(modelRows);
  const market = binaryMetrics(marketRows);
  return {
    model,
    market,
    brierImprovement:
      model.brier === null || market.brier === null
        ? null
        : market.brier - model.brier,
    logLossImprovement:
      model.logLoss === null || market.logLoss === null
        ? null
        : market.logLoss - model.logLoss
  };
}

function promotionGate(report) {
  const requiredRows = 200;
  const markets = ["moneyline", "spread", "total"];
  const checks = {};

  for (const name of markets) {
    const current = report[name];
    checks[name] = {
      enoughRows: (current?.model?.rows || 0) >= requiredRows,
      brierGain: current?.brierImprovement ?? null,
      logLossGain: current?.logLossImprovement ?? null,
      passes:
        (current?.model?.rows || 0) >= requiredRows &&
        (current?.brierImprovement ?? -Infinity) >= 0.002 &&
        (current?.logLossImprovement ?? -Infinity) >= 0.003 &&
        (current?.model?.ece ?? Infinity) <=
          (current?.market?.ece ?? Infinity) + 0.01
    };
  }

  return {
    productionEligible: false,
    reason:
      "NFL remains shadow-only until every team market clears fixed historical calibration gates.",
    requiredRowsPerMarket: requiredRows,
    checks,
    allMarketsPass: markets.every((name) => checks[name].passes)
  };
}

async function backtestSeason(season, minWeek) {
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

  const rows = {
    moneyline: { model: [], market: [] },
    spread: { model: [], market: [] },
    total: { model: [], market: [] }
  };
  const teams = [...new Set(
    data.schedule
      .filter((game) => num(game.season) === season)
      .flatMap((game) => [game.away_team, game.home_team])
  )];

  for (const game of games) {
    const beforeDate = game.gameday;
    const beforeWeek = num(game.week);
    const snapshots = new Map();
    for (const team of teams) {
      snapshots.set(
        team,
        teamSnapshot(
          data.schedule,
          data.stats,
          season,
          team,
          { beforeDate, beforeWeek }
        )
      );
    }
    const baseline = leagueBaselines([...snapshots.values()]);
    const event = eventFromGame(game);
    const projection = projectEvent({
      event,
      schedule: data.schedule,
      stats: data.stats,
      depthCharts: [],
      snapshots,
      baseline,
      season,
      weatherContext: null,
      sourceHealth: null,
      disableAvailabilityAdjustments: true
    });
    if (!projection.available) continue;

    const awayScore = num(game.away_score);
    const homeScore = num(game.home_score);
    const margin = homeScore - awayScore;
    const total = homeScore + awayScore;

    const homeMlMarket = noVig(
      game.home_moneyline,
      game.away_moneyline
    );
    if (homeMlMarket !== null && margin !== 0) {
      const outcome = margin > 0 ? 1 : 0;
      rows.moneyline.model.push({
        probability: projection.simulation.moneyline.home,
        outcome
      });
      rows.moneyline.market.push({
        probability: homeMlMarket,
        outcome
      });
    }

    const spreadLine = num(game.spread_line);
    const homeSpreadMarket = noVig(
      game.home_spread_odds,
      game.away_spread_odds
    );
    if (spreadLine !== null && homeSpreadMarket !== null) {
      const adjusted = margin - spreadLine;
      if (Math.abs(adjusted) > 1e-9) {
        const outcome = adjusted > 0 ? 1 : 0;
        rows.spread.model.push({
          probability: projection.simulation.spread.home,
          outcome
        });
        rows.spread.market.push({
          probability: homeSpreadMarket,
          outcome
        });
      }
    }

    const totalLine = num(game.total_line);
    const overMarket = noVig(game.over_odds, game.under_odds);
    if (totalLine !== null && overMarket !== null) {
      const adjusted = total - totalLine;
      if (Math.abs(adjusted) > 1e-9) {
        const outcome = adjusted > 0 ? 1 : 0;
        rows.total.model.push({
          probability: projection.simulation.total.over,
          outcome
        });
        rows.total.market.push({
          probability: overMarket,
          outcome
        });
      }
    }
  }

  return {
    season,
    gamesEvaluated: games.length,
    moneyline: comparison(rows.moneyline.model, rows.moneyline.market),
    spread: comparison(rows.spread.model, rows.spread.market),
    total: comparison(rows.total.model, rows.total.market)
  };
}

function aggregate(seasons) {
  const result = {};
  for (const market of ["moneyline", "spread", "total"]) {
    const model = [];
    const baseline = [];
    for (const season of seasons) {
      // Aggregate from the summary is impossible without raw rows, so use
      // weighted metric pooling only for reporting and gate per-season below.
      const item = season[market];
      result[market] = result[market] || {
        rows: 0,
        modelBrierWeighted: 0,
        marketBrierWeighted: 0,
        modelLogLossWeighted: 0,
        marketLogLossWeighted: 0,
        modelEceWeighted: 0,
        marketEceWeighted: 0
      };
      const target = result[market];
      const n = item.model.rows;
      target.rows += n;
      target.modelBrierWeighted += (item.model.brier || 0) * n;
      target.marketBrierWeighted += (item.market.brier || 0) * n;
      target.modelLogLossWeighted += (item.model.logLoss || 0) * n;
      target.marketLogLossWeighted += (item.market.logLoss || 0) * n;
      target.modelEceWeighted += (item.model.ece || 0) * n;
      target.marketEceWeighted += (item.market.ece || 0) * n;
      model.push(item.model);
      baseline.push(item.market);
    }
    const target = result[market];
    const n = target.rows || 1;
    target.model = {
      rows: target.rows,
      brier: target.modelBrierWeighted / n,
      logLoss: target.modelLogLossWeighted / n,
      ece: target.modelEceWeighted / n
    };
    target.market = {
      rows: target.rows,
      brier: target.marketBrierWeighted / n,
      logLoss: target.marketLogLossWeighted / n,
      ece: target.marketEceWeighted / n
    };
    target.brierImprovement =
      target.market.brier - target.model.brier;
    target.logLossImprovement =
      target.market.logLoss - target.model.logLoss;
    delete target.modelBrierWeighted;
    delete target.marketBrierWeighted;
    delete target.modelLogLossWeighted;
    delete target.marketLogLossWeighted;
    delete target.modelEceWeighted;
    delete target.marketEceWeighted;
  }
  return result;
}

async function main() {
  const seasons = String(argValue("seasons", "2024,2025"))
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(Number.isFinite);
  const minWeek = Number(argValue("min-week", "4"));
  const outputDir = argValue(
    "output-dir",
    "artifacts/nfl-backtest"
  );

  const seasonReports = [];
  for (const season of seasons) {
    seasonReports.push(await backtestSeason(season, minWeek));
  }

  const aggregateReport = aggregate(seasonReports);
  const gate = promotionGate(aggregateReport);
  const report = {
    version: "NFL Team Markets v2 chronological backtest",
    generatedAt: new Date().toISOString(),
    seasons,
    minWeek,
    availabilityAdjustmentsBacktested: false,
    weatherForecastAdjustmentsBacktested: false,
    leakagePolicy:
      "Every target game uses only earlier games and earlier current-season team-stat weeks.",
    aggregate: aggregateReport,
    seasonsDetail: seasonReports,
    promotion: gate
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );

  const lines = [
    "# NFL Team Market Walk-Forward Backtest",
    "",
    `Seasons: ${seasons.join(", ")} | Minimum week: ${minWeek}`,
    "",
    "| Market | Rows | Model Brier | Market Brier | Δ Brier | Model LogLoss | Market LogLoss | Δ LogLoss |",
    "|---|---:|---:|---:|---:|---:|---:|---:|"
  ];
  for (const name of ["moneyline", "spread", "total"]) {
    const item = aggregateReport[name];
    lines.push(
      `| ${name} | ${item.model.rows} | ${item.model.brier.toFixed(5)} | ${item.market.brier.toFixed(5)} | ${item.brierImprovement.toFixed(5)} | ${item.model.logLoss.toFixed(5)} | ${item.market.logLoss.toFixed(5)} | ${item.logLossImprovement.toFixed(5)} |`
    );
  }
  lines.push(
    "",
    `Production eligible: **${gate.allMarketsPass ? "candidate" : "no"}**`,
    "",
    "QB availability and forecast-weather adjustments are intentionally excluded from this first historical test."
  );
  fs.writeFileSync(
    path.join(outputDir, "summary.md"),
    lines.join("\n") + "\n"
  );

  console.log("NFL_BACKTEST_SUMMARY=" + JSON.stringify({
    aggregate: aggregateReport,
    promotion: gate
  }));
}

await main();
