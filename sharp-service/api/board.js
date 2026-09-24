import {
  optimizeSportsGameOddsObjectLimit,
  protectedSportsGameOddsFetch
} from "../lib/provider-protection.js";
import { adaptiveRefreshPolicy } from "../lib/adaptive-refresh.js";
import {
  fetchSharpApiBoardLeague
} from "../lib/sharpapi-provider.js";

const DEFAULT_LEAGUES = ["MLB"];
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

function boardPriority(live, startsBefore) {
  if (live === "true") return "critical";

  const cutoff = Date.parse(String(startsBefore || ""));
  const now = Date.now();
  if (
    Number.isFinite(cutoff) &&
    cutoff >= now - 5 * 60 * 1000 &&
    cutoff <= now + 90 * 60 * 1000
  ) {
    return "critical";
  }

  return "normal";
}

async function fetchLeague({
  league,
  books,
  limit,
  apiKey,
  live,
  startsAfter,
  startsBefore,
  priority,
  objectPolicy,
  refreshPolicy
}) {
  const params = new URLSearchParams({
    leagueID: league,
    oddIDs: CORE_ODD_IDS.join(","),
    oddsAvailable: "true",
    includeOpenCloseOdds: "true",
    includeAltLines: "false",
    finalized: "false",
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
      freshMs: refreshPolicy.freshMs,
      staleMs: Math.max(PROVIDER_STALE_MS, refreshPolicy.staleMs),
      timeoutMs: 7_000,
      consumer: "board",
      priority,
      objectPolicy
    });

    return {
      league,
      ok: true,
      provider: "SportsGameOdds",
      events: (result.payload?.data || []).map(summarizeEvent),
      nextCursor: result.payload?.nextCursor ?? null,
      providerFetchedAt: new Date(result.fetchedAt).toISOString(),
      cache: {
        status: result.cacheStatus,
        layer: result.cacheLayer,
        ageSeconds: Number((result.ageMs / 1000).toFixed(1)),
        sharedEnabled: result.sharedEnabled,
        circuitOpen: result.circuitOpen,
        recoveryState: result.recoveryState || "CLOSED",
        budget: result.budget || null,
        objectPolicy,
        objectsReturned:
          result.cacheLayer === "upstream"
            ? result.objectsReturned || 0
            : 0,
        upstreamError: result.upstreamError
      }
    };
  } catch (error) {
    return {
      league,
      ok: false,
      provider: "SportsGameOdds",
      status: Number(error?.status || 502),
      error:
        error instanceof Error
          ? error.message
          : "SportsGameOdds request failed",
      retryAfterSeconds: error?.retryAfter ?? null,
      circuitOpen: Boolean(error?.circuitOpen),
      budgetBlocked: Boolean(error?.budgetBlocked),
      objectBudgetBlocked: Boolean(error?.objectBudgetBlocked),
      budget: error?.budget || null,
      objectPolicy: error?.objectPolicy || objectPolicy
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
  const sharpApiKey = process.env.SHARPAPI_KEY;
  if (!apiKey && !sharpApiKey) {
    return res.status(500).json({
      error:
        "No odds provider is configured. Set SPORTS_ODDS_API_KEY or SHARPAPI_KEY."
    });
  }

  const leagues = unique(csv(req.query.leagues, DEFAULT_LEAGUES), {
    upper: true
  });
  const books = unique(csv(req.query.books, []), { sort: true });
  const now = Date.now();
  const windowAnchor =
    Math.floor(now / (6 * 60 * 60 * 1000)) *
    (6 * 60 * 60 * 1000);
  const limitRaw = Number(req.query.limit || 30);
  const requestedLimit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, limitRaw))
    : 30;
  const live = String(req.query.live ?? "");
  const startsAfter = req.query.startsAfter
    ? String(req.query.startsAfter)
    : new Date(windowAnchor - 8 * 60 * 60 * 1000).toISOString();
  const startsBefore = req.query.startsBefore
    ? String(req.query.startsBefore)
    : new Date(windowAnchor + 48 * 60 * 60 * 1000).toISOString();
  const priority = boardPriority(
    live,
    req.query.startsBefore ? startsBefore : ""
  );
  const objectPolicy = apiKey
    ? await optimizeSportsGameOddsObjectLimit({
        apiKey,
        requestedLimit,
        defaultLimit: 30,
        priority,
        fanout: leagues.length
      })
    : {
        requestedLimit,
        effectiveLimit: requestedLimit,
        fanout: leagues.length,
        projectedMaxObjects: 0,
        priority,
        pressure: "NOT_CONFIGURED",
        source: "provider_disabled",
        blocked: true
      };
  const refreshPolicy = adaptiveRefreshPolicy({
    live,
    startsBefore: req.query.startsBefore ? startsBefore : null,
    priority,
    now
  });
  const limit = Math.max(1, objectPolicy.effectiveLimit || 1);

  const primaryResults = apiKey
    ? await mapWithConcurrency(
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
            startsBefore,
            priority,
            objectPolicy,
            refreshPolicy
          })
      )
    : leagues.map((league) => ({
        league,
        ok: false,
        provider: "SportsGameOdds",
        status: 503,
        error: "SPORTS_ODDS_API_KEY missing",
        objectPolicy
      }));

  const primaryByLeague = new Map(
    primaryResults.map((row) => [row.league, row])
  );
  const fallbackTargets = primaryResults
    .filter((row) => !row.ok)
    .map((row) => row.league);

  const sharpFallbackResults = sharpApiKey && fallbackTargets.length
    ? await mapWithConcurrency(
        fallbackTargets,
        1,
        async (league) => {
          try {
            return await fetchSharpApiBoardLeague({
              apiKey: sharpApiKey,
              league,
              books,
              live,
              startsAfter,
              startsBefore,
              freshMs: Math.max(60_000, refreshPolicy.freshMs),
              staleMs: Math.max(PROVIDER_STALE_MS, refreshPolicy.staleMs)
            });
          } catch (error) {
            return {
              league,
              ok: false,
              provider: "SharpAPI",
              status: Number(error?.status || 502),
              error:
                error instanceof Error
                  ? error.message
                  : "SharpAPI request failed",
              retryAfterSeconds: error?.retryAfter ?? null
            };
          }
        }
      )
    : [];

  const sharpByLeague = new Map(
    sharpFallbackResults.map((row) => [row.league, row])
  );

  const results = leagues.map((league) => {
    const primary = primaryByLeague.get(league);
    if (primary?.ok) return primary;
    const fallback = sharpByLeague.get(league);
    if (fallback?.ok) {
      return {
        ...fallback,
        fallbackFrom: {
          provider: primary?.provider || "SportsGameOdds",
          status: primary?.status || null,
          error: primary?.error || null,
          objectBudgetBlocked:
            Boolean(primary?.objectBudgetBlocked)
        }
      };
    }
    return {
      ...(fallback || primary || {
        league,
        ok: false,
        provider: "none",
        status: 503,
        error: "No odds provider available"
      }),
      primaryFailure: primary
        ? {
            provider: primary.provider,
            status: primary.status || null,
            error: primary.error || null,
            objectBudgetBlocked:
              Boolean(primary.objectBudgetBlocked)
          }
        : null
    };
  });

  const available = results.filter((row) => row.ok);
  const unavailable = results
    .filter((row) => !row.ok)
    .map((row) => ({
      league: row.league,
      provider: row.provider || null,
      status: row.status || null,
      error: row.error || null,
      retryAfterSeconds: row.retryAfterSeconds || null,
      primaryFailure: row.primaryFailure || null
    }));

  const providerFailures = [
    ...primaryResults
      .filter((row) => !row.ok)
      .map((row) => ({
        league: row.league,
        provider: row.provider,
        status: row.status || null,
        error: row.error || null,
        objectBudgetBlocked:
          Boolean(row.objectBudgetBlocked)
      })),
    ...sharpFallbackResults
      .filter((row) => !row.ok)
      .map((row) => ({
        league: row.league,
        provider: row.provider,
        status: row.status || null,
        error: row.error || null
      }))
  ];

  const events = available.flatMap((row) => row.events);
  const providerCache = summarizeProviderCache(results);
  const providersUsed = [
    ...new Set(available.map((row) => row.provider).filter(Boolean))
  ];

  res.setHeader(
    "Cache-Control",
    `public, max-age=0, s-maxage=${refreshPolicy.suggestedSeconds}, stale-while-revalidate=${Math.max(60, refreshPolicy.suggestedSeconds * 2)}, stale-if-error=300`
  );
  res.setHeader("X-Provider-Cache", providerCache.status);
  res.setHeader(
    "X-Provider-Circuit",
    providerCache.circuitOpen ? "OPEN" : "CLOSED"
  );

  return res.status(200).json({
    fetchedAt: new Date().toISOString(),
    source:
      providersUsed.length === 1
        ? providersUsed[0]
        : providersUsed.length > 1
          ? "multi-provider"
          : "none",
    providerChain: ["SportsGameOdds", "SharpAPI"],
    providersUsed,
    endpoint: "compact-board",
    requestedLeagues: leagues,
    books: books.length ? books : "account-entitled bookmakers",
    providerPriority: priority,
    refreshPolicy,
    objectOptimization: {
      ...objectPolicy,
      objectsReturned: available.reduce(
        (sum, row) => sum + Number(row.cache?.objectsReturned || 0),
        0
      )
    },
    window: {
      startsAfter: startsAfter || null,
      startsBefore: startsBefore || null
    },
    providerCache,
    providerFailures,
    unavailableLeagues: unavailable,
    eventCount: events.length,
    events
  });
}
