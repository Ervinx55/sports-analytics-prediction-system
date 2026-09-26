import {
  NBA_MODEL_VERSION,
  loadNbaGames,
  projectEvent,
  seasonForDate
} from "../lib/nba-model.js";

const DEFAULT_BOARD_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/board";
const BOOKS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars"
];

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000)
  });
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = { error: raw.slice(0, 500) };
  }
  if (!response.ok) {
    throw new Error(
      `${response.status} ${url}: ${JSON.stringify(body).slice(0, 700)}`
    );
  }
  return body;
}

function dateWindow(query) {
  const startsAfter = query.startsAfter
    ? String(query.startsAfter)
    : new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const startsBefore = query.startsBefore
    ? String(query.startsBefore)
    : new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString();
  return { startsAfter, startsBefore };
}

function historyTarget(startsBefore) {
  const cutoff = Date.parse(startsBefore || "");
  const now = Date.now();
  return new Date(
    Number.isFinite(cutoff)
      ? Math.min(cutoff, now)
      : now
  ).toISOString();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  try {
    const { startsAfter, startsBefore } = dateWindow(req.query);
    const season =
      Number(req.query.season) ||
      seasonForDate(new Date(startsAfter));
    const boardUrl =
      process.env.EDGE_LAB_BOARD_URL || DEFAULT_BOARD_URL;

    const boardQuery = new URLSearchParams({
      leagues: "NBA",
      books: BOOKS.join(","),
      startsAfter,
      startsBefore
    });

    const [board, nbaData] = await Promise.all([
      fetchJson(`${boardUrl}?${boardQuery.toString()}`),
      loadNbaGames({
        season,
        targetAt: historyTarget(startsBefore),
        lookbackDays: 14
      })
    ]);

    const events = (board.events || []).filter(
      (event) => String(event.league || "").toUpperCase() === "NBA"
    );

    const projections = events.map((event) =>
      projectEvent({
        event,
        games: nbaData.games,
        season
      })
    );

    const markets = projections
      .filter((projection) => projection.available)
      .flatMap((projection) => projection.markets)
      .sort((a, b) => {
        if (a.shadowStatus !== b.shadowStatus) {
          return a.shadowStatus === "PLAY" ? -1 : 1;
        }
        return (b.evPct ?? -999) - (a.evPct ?? -999);
      });

    const shadowPlays = markets.filter(
      (market) => market.shadowStatus === "PLAY"
    );

    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=120, stale-while-revalidate=180"
    );

    return res.status(200).json({
      version: NBA_MODEL_VERSION,
      generatedAt: new Date().toISOString(),
      sport: "BASKETBALL",
      league: "NBA",
      season,
      productionEligible: false,
      productionWeight: 0,
      calibrationState: "UNCALIBRATED_CHALLENGER",
      methodology: {
        marketFirst: true,
        exactBookLineGrading: true,
        simulationIterations: 20000,
        teamFeatures: [
          "rolling scoring margin",
          "rolling points scored",
          "rolling points allowed",
          "home-court advantage",
          "rest days",
          "back-to-back penalty",
          "three-in-four / schedule-density penalty"
        ],
        dataSources: [
          "Edge Lab market board",
          "BALLDONTLIE Games endpoint when configured"
        ],
        injuryPolicy:
          "No injury adjustment is applied in NBA v1 until a point-in-time injury source is integrated and validated.",
        validationPolicy:
          "All NBA v1 outputs remain shadow-only until chronological development calibration and untouched holdout validation are complete."
      },
      sourceHealth: {
        ...nbaData.sourceHealth,
        marketBoard: {
          status: events.length ? "HEALTHY" : "EMPTY",
          providerCache: board.providerCache ?? null,
          providerFailures: board.providerFailures ?? []
        }
      },
      marketBooks: BOOKS,
      eventCount: projections.length,
      availableEventCount: projections.filter(
        (projection) => projection.available
      ).length,
      marketCount: markets.length,
      shadowPlayCount: shadowPlays.length,
      shadowPlays,
      markets,
      events: projections
    });
  } catch (error) {
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : String(error),
      version: NBA_MODEL_VERSION,
      productionEligible: false,
      productionWeight: 0
    });
  }
}
