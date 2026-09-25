import fs from "node:fs";
import path from "node:path";

import {
  NBA_HOME_COURT_POINTS,
  NBA_MODEL_VERSION,
  projectEvent,
  simulateGame
} from "../../sharp-service/lib/nba-model.js";

const BDL_GAMES_URL = "https://api.balldontlie.io/v1/games";

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) =>
    value.startsWith(prefix)
  );
  return found ? found.slice(prefix.length) : fallback;
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFinal(game) {
  return (
    String(game?.status_state || "").toLowerCase() === "final" ||
    /^final$/i.test(String(game?.status || game?.time || ""))
  );
}

function startsAt(game) {
  return (
    game?.datetime ||
    (game?.date ? `${game.date}T23:59:59Z` : null)
  );
}

function eventFromGame(game) {
  return {
    eventID: `bdl:${game.id}`,
    startsAt: startsAt(game),
    matchup: {
      away: {
        name:
          game?.visitor_team?.full_name ||
          game?.visitor_team?.abbreviation,
        short: game?.visitor_team?.abbreviation
      },
      home: {
        name:
          game?.home_team?.full_name ||
          game?.home_team?.abbreviation,
        short: game?.home_team?.abbreviation
      }
    },
    markets: {
      moneyline: { away: null, home: null },
      spread: { away: null, home: null },
      total: { over: null, under: null }
    }
  };
}

function mae(rows, predictionKey, outcomeKey) {
  if (!rows.length) return null;
  return rows.reduce(
    (sum, row) =>
      sum + Math.abs(row[predictionKey] - row[outcomeKey]),
    0
  ) / rows.length;
}

function rmse(rows, predictionKey, outcomeKey) {
  if (!rows.length) return null;
  return Math.sqrt(
    rows.reduce((sum, row) => {
      const diff = row[predictionKey] - row[outcomeKey];
      return sum + diff * diff;
    }, 0) / rows.length
  );
}

function brier(rows, probabilityKey, outcomeKey) {
  if (!rows.length) return null;
  return rows.reduce((sum, row) => {
    const diff = row[probabilityKey] - row[outcomeKey];
    return sum + diff * diff;
  }, 0) / rows.length;
}

function binaryAccuracy(rows, probabilityKey, outcomeKey) {
  if (!rows.length) return null;
  let correct = 0;
  for (const row of rows) {
    const pick = row[probabilityKey] >= 0.5 ? 1 : 0;
    if (pick === row[outcomeKey]) correct += 1;
  }
  return correct / rows.length;
}

function metricSummary(rows) {
  return {
    games: rows.length,
    margin: {
      modelMae: mae(rows, "modelMargin", "actualMargin"),
      naiveMae: mae(rows, "naiveMargin", "actualMargin"),
      modelRmse: rmse(rows, "modelMargin", "actualMargin"),
      naiveRmse: rmse(rows, "naiveMargin", "actualMargin")
    },
    total: {
      modelMae: mae(rows, "modelTotal", "actualTotal"),
      naiveMae: mae(rows, "naiveTotal", "actualTotal"),
      modelRmse: rmse(rows, "modelTotal", "actualTotal"),
      naiveRmse: rmse(rows, "naiveTotal", "actualTotal")
    },
    moneyline: {
      modelBrier: brier(rows, "modelHomeWin", "homeWin"),
      naiveBrier: brier(rows, "naiveHomeWin", "homeWin"),
      modelAccuracy: binaryAccuracy(
        rows,
        "modelHomeWin",
        "homeWin"
      ),
      naiveAccuracy: binaryAccuracy(
        rows,
        "naiveHomeWin",
        "homeWin"
      )
    }
  };
}

function improvement(baseline, model) {
  if (!Number.isFinite(baseline) || !Number.isFinite(model)) {
    return null;
  }
  return baseline - model;
}

export function backtestGames(
  allGames,
  {
    season,
    minimumPriorGames = 4,
    simulationIterations = 4000
  }
) {
  const completed = (allGames || [])
    .filter(
      (game) =>
        num(game?.season) === season &&
        isFinal(game) &&
        !game?.postseason &&
        num(game?.home_team_score) !== null &&
        num(game?.visitor_team_score) !== null
    )
    .sort(
      (a, b) =>
        Date.parse(startsAt(a) || "") -
        Date.parse(startsAt(b) || "")
    );

  const rows = [];

  for (const target of completed) {
    const event = eventFromGame(target);
    const projection = projectEvent({
      event,
      games: completed,
      season,
      simulationIterations
    });
    if (!projection.available) continue;

    const minHistory = Math.min(
      projection.teamFeatures.home.currentSeasonGames,
      projection.teamFeatures.away.currentSeasonGames
    );
    if (minHistory < minimumPriorGames) continue;
    if (!projection.model.independentAvailable) continue;

    const homeScore = num(target.home_team_score);
    const awayScore = num(target.visitor_team_score);
    const actualMargin = homeScore - awayScore;
    const actualTotal = homeScore + awayScore;
    const leagueTotal =
      projection.teamFeatures.leagueBaseline.total.mean;

    const naiveSimulation = simulateGame({
      eventId: `${event.eventID}:naive`,
      projectedHomeMargin: NBA_HOME_COURT_POINTS,
      projectedTotal: leagueTotal,
      iterations: simulationIterations
    });

    rows.push({
      eventID: event.eventID,
      startsAt: event.startsAt,
      home: event.matchup.home.short,
      away: event.matchup.away.short,
      actualMargin,
      actualTotal,
      homeWin: actualMargin > 0 ? 1 : 0,
      modelMargin: projection.model.independentHomeMargin,
      modelTotal: projection.model.independentTotal,
      modelHomeWin: projection.simulation.moneyline.home,
      naiveMargin: NBA_HOME_COURT_POINTS,
      naiveTotal: leagueTotal,
      naiveHomeWin: naiveSimulation.moneyline.home,
      homePriorGames:
        projection.teamFeatures.home.currentSeasonGames,
      awayPriorGames:
        projection.teamFeatures.away.currentSeasonGames
    });
  }

  const metrics = metricSummary(rows);
  return {
    season,
    minimumPriorGames,
    gamesEvaluated: rows.length,
    metrics,
    improvements: {
      marginMae: improvement(
        metrics.margin.naiveMae,
        metrics.margin.modelMae
      ),
      marginRmse: improvement(
        metrics.margin.naiveRmse,
        metrics.margin.modelRmse
      ),
      totalMae: improvement(
        metrics.total.naiveMae,
        metrics.total.modelMae
      ),
      totalRmse: improvement(
        metrics.total.naiveRmse,
        metrics.total.modelRmse
      ),
      moneylineBrier: improvement(
        metrics.moneyline.naiveBrier,
        metrics.moneyline.modelBrier
      )
    },
    rows
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSeasonGames(
  season,
  {
    apiKey,
    pageDelayMs = 12500,
    maxPages = 20
  }
) {
  if (!apiKey) {
    throw new Error(
      "BALLDONTLIE_API_KEY is required when --input is not supplied."
    );
  }

  const games = [];
  let cursor = null;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(BDL_GAMES_URL);
    url.searchParams.append("seasons[]", String(season));
    url.searchParams.set("season_type", "regular");
    url.searchParams.set("per_page", "100");
    if (cursor !== null) {
      url.searchParams.set("cursor", String(cursor));
    }

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: apiKey
      },
      signal: AbortSignal.timeout(15000)
    });
    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { error: raw.slice(0, 500) };
    }
    if (!response.ok) {
      throw new Error(
        payload?.message ||
        payload?.error ||
        `BALLDONTLIE request failed (${response.status})`
      );
    }

    games.push(...(Array.isArray(payload?.data) ? payload.data : []));
    cursor = payload?.meta?.next_cursor ?? null;
    if (cursor === null) break;
    if (page + 1 < maxPages) {
      await sleep(pageDelayMs);
    }
  }

  return games;
}

function markdown(report) {
  const m = report.metrics;
  const i = report.improvements;
  const fmt = (value, digits = 4) =>
    Number.isFinite(value) ? value.toFixed(digits) : "n/a";

  return [
    "# NBA v1 Independent Signal Backtest",
    "",
    `Model: ${NBA_MODEL_VERSION}`,
    `Season: ${report.season}`,
    `Games evaluated: ${report.gamesEvaluated}`,
    `Minimum prior games/team: ${report.minimumPriorGames}`,
    "",
    "| Metric | Model | Naive baseline | Improvement |",
    "|---|---:|---:|---:|",
    `| Margin MAE | ${fmt(m.margin.modelMae, 3)} | ${fmt(m.margin.naiveMae, 3)} | ${fmt(i.marginMae, 3)} |`,
    `| Margin RMSE | ${fmt(m.margin.modelRmse, 3)} | ${fmt(m.margin.naiveRmse, 3)} | ${fmt(i.marginRmse, 3)} |`,
    `| Total MAE | ${fmt(m.total.modelMae, 3)} | ${fmt(m.total.naiveMae, 3)} | ${fmt(i.totalMae, 3)} |`,
    `| Total RMSE | ${fmt(m.total.modelRmse, 3)} | ${fmt(m.total.naiveRmse, 3)} | ${fmt(i.totalRmse, 3)} |`,
    `| Moneyline Brier | ${fmt(m.moneyline.modelBrier, 5)} | ${fmt(m.moneyline.naiveBrier, 5)} | ${fmt(i.moneylineBrier, 5)} |`,
    "",
    "This backtest validates only the independent NBA signal against actual game outcomes.",
    "It does not validate betting edge because historical sharp-book prices are not part of this dataset.",
    "Production weight remains 0% regardless of these results."
  ].join("\n") + "\n";
}

async function main() {
  const season = Number(argValue("season", "2024"));
  const input = argValue("input", null);
  const outputDir = argValue(
    "output-dir",
    "artifacts/nba-backtest"
  );
  const minimumPriorGames = Number(
    argValue("minimum-prior-games", "4")
  );
  const simulationIterations = Number(
    argValue("iterations", "4000")
  );

  const games = input
    ? JSON.parse(fs.readFileSync(input, "utf8"))
    : await fetchSeasonGames(season, {
        apiKey: process.env.BALLDONTLIE_API_KEY || ""
      });

  const report = backtestGames(games, {
    season,
    minimumPriorGames,
    simulationIterations
  });

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(outputDir, "summary.md"),
    markdown(report)
  );

  console.log(
    "NBA_BACKTEST_SUMMARY=" +
    JSON.stringify({
      season: report.season,
      gamesEvaluated: report.gamesEvaluated,
      metrics: report.metrics,
      improvements: report.improvements,
      productionEligible: false,
      holdoutPolicy:
        "2024 development first; 2025 remains untouched until development parameters are frozen."
    })
  );
}

const invokedDirectly =
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(
    process.argv[1].replace(/\\/g, "/")
  );

if (invokedDirectly) {
  await main();
}
