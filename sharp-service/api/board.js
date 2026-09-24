import {
  protectedSportsGameOddsFetch
} from "../lib/provider-protection.js";

const DEFAULT_LEAGUES = ["MLB"];
const PROVIDER_FRESH_MS = 60 * 1000;
const PROVIDER_STALE_MS = 5 * 60 * 1000;
const PROVIDER_CONCURRENCY = 2;

const CORE_ODD_IDS = [
  "points-away-game-ml-away",
  "points-home-game-ml-home",
  "points-away-game-sp-away",
  "points-home-game-sp-home",
  "points-all-game-ou-over",
  "points-all-game-ou-under",
  "points-away-game-ml3way-away",
  "points-home-game-ml3way-home",
  "points-all-game-ml3way-draw",
  "points-away-reg-sp-away",
  "points-home-reg-sp-home",
  "points-all-reg-ou-over",
  "points-all-reg-ou-under",
  "points-away-reg-ml3way-away",
  "points-home-reg-ml3way-home",
  "points-all-reg-ml3way-draw"
];

function csv(value, fallback = []) {
  if (!value) return fallback;
  const text = Array.isArray(value) ? value[0] : value;
  return String(text)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function unique(values, { upper = false, sort = false } = {}) {
  const normalized = values.map((value) =>
    upper ? String(value).toUpperCase() : String(value)
  );
  const deduped = [...new Set(normalized)];
  return sort ? deduped.sort() : deduped;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Math.min(Math.max(1, limit), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function numOrString(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function compactBooks(byBookmaker = {}, lineField) {
  const out = {};
  for (const [book, price] of Object.entries(byBookmaker || {})) {
    if (!price) continue;
    out[book] = {
      odds: price.odds ?? null,
      line: lineField ? numOrString(price[lineField]) : null,
      openOdds: price.openOdds ?? null,
      openLine: lineField
        ? numOrString(
            lineField === "spread"
              ? price.openSpread
              : lineField === "overUnder"
              ? price.openOverUnder
              : null
          )
        : null,
      closeOdds: price.closeOdds ?? null,
      closeLine: lineField
        ? numOrString(
            lineField === "spread"
              ? price.closeSpread
              : lineField === "overUnder"
              ? price.closeOverUnder
              : null
          )
        : null,
      available: price.available ?? null,
      updatedAt: price.lastUpdatedAt ?? null
    };
  }
  return out;
}

function compactMarket(odd, lineField = null) {
  if (!odd) return null;

  let currentLine = null;
  let fairLine = null;
  let openLine = null;
  let closeLine = null;

  if (lineField === "spread") {
    currentLine = numOrString(odd.bookSpread);
    fairLine = numOrString(odd.fairSpread);
    openLine = numOrString(odd.openBookSpread);
    closeLine = numOrString(odd.closeBookSpread);
  } else if (lineField === "overUnder") {
    currentLine = numOrString(odd.bookOverUnder);
    fairLine = numOrString(odd.fairOverUnder);
    openLine = numOrString(odd.openBookOverUnder);
    closeLine = numOrString(odd.closeBookOverUnder);
  }

  return {
    oddID: odd.oddID,
    market: odd.marketName ?? null,
    side: odd.sideID ?? null,
    consensus: {
      odds: odd.bookOdds ?? null,
      fairOdds: odd.fairOdds ?? null,
      line: currentLine,
      fairLine,
      openOdds: odd.openBookOdds ?? null,
      openFairOdds: odd.openFairOdds ?? null,
      openLine,
      closeOdds: odd.closeBookOdds ?? null,
      closeFairOdds: odd.closeFairOdds ?? null,
      closeLine
    },
    books: compactBooks(odd.byBookmaker, lineField)
  };
}

function summarizeEvent(event) {
  const odds = event.odds || {};
  const home = event.teams?.home || {};
  const away = event.teams?.away || {};
  const isSoccer = event.sportID === "SOCCER";
  const periodPick = (gameOdd, regOdd) =>
    isSoccer ? (regOdd || gameOdd) : (gameOdd || regOdd);

  const moneyline = {
    away: compactMarket(odds["points-away-game-ml-away"]),
    home: compactMarket(odds["points-home-game-ml-home"])
  };

  const spread = {
    away: compactMarket(
      periodPick(
        odds["points-away-game-sp-away"],
        odds["points-away-reg-sp-away"]
      ),
      "spread"
    ),
    home: compactMarket(
      periodPick(
        odds["points-home-game-sp-home"],
        odds["points-home-reg-sp-home"]
      ),
      "spread"
    )
  };

  const total = {
    over: compactMarket(
      periodPick(
        odds["points-all-game-ou-over"],
        odds["points-all-reg-ou-over"]
      ),
      "overUnder"
    ),
    under: compactMarket(
      periodPick(
        odds["points-all-game-ou-under"],
        odds["points-all-reg-ou-under"]
      ),
      "overUnder"
    )
  };

  const threeWay = {
    away: compactMarket(
      periodPick(
        odds["points-away-game-ml3way-away"],
        odds["points-away-reg-ml3way-away"]
      )
    ),
    draw: compactMarket(
      periodPick(
        odds["points-all-game-ml3way-draw"],
        odds["points-all-reg-ml3way-draw"]
      )
    ),
    home: compactMarket(
      periodPick(
        odds["points-home-game-ml3way-home"],
        odds["points-home-reg-ml3way-home"]
      )
    )
  };

  return {
    eventID: event.eventID,
    sport: event.sportID ?? null,
    league: event.leagueID ?? null,
    startsAt: event.status?.startsAt ?? null,
    status: {
      started: event.status?.started ?? false,
      live: event.status?.live ?? false,
      completed: event.status?.completed ?? false,
      finalized: event.status?.finalized ?? false,
      display: event.status?.displayShort ?? null
    },
    matchup: {
      away: {
        id: away.teamID ?? null,
        name: away.names?.long ?? away.names?.medium ?? null,
        short: away.names?.short ?? null,
        score: away.score ?? null
      },
      home: {
        id: home.teamID ?? null,
        name: home.names?.long ?? home.names?.medium ?? null,
        short: home.names?.short ?? null,
        score: home.score ?? null
      }
    },
    markets: {
      moneyline,
      spread,
      total,
      threeWay
    }
  };
}

async function fetchLeague({
  league,
  books,
  limit,
  apiKey,
  live,
  startsAfter,
  startsBefore
}) {
  const params = new URLSearchParams({
    leagueID: league,
    oddIDs: CORE_ODD_IDS.join(","),
    oddsAvailable: "true",
    includeOpenCloseOdds: "true",
    includeAltLines: "false",
    type: "match",
    limit: String(limit)
  });

  if (books.length) params.set("bookmakerID", books.join(","));
  if (live === "true" || live === "false") params.set("live", live);
  if (startsAfter) params.set("startsAfter", startsAfter);
  if (startsBefore) params.set("startsBefore", startsBefore);

  const url =
    `https://api.sportsgameodds.com/v2/events?${params.toString()}`;

  try {
    const result = await protectedSportsGameOddsFetch({
      url,
      apiKey,
      freshMs: PROVIDER_FRESH_MS,
      staleMs: PROVIDER_STALE_MS,
      timeoutMs: 7_000
    });

    return {
      league,
      ok: true,
      events: (result.payload?.data || []).map(summarizeEvent),
      nextCursor: result.payload?.nextCursor ?? null,
      providerFetchedAt: new Date(result.fetchedAt).toISOString(),
      cache: {
        status: result.cacheStatus,
        layer: result.cacheLayer,
        ageSeconds: Number((result.ageMs / 1000).toFixed(1)),
        sharedEnabled: result.sharedEnabled,
        circuitOpen: result.circuitOpen,
        upstreamError: result.upstreamError
      }
    };
  } catch (error) {
    return {
      league,
      ok: false,
      status: Number(error?.status || 502),
      error:
        error instanceof Error
          ? error.message
          : "SportsGameOdds request failed",
      retryAfterSeconds: error?.retryAfter ?? null,
      circuitOpen: Boolean(error?.circuitOpen)
    };
  }
}

function summarizeProviderCache(results) {
  const successful = results.filter((row) => row.ok && row.cache);
  const statusCounts = {};
  const layerCounts = {};

  for (const row of successful) {
    statusCounts[row.cache.status] =
      (statusCounts[row.cache.status] || 0) + 1;
    layerCounts[row.cache.layer] =
      (layerCounts[row.cache.layer] || 0) + 1;
  }

  const statuses = Object.keys(statusCounts);
  return {
    status:
      statuses.length === 0
        ? "ERROR"
        : statuses.length === 1
        ? statuses[0]
        : "MIXED",
    statusCounts,
    layerCounts,
    sharedEnabled: successful.some((row) => row.cache.sharedEnabled),
    circuitOpen: results.some(
      (row) => row.cache?.circuitOpen || row.circuitOpen
    ),
    staleLeagues: successful
      .filter((row) => row.cache.status === "STALE")
      .map((row) => row.league)
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const token = process.env.SHARP_MONITOR_TOKEN;
  if (token) {
    const supplied = req.headers["x-monitor-token"] || req.query.token;
    if (supplied !== token) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const apiKey = process.env.SPORTS_ODDS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "SPORTS_ODDS_API_KEY is not configured on the server"
    });
  }

  const leagues = unique(csv(req.query.leagues, DEFAULT_LEAGUES), {
    upper: true
  });
  const books = unique(csv(req.query.books, []), { sort: true });
  const limitRaw = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, limitRaw))
    : 100;
  const live = String(req.query.live ?? "");
  const startsAfter = req.query.startsAfter ? String(req.query.startsAfter) : "";
  const startsBefore = req.query.startsBefore ? String(req.query.startsBefore) : "";

  const results = await mapWithConcurrency(
    leagues,
    PROVIDER_CONCURRENCY,
    (league) =>
      fetchLeague({
        league,
        books,
        limit,
        apiKey,
        live,
        startsAfter,
        startsBefore
      })
  );

  const available = results.filter((row) => row.ok);
  const unavailable = results
    .filter((row) => !row.ok)
    .map(
      ({
        league,
        status,
        error,
        retryAfterSeconds,
        circuitOpen
      }) => ({
        league,
        status,
        error,
        retryAfterSeconds,
        circuitOpen
      })
    );

  const events = available.flatMap((row) => row.events);
  const providerCache = summarizeProviderCache(results);

  res.setHeader(
    "Cache-Control",
    "public, max-age=0, s-maxage=30, stale-while-revalidate=90, stale-if-error=180"
  );
  res.setHeader("X-Provider-Cache", providerCache.status);
  res.setHeader(
    "X-Provider-Circuit",
    providerCache.circuitOpen ? "OPEN" : "CLOSED"
  );

  return res.status(200).json({
    fetchedAt: new Date().toISOString(),
    source: "SportsGameOdds v2",
    endpoint: "compact-board",
    requestedLeagues: leagues,
    books: books.length ? books : "account-entitled bookmakers",
    window: {
      startsAfter: startsAfter || null,
      startsBefore: startsBefore || null
    },
    providerCache,
    unavailableLeagues: unavailable,
    eventCount: events.length,
    events
  });
}
