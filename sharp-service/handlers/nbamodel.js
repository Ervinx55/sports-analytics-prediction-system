import { NBA_MODEL_VERSION, normalizeTeam, projectEvent, seasonForDate } from "../lib/nba-model.js";
import { loadNbaEspnHistory } from "../lib/nba-espn-history.js";

const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];
const BOARD_URL = "https://sports-analytics-prediction-system-tau.vercel.app/api/board";
const iso = value => typeof value === "string" &&
  /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;

function windowFor(query, now) {
  const after = query?.startsAfter === undefined
    ? new Date(now - 3600000).toISOString() : iso(query.startsAfter);
  const before = query?.startsBefore === undefined
    ? new Date(now + 7 * 86400000).toISOString() : iso(query.startsBefore);
  if (!after || !before || Date.parse(after) < now - 86400000 ||
      Date.parse(before) > now + 8 * 86400000 || Date.parse(before) <= Date.parse(after))
    return null;
  return { after, before };
}

function evidencedTeams(event, games) {
  const names = new Set(games.flatMap(game => [
    game.home_team.full_name, game.visitor_team.full_name
  ]));
  const home = event?.matchup?.home?.name, away = event?.matchup?.away?.name;
  return typeof home === "string" && typeof away === "string" &&
    home !== away && names.has(home) && names.has(away);
}

function freshMarkets(markets, forecastAt) {
  const observed = Date.parse(forecastAt);
  const side = value => {
    if (!value) return null;
    const books = Object.fromEntries(Object.entries(value.books || {}).filter(([, quote]) => {
      const updated = iso(quote?.updatedAt);
      return updated && Date.parse(updated) <= observed &&
        observed - Date.parse(updated) <= 10 * 60000 && quote.available !== false;
    }));
    if (!Object.keys(books).length) return null;
    const lines = Object.values(books).map(quote => quote.line === null ||
      quote.line === undefined || quote.line === "" ? NaN : Number(quote.line))
      .filter(Number.isFinite).sort((a, b) => a - b);
    return { ...value, books, consensus: { ...value.consensus,
      line: lines.length ? lines[Math.floor(lines.length / 2)] : null } };
  };
  return Object.fromEntries(["moneyline", "spread", "total"].map(kind => [kind,
    Object.fromEntries(Object.entries(markets?.[kind] || {}).map(([direction, value]) =>
      [direction, side(value)]))]));
}

async function loadBoard({ after, before }, fetchImpl) {
  const url = new URL(process.env.EDGE_LAB_BOARD_URL || BOARD_URL);
  url.searchParams.set("leagues", "NBA");
  url.searchParams.set("books", BOOKS.join(","));
  url.searchParams.set("startsAfter", after);
  url.searchParams.set("startsBefore", before);
  const response = await fetchImpl(url, { headers: { accept: "application/json" },
    cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Error(`NBA board HTTP ${response.status}`);
  const raw = await response.text();
  if (raw.length > 2_000_000) throw Error("NBA board response too large");
  const board = JSON.parse(raw);
  if (!Array.isArray(board?.events) || board.events.length > 100)
    throw Error("Invalid NBA board response");
  return board;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }
  const now = Date.now(), window = windowFor(req.query, now);
  if (!window) return res.status(400).json({ error: "Invalid or historical NBA date window",
    productionEligible: false, productionWeight: 0 });
  try {
    const board = await loadBoard(window, fetch);
    const events = board.events.filter(event => event?.league === "NBA");
    const teams = [...new Set(events.flatMap(event => [
      normalizeTeam(event?.matchup?.home?.name || event?.matchup?.home?.short),
      normalizeTeam(event?.matchup?.away?.name || event?.matchup?.away?.short)
    ]).filter(Boolean))];
    const history = events.length
      ? await loadNbaEspnHistory({ targetAt: new Date(now).toISOString(), teams })
      : { ok: true, games: [], retrievedAt: null, dates: [], source: "ESPN" };
    // Every feature observation precedes the assigned forecast timestamp.
    const forecastAt = new Date().toISOString();
    const eligibleHistory = history.ok &&
      (!history.retrievedAt || Date.parse(history.retrievedAt) <= Date.parse(forecastAt));
    const season = seasonForDate(new Date(now));
    const projections = events.map(event => {
      const projection = eligibleHistory &&
      iso(event?.startsAt) && Date.parse(event.startsAt) > Date.parse(forecastAt) &&
      evidencedTeams(event, history.games)
        ? projectEvent({ event: { ...event, markets: freshMarkets(event.markets, forecastAt) },
          games: history.games, season })
        : { eventID: event.eventID ?? null, startsAt: event.startsAt ?? null,
          available: false, reason: !eligibleHistory
            ? `ESPN history unavailable: ${history.reason || "invalid observation time"}`
            : !iso(event?.startsAt) || Date.parse(event.startsAt) <= Date.parse(forecastAt)
              ? "NBA event is not a verified upcoming game."
              : "NBA board team names lack exact ESPN history identity evidence." };
      const modelAvailable = projection.available === true;
      const marketAvailable = modelAvailable && projection.markets.length > 0;
      return { ...projection, available: marketAvailable, modelAvailable,
        marketAvailable, reason: modelAvailable && !marketAvailable
          ? "No current, same-book NBA market quote pair is available."
          : projection.reason ?? null };
    });
    const markets = projections.filter(row => row.available).flatMap(row => row.markets)
      .sort((a, b) => (a.shadowStatus === "PLAY" ? -1 : 1) -
        (b.shadowStatus === "PLAY" ? -1 : 1) || (b.evPct ?? -999) - (a.evPct ?? -999));
    const shadowPlays = markets.filter(row => row.shadowStatus === "PLAY");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
    return res.status(200).json({ version: NBA_MODEL_VERSION, generatedAt: new Date().toISOString(),
      forecastAt, sport: "BASKETBALL", league: "NBA", season,
      productionEligible: false, productionWeight: 0,
      calibrationState: "UNCALIBRATED_CHALLENGER",
      methodology: { marketFirst: true, exactBookLineGrading: true,
        simulationIterations: 20000,
        teamFeatures: ["rolling scoring margin", "rolling points scored",
          "rolling points allowed", "home-court advantage", "rest days",
          "back-to-back penalty", "schedule density"],
        dataSources: ["Edge Lab market board", "ESPN NBA regular-season scoreboards"],
        injuryPolicy: "Injury status unknown; no injury adjustment or availability clear.",
        validationPolicy: "Shadow only pending prospective chronological validation." },
      sourceHealth: { games: { status: eligibleHistory && history.games.length
          ? "HEALTHY" : "UNAVAILABLE",
          source: "ESPN", reason: history.reason ??
            (events.length && !history.games.length ? "NO_VERIFIED_FINAL_HISTORY" : null),
          rowCount: eligibleHistory ? history.games.length : 0,
          retrievedAt: history.retrievedAt ?? null, dates: history.dates ?? [],
          previousSeasonWindow: history.previousSeasonWindow ?? false },
        injuries: { status: "UNKNOWN", adjustmentApplied: false },
        marketBoard: { status: events.length ? "HEALTHY" : "EMPTY",
          providerCache: board.providerCache ?? null,
          providerFailures: board.providerFailures ?? [] } },
      marketBooks: BOOKS, eventCount: projections.length,
      modelAvailableEventCount: projections.filter(row => row.modelAvailable).length,
      availableEventCount: projections.filter(row => row.available).length,
      marketCount: markets.length, shadowPlayCount: shadowPlays.length,
      shadowPlays, markets, events: projections });
  } catch (error) {
    return res.status(502).json({ version: NBA_MODEL_VERSION,
      error: error instanceof Error ? error.message : String(error),
      productionEligible: false, productionWeight: 0,
      sourceHealth: { marketBoard: { status: "UNAVAILABLE" },
        games: { status: "UNAVAILABLE" }, injuries: { status: "UNKNOWN" } } });
  }
}
