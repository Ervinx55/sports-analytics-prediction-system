import {
  optimizeSportsGameOddsObjectLimit,
  protectedSportsGameOddsFetch
} from "../lib/provider-protection.js";
import { adaptiveRefreshPolicy } from "../lib/adaptive-refresh.js";
import { fetchSharpApiNbaProps } from "../lib/sharpapi-provider.js";

import { enrichNbaPropResearchContext } from "../lib/nba-prop-research-context.js";
import { verifyNbaPropRosters } from "../lib/nba-prop-identity.js";

const VERSION = "nba-observed-player-markets-v1";
const REASON = "PLAYER_IDENTITY_OR_AVAILABILITY_UNVERIFIED";
const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];
const STAT_IDS = Object.freeze({
  points: "points", rebounds: "rebounds", assists: "assists",
  threePointersMade: "threes_made", blocks: "blocks", steals: "steals",
  turnovers: "turnovers", "blocks+steals": "blocks_steals",
  "points+rebounds+assists": "points_rebounds_assists",
  "points+rebounds": "points_rebounds", "points+assists": "points_assists",
  "rebounds+assists": "rebounds_assists"
});
const PROP_PATTERNS = Object.keys(STAT_IDS).flatMap((stat) => [
  `${stat}-PLAYER_ID-game-ou-over`,
  `${stat}-PLAYER_ID-game-ou-under`
]);

function number(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function csv(value, fallback) {
  if (!value) return fallback;
  return String(Array.isArray(value) ? value[0] : value)
    .split(",").map((part) => part.trim().toLowerCase())
    .filter(Boolean).slice(0, 20);
}

function validWindow(query, now) {
  const after = query?.startsAfter || new Date(now - 60 * 60_000).toISOString();
  const before = query?.startsBefore || new Date(now + 7 * 24 * 60 * 60_000).toISOString();
  const a = Date.parse(after);
  const b = Date.parse(before);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b || b - a > 14 * 24 * 60 * 60_000) {
    const error = new Error("Provide a valid startsAfter/startsBefore window of at most 14 days");
    error.status = 400;
    throw error;
  }
  return { startsAfter: new Date(a).toISOString(), startsBefore: new Date(b).toISOString() };
}

function sgoQuotes(odd) {
  const quotes = [];
  for (const [name, row] of Object.entries(odd?.byBookmaker || {})) {
    const odds = number(row?.odds);
    const line = number(row?.overUnder);
    if (row?.available === false || odds === null || odds === 0 || line === null || line < 0) continue;
    quotes.push({ book: name, line, price: {
      odds, line, available: true,
      openOdds: number(row?.openOdds), openLine: number(row?.openOverUnder),
      closeOdds: number(row?.closeOdds), closeLine: number(row?.closeOverUnder),
      updatedAt: row?.lastUpdatedAt || null
    }});
  }
  return quotes;
}

export function normalizeSportsGameOddsNbaProps(rawEvents, { now = Date.now() } = {}) {
  const events = [];
  for (const event of Array.isArray(rawEvents) ? rawEvents : []) {
    if (String(event?.leagueID || "").toUpperCase() !== "NBA" || !event?.eventID) continue;
    const startsAt = event?.status?.startsAt || null;
    const startsMs = Date.parse(startsAt || "");
    if (!Number.isFinite(startsMs) || startsMs <= now || event?.status?.started || event?.status?.live || event?.status?.completed || event?.status?.finalized) continue;
    const props = new Map();
    for (const odd of Object.values(event?.odds || {})) {
      const statID = STAT_IDS[String(odd?.statID || "")];
      const side = String(odd?.sideID || "").toLowerCase();
      if (!statID || !["over", "under"].includes(side)) continue;
      const playerID = odd?.playerID || odd?.statEntityID || null;
      const player = playerID ? event?.players?.[playerID] : null;
      const playerName = String(
        player?.name || [player?.firstName, player?.lastName].filter(Boolean).join(" ") ||
        odd?.playerName || odd?.statEntityName || odd?.entityName || odd?.participantName || ""
      ).trim();
      if (!playerName) continue;
      for (const { book, line, price } of sgoQuotes(odd)) {
        const key = `${statID}|${playerID || playerName.toLowerCase()}|${line}`;
        if (!props.has(key)) props.set(key, {
          statID, playerID, playerName, marketName: odd?.marketName || statID,
          over: null, under: null
        });
        const prop = props.get(key);
        if (!prop[side]) prop[side] = {
          oddID: odd?.oddID || null, side,
          consensus: { odds: null, fairOdds: null, line, fairLine: null },
          books: {}
        };
        if (prop[side].oddID !== (odd?.oddID || null)) prop[side].oddID = null;
        prop[side].books[book] = price;
      }
    }
    if (!props.size) continue;
    events.push({
      eventID: `sgo:${event.eventID}`, providerEventID: event.eventID,
      provider: "SportsGameOdds", sport: "BASKETBALL", league: "NBA", startsAt,
      status: {
        started: Boolean(event?.status?.started), live: Boolean(event?.status?.live),
        completed: Boolean(event?.status?.completed), finalized: Boolean(event?.status?.finalized),
        display: event?.status?.displayShort || null
      },
      matchup: {
        away: { id: event?.teams?.away?.teamID || null, name: event?.teams?.away?.names?.long || event?.teams?.away?.names?.medium || null },
        home: { id: event?.teams?.home?.teamID || null, name: event?.teams?.home?.names?.long || event?.teams?.home?.names?.medium || null }
      },
      props: [...props.values()]
    });
  }
  return events;
}

function validBooks(side, now) {
  if (!side?.books) return null;
  const books = Object.fromEntries(Object.entries(side.books).filter(([, row]) =>
    row?.available !== false && number(row?.odds) !== null && number(row?.odds) !== 0 &&
    number(row?.line) !== null && number(row?.line) >= 0
  ).map(([book, row]) => {
    const updatedMs = Date.parse(row.updatedAt || "");
    const quoteState = !Number.isFinite(updatedMs) ? "FRESHNESS_UNVERIFIED" :
      updatedMs > now ? "FUTURE_TIMESTAMP" :
      now - updatedMs > 15 * 60_000 ? "STALE" : "OBSERVED";
    return [book, { ...row, quoteState }];
  }));
  return Object.keys(books).length ? { ...side, books } : null;
}

export function observedNbaEvents(events, { now = Date.now() } = {}) {
  return (events || []).filter((event) => {
    const starts = Date.parse(event?.startsAt || "");
    return event?.league === "NBA" && Number.isFinite(starts) && starts > now &&
      !event?.status?.started && !event?.status?.live && !event?.status?.completed && !event?.status?.finalized;
  }).map((event) => ({
    eventID: event.eventID, providerEventID: event.providerEventID || null,
    provider: event.provider, sport: "BASKETBALL", league: "NBA",
    startsAt: event.startsAt, status: event.status, matchup: event.matchup,
    players: (event.props || []).map((prop) => {
      const over = validBooks(prop.over, now);
      const under = validBooks(prop.under, now);
      if (!over && !under) return null;
      const quotes = [...Object.values(over?.books || {}), ...Object.values(under?.books || {})];
      const timestamps = quotes.map((row) => Date.parse(row.updatedAt || "")).filter(Number.isFinite);
      const latest = timestamps.length ? Math.max(...timestamps) : null;
      const states = quotes.map((row) => row.quoteState);
      const quoteState = states.includes("FUTURE_TIMESTAMP") ? "FUTURE_TIMESTAMP" :
        states.includes("FRESHNESS_UNVERIFIED") ? "FRESHNESS_UNVERIFIED" :
        states.includes("STALE") ? "STALE" :
        !over || !under ? "ONE_SIDED" : "OBSERVED";
      return {
        prop: {
          statID: prop.statID, playerID: prop.playerID || null,
          playerName: prop.playerName, marketName: prop.marketName || null,
          over, under, quoteState, latestQuoteAt: latest === null ? null : new Date(latest).toISOString(),
          identitySource: event.provider, espnPlayerID: null
        },
        predictionAvailability: "UNAVAILABLE", reason: REASON, candidates: []
      };
    }).filter(Boolean)
  })).filter((event) => event.players.length > 0);
}

async function resolveProvider({ keys, books, window, requestedLimit, refreshPolicy, now }) {
  const failures = [];
  const objectPolicy = keys.sgo ? await optimizeSportsGameOddsObjectLimit({
    apiKey: keys.sgo, requestedLimit, defaultLimit: 20, priority: "critical"
  }) : null;
  const attempts = [];

  if (keys.sgo) attempts.push(["SportsGameOdds", async () => {
    const params = new URLSearchParams({
      leagueID: "NBA", oddIDs: PROP_PATTERNS.join(","), bookmakerID: books.join(","),
      oddsAvailable: "true", includeOpenCloseOdds: "true", includeAltLines: "true",
      finalized: "false", type: "match", ...window,
      limit: String(Math.max(1, objectPolicy.effectiveLimit || 1))
    });
    const result = await protectedSportsGameOddsFetch({
      url: `https://api.sportsgameodds.com/v2/events?${params}`,
      apiKey: keys.sgo, freshMs: refreshPolicy.freshMs,
      staleMs: Math.max(10 * 60_000, refreshPolicy.staleMs),
      timeoutMs: 8_000, consumer: "nba-player-props", priority: "critical", objectPolicy
    });
    return {
      events: normalizeSportsGameOddsNbaProps(result.payload?.data, { now }),
      fetchedAt: result.fetchedAt ? new Date(result.fetchedAt).toISOString() : null,
      cache: { status: result.cacheStatus, layer: result.cacheLayer, servedStale: result.cacheStatus === "STALE" },
      objectPolicy
    };
  }]);
  if (keys.sharp) attempts.push(["SharpAPI", () => fetchSharpApiNbaProps({
    apiKey: keys.sharp, books, ...window,
    freshMs: Math.max(60_000, refreshPolicy.freshMs),
    staleMs: Math.max(10 * 60_000, refreshPolicy.staleMs)
  })]);

  for (const [source, fetchProps] of attempts) {
    try {
      const result = await fetchProps();
      const events = observedNbaEvents(result.events, { now: Date.now() });
      if (events.length) return { source, events, fetchedAt: result.fetchedAt || null,
        cache: result.cache || null, usage: result.usage || null, objectPolicy,
        failures };
      failures.push({ provider: source, status: 204, error: "No usable upcoming NBA player markets returned" });
    } catch (error) {
      failures.push({
        provider: source, status: Number(error?.status || 502),
        error: error instanceof Error ? error.message : String(error),
        quotaBlocked: Boolean(error?.quotaBlocked), objectBudgetBlocked: Boolean(error?.objectBudgetBlocked)
      });
    }
  }
  const error = new Error("No configured provider returned usable upcoming NBA player markets");
  error.status = failures.some((row) => row.status === 429) ? 429 : 503;
  error.providerFailures = failures;
  error.objectPolicy = objectPolicy;
  throw error;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }
  const keys = {
    sgo: process.env.SPORTS_ODDS_API_KEY,
    sharp: process.env.SHARPAPI_KEY
  };
  if (!Object.values(keys).some(Boolean)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({
      error: "No NBA player-market odds provider is configured", version: VERSION,
      productionEligible: false, productionWeight: 0, modelState: "SHADOW_ONLY",
      predictionAvailability: "UNAVAILABLE", reason: REASON,
      sourceHealth: { odds: { status: "UNAVAILABLE", configured: false } }
    });
  }
  try {
    const now = Date.now();
    const selectedBooks = [...new Set(csv(req.query?.books, BOOKS))].sort();
    const window = validWindow(req.query || {}, now);
    const requestedLimit = Math.max(1, Math.min(40, Number(req.query?.limit || 20) || 20));
    const refreshPolicy = adaptiveRefreshPolicy({
      startsBefore: req.query?.startsBefore ? window.startsBefore : null,
      priority: "critical", now
    });
    const result = await resolveProvider({ keys, books: selectedBooks, window, requestedLimit, refreshPolicy, now });
    const identity = await verifyNbaPropRosters(result.events);
    const context = await enrichNbaPropResearchContext(identity.events);
    result.events = context.events;
    const quoteStates = result.events.flatMap((event) => event.players.map((player) => player.prop.quoteState));
    const degradedQuotes = quoteStates.filter((state) => state !== "OBSERVED").length;
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("X-Odds-Provider", result.source);
    return res.status(200).json({
      version: VERSION, generatedAt: new Date(now).toISOString(), sport: "BASKETBALL", league: "NBA",
      productionEligible: false, productionWeight: 0, modelState: "SHADOW_ONLY",
      predictionAvailability: "UNAVAILABLE", reason: REASON,
      oddsProvider: result.source, providerChain: ["SportsGameOdds", "SharpAPI"],
      providerFailures: result.failures, books: selectedBooks,
      sourceHealth: {
        odds: {
          status: result.cache?.servedStale ? "STALE" : degradedQuotes ? "DEGRADED" : "OBSERVED",
          source: result.source, fetchedAt: result.fetchedAt, cache: result.cache,
          quoteStates: Object.fromEntries([...new Set(quoteStates)].map((state) =>
            [state, quoteStates.filter((value) => value === state).length])),
          usage: result.usage, objectPolicy: result.objectPolicy, failures: result.failures
        },
        playerIdentity: identity.health,
        propContext: context.health,
        playerAvailability: { status: "UNVERIFIED", source: "No verified pregame NBA injury status" }
      },
      eventCount: result.events.length,
      playerCount: result.events.reduce((sum, event) => sum + event.players.length, 0),
      candidateCount: 0, shadowPlayCount: 0, shadowPlays: [], candidates: [], events: result.events,
      refreshPolicy
    });
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(Number(error?.status || 503)).json({
      error: error instanceof Error ? error.message : String(error), version: VERSION,
      productionEligible: false, productionWeight: 0, modelState: "SHADOW_ONLY",
      predictionAvailability: "UNAVAILABLE", reason: REASON,
      providerFailures: error?.providerFailures || [],
      sourceHealth: { odds: { status: "UNAVAILABLE", failures: error?.providerFailures || [],
        objectPolicy: error?.objectPolicy || null } }
    });
  }
}
