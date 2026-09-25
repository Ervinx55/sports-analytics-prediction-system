import fs from "node:fs";
import path from "node:path";

import {
  NBA_PLAYER_PROP_VERSION,
  SUPPORTED_STATS,
  normalizePlayerName,
  projectionFromHistory,
  statValue
} from "../../sharp-service/lib/nba-player-props.js";
import {
  applyNbaPropGameContext,
  buildNbaPropGameContext
} from "../../sharp-service/lib/nba-prop-context.js";

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) =>
    value.startsWith(prefix)
  );
  return found ? found.slice(prefix.length) : fallback;
}

function num(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function playerName(row) {
  return [
    row?.player?.first_name || "",
    row?.player?.last_name || ""
  ].join(" ").trim();
}

function gameTime(row) {
  return Date.parse(
    row?.game?.datetime ||
    (row?.game?.date
      ? `${row.game.date}T23:59:59Z`
      : "")
  );
}

function buildHistoricalGames(rows) {
  const teamById = new Map();
  for (const row of rows || []) {
    if (row?.team?.id != null) {
      teamById.set(
        Number(row.team.id),
        row.team
      );
    }
  }

  const games = new Map();
  for (const row of rows || []) {
    const game = row?.game;
    if (!game?.id || games.has(game.id)) {
      continue;
    }

    const homeTeam =
      game?.home_team ||
      teamById.get(
        Number(game?.home_team_id)
      ) ||
      null;
    const visitorTeam =
      game?.visitor_team ||
      teamById.get(
        Number(game?.visitor_team_id)
      ) ||
      null;

    if (!homeTeam || !visitorTeam) {
      continue;
    }

    games.set(game.id, {
      ...game,
      home_team: homeTeam,
      visitor_team: visitorTeam,
      status:
        game?.status || "Final",
      status_state:
        game?.status_state || "final"
    });
  }

  return [...games.values()];
}

function targetEvent(target) {
  const game = target?.game || {};
  const home = game?.home_team;
  const away = game?.visitor_team;

  if (!home || !away) return null;

  return {
    eventID:
      `historical-nba:${game.id}`,
    startsAt:
      game?.datetime ||
      (game?.date
        ? `${game.date}T23:59:59Z`
        : null),
    matchup: {
      home: {
        name:
          home?.full_name ||
          home?.abbreviation ||
          null
      },
      away: {
        name:
          away?.full_name ||
          away?.abbreviation ||
          null
      }
    }
  };
}

function rollingBaseline(rows, statID, limit = 4) {
  const values = rows
    .slice(-limit)
    .map((row) => statValue(row, statID))
    .filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metrics(rows, predictionKey) {
  if (!rows.length) {
    return {
      rows: 0,
      mae: null,
      rmse: null,
      bias: null
    };
  }

  let abs = 0;
  let sq = 0;
  let bias = 0;
  for (const row of rows) {
    const diff = row[predictionKey] - row.actual;
    abs += Math.abs(diff);
    sq += diff * diff;
    bias += diff;
  }

  return {
    rows: rows.length,
    mae: abs / rows.length,
    rmse: Math.sqrt(sq / rows.length),
    bias: bias / rows.length
  };
}

function promotionDecision(model, baseline) {
  const minimumRows = 100;
  if (
    model.rows < minimumRows ||
    !Number.isFinite(model.mae) ||
    !Number.isFinite(baseline.mae)
  ) {
    return {
      accepted: false,
      reason: "Insufficient chronological development rows.",
      minimumRows,
      maeImprovement: null
    };
  }

  const improvement = baseline.mae - model.mae;
  const threshold = Math.max(0.02, baseline.mae * 0.0025);

  return {
    accepted: improvement >= threshold,
    reason:
      improvement >= threshold
        ? "Model clears the 2024 development MAE improvement gate."
        : "Model does not beat the rolling-stat baseline by the required development margin.",
    minimumRows,
    minimumMaeImprovement: threshold,
    maeImprovement: improvement
  };
}

function challengerPromotionDecision(
  challenger,
  incumbent
) {
  const minimumRows = 100;

  if (
    challenger.rows < minimumRows ||
    !Number.isFinite(challenger.mae) ||
    !Number.isFinite(incumbent.mae)
  ) {
    return {
      accepted: false,
      reason:
        "Insufficient chronological development rows for v1.1 context validation.",
      minimumRows,
      maeImprovementVsV1: null
    };
  }

  const improvement =
    incumbent.mae - challenger.mae;
  const threshold = Math.max(
    0.01,
    incumbent.mae * 0.0025
  );

  return {
    accepted: improvement >= threshold,
    reason:
      improvement >= threshold
        ? "Historical context challenger beats the existing NBA prop v1 raw model by the required development margin."
        : "Historical context challenger does not beat NBA prop v1 by the required development margin.",
    minimumRows,
    minimumMaeImprovement:
      threshold,
    maeImprovementVsV1:
      improvement
  };
}

export function backtestPlayerStats(
  rows,
  {
    season = 2024,
    minimumPriorGames = 4
  } = {}
) {
  const seasonRows = (rows || [])
    .filter((row) => num(row?.game?.season) === season)
    .filter((row) => Number.isFinite(gameTime(row)))
    .sort((a, b) => gameTime(a) - gameTime(b));

  const historicalGames =
    buildHistoricalGames(seasonRows);

  const byPlayer = new Map();
  for (const row of seasonRows) {
    const key =
      String(row?.player?.id || "") ||
      normalizePlayerName(playerName(row));
    if (!key) continue;
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key).push(row);
  }

  const rowsByMarket = Object.fromEntries(
    SUPPORTED_STATS.map((statID) => [statID, []])
  );

  for (const history of byPlayer.values()) {
    const prior = [];
    for (const target of history) {
      if (prior.length >= minimumPriorGames) {
        for (const statID of SUPPORTED_STATS) {
          const actual = statValue(target, statID);
          if (!Number.isFinite(actual)) continue;

          const projection = projectionFromHistory(
            prior.slice().reverse(),
            statID,
            {
              beforeAt:
                target?.game?.datetime ||
                (target?.game?.date
                  ? `${target.game.date}T23:59:59Z`
                  : null),
              minimumGames: minimumPriorGames
            }
          );

          const historicalEvent =
            targetEvent(target);
          const context =
            historicalEvent
              ? buildNbaPropGameContext({
                  propEvent:
                    historicalEvent,
                  boardEvent: null,
                  games:
                    historicalGames,
                  season,
                  playerTeamName:
                    target?.team?.full_name ||
                    target?.team?.abbreviation ||
                    projection?.teamName ||
                    null
                })
              : {
                  available: false
                };
          const contextProjection =
            applyNbaPropGameContext(
              projection,
              statID,
              context
            );

          const baseline = rollingBaseline(
            prior,
            statID,
            4
          );
          if (
            !projection.available ||
            !Number.isFinite(projection.mean) ||
            !Number.isFinite(baseline)
          ) {
            continue;
          }

          rowsByMarket[statID].push({
            playerID: target?.player?.id || null,
            playerName: playerName(target),
            gameID: target?.game?.id || null,
            gameDate: target?.game?.date || null,
            actual,
            model: projection.mean,
            contextModel:
              contextProjection?.mean ??
              projection.mean,
            contextAvailable:
              Boolean(
                contextProjection
                  ?.gameContext
                  ?.available
              ),
            contextSignal:
              contextProjection
                ?.contextSignal ?? null,
            baseline,
            historyGames: prior.length,
            projectedMinutes:
              projection.projectedMinutes,
            usageRatio:
              projection.usageRatio ?? null
          });
        }
      }
      prior.push(target);
    }
  }

  const markets = {};
  for (const statID of SUPPORTED_STATS) {
    const marketRows = rowsByMarket[statID];
    const model = metrics(
      marketRows,
      "model"
    );
    const contextChallenger = metrics(
      marketRows.filter(
        (row) =>
          row.contextAvailable
      ),
      "contextModel"
    );
    const contextIncumbent = metrics(
      marketRows.filter(
        (row) =>
          row.contextAvailable
      ),
      "model"
    );
    const baseline = metrics(
      marketRows,
      "baseline"
    );
    markets[statID] = {
      model,
      contextChallenger,
      contextIncumbent,
      baseline,
      maeImprovement:
        Number.isFinite(model.mae) &&
        Number.isFinite(baseline.mae)
          ? baseline.mae - model.mae
          : null,
      rmseImprovement:
        Number.isFinite(model.rmse) &&
        Number.isFinite(baseline.rmse)
          ? baseline.rmse - model.rmse
          : null,
      promotion:
        promotionDecision(
          model,
          baseline
        ),
      contextPromotion:
        challengerPromotionDecision(
          contextChallenger,
          contextIncumbent
        )
    };
  }

  return {
    version:
      "NBA Player Props v1.1 context challenger development backtest",
    modelVersion: NBA_PLAYER_PROP_VERSION,
    season,
    minimumPriorGames,
    holdoutSeason: 2025,
    holdoutTouched: false,
    marketPriceValidationAvailable: false,
    marketPricePolicy:
      "This development replay validates raw stat projections and the historical opponent/scoring-environment/rest subset of the v1.1 context challenger. Historical game-market totals/spreads and exact sportsbook prop prices are not part of this input, so live market-implied context and betting edge remain unvalidated.",
    markets,
    rowsByMarket
  };
}

async function fetchSeasonStats(
  season,
  {
    apiKey,
    maxPages = 80,
    pageDelayMs = 1100
  } = {}
) {
  if (!apiKey) {
    throw new Error(
      "BALLDONTLIE_API_KEY is required when --input is not supplied."
    );
  }

  const rows = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(
      "https://api.balldontlie.io/v1/stats"
    );
    url.searchParams.append(
      "seasons[]",
      String(season)
    );
    url.searchParams.set(
      "season_type",
      "regular"
    );
    url.searchParams.set("per_page", "100");
    if (cursor !== null) {
      url.searchParams.set(
        "cursor",
        String(cursor)
      );
    }

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: apiKey
      },
      signal: AbortSignal.timeout(15_000)
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
        `BALLDONTLIE stats request failed (${response.status})`
      );
    }

    rows.push(
      ...(Array.isArray(payload?.data)
        ? payload.data
        : [])
    );
    cursor =
      payload?.meta?.next_cursor ?? null;
    if (cursor === null) break;

    if (page + 1 < maxPages) {
      await new Promise((resolve) =>
        setTimeout(resolve, pageDelayMs)
      );
    }
  }

  return rows;
}

function markdown(report) {
  const fmt = (value, digits = 4) =>
    Number.isFinite(value)
      ? value.toFixed(digits)
      : "n/a";

  const lines = [
    "# NBA Player Props v1 Development Backtest",
    "",
    `Season: ${report.season}`,
    `Holdout: ${report.holdoutSeason} (untouched)`,
    "",
    "| Market | Rows | v1 MAE | Context MAE | Baseline MAE | Context gain vs v1 | v1 accepted | Context accepted |",
    "|---|---:|---:|---:|---:|---:|:---:|:---:|"
  ];

  for (const statID of SUPPORTED_STATS) {
    const item = report.markets[statID];
    lines.push(
      `| ${statID} | ${item.model.rows} | ${fmt(item.model.mae, 3)} | ${fmt(item.contextChallenger.mae, 3)} | ${fmt(item.baseline.mae, 3)} | ${fmt(item.contextPromotion.maeImprovementVsV1, 3)} | ${item.promotion.accepted ? "yes" : "no"} | ${item.contextPromotion.accepted ? "yes" : "no"} |`
    );
  }

  lines.push(
    "",
    "Production eligible: **no**",
    "",
    "Historical exact sportsbook prices are still required before any betting-edge promotion."
  );

  return lines.join("\n") + "\n";
}

async function main() {
  const season = Number(argValue("season", "2024"));
  const input = argValue("input", null);
  const outputDir = argValue(
    "output-dir",
    "artifacts/nba-player-props-backtest"
  );
  const minimumPriorGames = Number(
    argValue("minimum-prior-games", "4")
  );

  const rows = input
    ? JSON.parse(fs.readFileSync(input, "utf8"))
    : await fetchSeasonStats(season, {
        apiKey:
          process.env.BALLDONTLIE_API_KEY || ""
      });

  const report = backtestPlayerStats(rows, {
    season,
    minimumPriorGames
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
    "NBA_PLAYER_PROPS_BACKTEST_SUMMARY=" +
      JSON.stringify({
        season: report.season,
        holdoutSeason:
          report.holdoutSeason,
        holdoutTouched:
          report.holdoutTouched,
        markets: report.markets,
        productionEligible: false
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
