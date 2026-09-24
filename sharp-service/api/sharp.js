import {
  protectedSportsGameOddsFetch
} from "../lib/provider-protection.js";

const DEFAULT_LEAGUES = ["MLB", "NFL", "NBA", "NHL", "NCAAF", "NCAAB", "MLS"];
const PROVIDER_FRESH_MS = 60 * 1000;
const PROVIDER_STALE_MS = 5 * 60 * 1000;
const PROVIDER_CONCURRENCY = 2;

function csv(value, fallback = []) {
  if (!value) return fallback;
  const text = Array.isArray(value) ? value[0] : value;
  return String(text)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 40);
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

async function fetchLeague({
  league,
  books,
  includeAltLines,
  limit,
  apiKey
}) {
  const params = new URLSearchParams({
    leagueID: league,
    oddsAvailable: "true",
    includeOpenCloseOdds: "true",
    includeAltLines: includeAltLines ? "true" : "false",
    type: "match",
    limit: String(limit)
  });

  if (books.length) {
    params.set("bookmakerID", books.join(","));
  }

  const url =
    `https://api.sportsgameodds.com/v2/events?${params.toString()}`;

  try {
    const result = await protectedSportsGameOddsFetch({
      url,
      apiKey,
      freshMs: PROVIDER_FRESH_MS,
      staleMs: PROVIDER_STALE_MS,
      timeoutMs: 7_000,
      consumer: "sharp",
      priority: "background"
    });

    return {
      league,
      ok: true,
      data: result.payload?.data ?? [],
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
      circuitOpen: Boolean(error?.circuitOpen),
      budgetBlocked: Boolean(error?.budgetBlocked),
      budget: error?.budget || null
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

  const configuredToken = process.env.SHARP_MONITOR_TOKEN;
  if (configuredToken) {
    const supplied = req.headers["x-monitor-token"] || req.query.token;
    if (supplied !== configuredToken) {
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
  const includeAltLines = String(req.query.alts || "0") === "1";
  const limitRaw = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, limitRaw))
    : 100;

  const results = await mapWithConcurrency(
    leagues,
    PROVIDER_CONCURRENCY,
    (league) =>
      fetchLeague({
        league,
        books,
        includeAltLines,
        limit,
        apiKey
      })
  );

  const availableLeagues = results.filter((row) => row.ok);
  const unavailableLeagues = results
    .filter((row) => !row.ok)
    .map(
      ({
        league,
        status,
        error,
        retryAfterSeconds,
        circuitOpen,
        budgetBlocked,
        budget
      }) => ({
        league,
        status,
        error,
        retryAfterSeconds,
        circuitOpen,
        budgetBlocked,
        budget
      })
    );

  const data = availableLeagues.flatMap((row) =>
    (row.data || []).map((event) => ({
      ...event,
      _requestedLeague: row.league
    }))
  );

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

  if (availableLeagues.length === 0) {
    const retryAfter = unavailableLeagues
      .map((row) => row.retryAfterSeconds)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)[0];

    if (retryAfter !== undefined) {
      res.setHeader("Retry-After", String(retryAfter));
    }

    const allBudgetBlocked =
      unavailableLeagues.length > 0 &&
      unavailableLeagues.every((row) => row.budgetBlocked);

    return res.status(allBudgetBlocked ? 429 : 502).json({
      error: allBudgetBlocked
        ? "Provider request budget is preserving capacity for higher-priority traffic"
        : "No requested leagues were available from SportsGameOdds",
      fetchedAt: new Date().toISOString(),
      leagues,
      books: books.length ? books : "account-entitled bookmakers",
      providerCache,
      unavailableLeagues
    });
  }

  return res.status(200).json({
    fetchedAt: new Date().toISOString(),
    source: "SportsGameOdds v2",
    requestedLeagues: leagues,
    availableLeagues: availableLeagues.map((row) => row.league),
    unavailableLeagues,
    books: books.length ? books : "account-entitled bookmakers",
    includeAltLines,
    providerCache,
    eventCount: data.length,
    data
  });
}
