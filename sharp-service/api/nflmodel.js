import {
  leagueBaselines,
  loadNflData,
  loadWeatherContext,
  normalizeTeam,
  projectEvent,
  seasonForDate,
  teamSnapshot
} from "../lib/nfl-model.js";

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
    cache: "no-store"
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 500) };
  }
  if (!response.ok) {
    throw new Error(
      `${response.status} ${url}: ${JSON.stringify(body).slice(0, 500)}`
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
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return { startsAfter, startsBefore };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  try {
    const season = Number(req.query.season) || seasonForDate(new Date());
    const { startsAfter, startsBefore } = dateWindow(req.query);
    const boardUrl = process.env.EDGE_LAB_BOARD_URL || DEFAULT_BOARD_URL;
    const boardQuery = new URLSearchParams({
      leagues: "NFL",
      books: BOOKS.join(","),
      startsAfter,
      startsBefore
    });
    const [board, nflData] = await Promise.all([
      fetchJson(`${boardUrl}?${boardQuery.toString()}`),
      loadNflData(season)
    ]);

    const events = (board.events || [])
      .filter((event) => event.league === "NFL");

    const teams = new Set();
    for (const event of events) {
      const away = normalizeTeam(
        event?.matchup?.away?.name || event?.matchup?.away?.short
      );
      const home = normalizeTeam(
        event?.matchup?.home?.name || event?.matchup?.home?.short
      );
      if (away) teams.add(away);
      if (home) teams.add(home);
    }

    // Include all teams represented in the stats feed so z-scores are league
    // relative rather than only relative to the current slate.
    for (const row of nflData.stats) {
      if ([season, season - 1].includes(Number(row.season)) && row.team) {
        teams.add(row.team);
      }
    }

    const snapshots = new Map();
    for (const team of teams) {
      snapshots.set(
        team,
        teamSnapshot(
          nflData.schedule,
          nflData.stats,
          season,
          team
        )
      );
    }
    const baseline = leagueBaselines([...snapshots.values()]);

    const weatherEntries = await Promise.all(
      events.map(async (event) => {
        const home = normalizeTeam(
          event?.matchup?.home?.name || event?.matchup?.home?.short
        );
        if (!home) return [event.eventID, null];
        const weather = await loadWeatherContext({
          event,
          schedule: nflData.schedule,
          season,
          homeTeam: home
        });
        return [event.eventID, weather];
      })
    );
    const weatherByEvent = new Map(weatherEntries);

    const projections = events.map((event) =>
      projectEvent({
        event,
        schedule: nflData.schedule,
        stats: nflData.stats,
        depthCharts: nflData.depthCharts,
        snapshots,
        baseline,
        season,
        weatherContext: weatherByEvent.get(event.eventID) || null,
        sourceHealth: nflData.sourceHealth
      })
    );

    const markets = projections
      .filter((projection) => projection.available)
      .flatMap((projection) =>
        projection.markets.map((market) => ({
          eventID: projection.eventID,
          startsAt: projection.startsAt,
          away: projection.matchup.away.name,
          home: projection.matchup.home.name,
          ...market
        }))
      )
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
      version: "NFL Team Markets v3-shadow",
      generatedAt: new Date().toISOString(),
      sport: "FOOTBALL",
      league: "NFL",
      season,
      productionEligible: false,
      productionWeight: 0,
      methodology: {
        currentMarketAnchor: true,
        currentSeasonEvidenceWeight:
          "Independent weight starts at 25% and rises 3 points per shared current-season game, capped at 50%.",
        teamFeatures: [
          "recent scoring margin",
          "offensive EPA/play",
          "defensive EPA/play allowed",
          "offensive yards/play",
          "defensive yards/play allowed",
          "turnover margin",
          "rest differential",
          "home/neutral site",
          "QB continuity and current depth-chart agreement",
          "roof / temperature / wind / precipitation environment"
        ],
        simulationIterations: 20000,
        dataSources: [
          "Edge Lab sharp market board",
          "nflverse schedule/game data",
          "nflverse weekly team statistics",
          "nflverse daily depth charts",
          "Open-Meteo outdoor forecasts"
        ],
        injuryPolicy:
          "No current nflverse injury adjustment is applied because the feed ended after 2024.",
        calibration:
          "2024 selected market-specific shrinkage; 2025 was untouched. Moneyline/spread are market-only, totals use 25% of the dynamic independent contribution."
      },
      sourceHealth: nflData.sourceHealth,
      marketBooks: BOOKS,
      boardProviderCache: board.providerCache ?? null,
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
      error: error instanceof Error ? error.message : String(error),
      version: "NFL Team Markets v3-shadow",
      productionEligible: false
    });
  }
}
