const DEFAULT_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

const PROP_PATTERNS = [
  "pitching_strikeouts-PLAYER_ID-game-ou-over",
  "pitching_strikeouts-PLAYER_ID-game-ou-under",
  "batting_hits-PLAYER_ID-game-ou-over",
  "batting_hits-PLAYER_ID-game-ou-under",
  "batting_totalBases-PLAYER_ID-game-ou-over",
  "batting_totalBases-PLAYER_ID-game-ou-under"
];

const CACHE_TTL_MS = 60 * 1000;
const STALE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

const cacheState =
  globalThis.__edgeLabPropsCache ||
  (globalThis.__edgeLabPropsCache = {
    entries: new Map(),
    inFlight: new Map()
  });

function csv(value, fallback = []) {
  if (!value) return fallback;
  const text = Array.isArray(value) ? value[0] : value;
  return String(text)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function num(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterSeconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(String(value));
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function compactBooks(byBookmaker = {}) {
  const out = {};
  for (const [book, p] of Object.entries(byBookmaker || {})) {
    if (!p) continue;
    out[book] = {
      odds: num(p.odds),
      line: num(p.overUnder),
      openOdds: num(p.openOdds),
      openLine: num(p.openOverUnder),
      closeOdds: num(p.closeOdds),
      closeLine: num(p.closeOverUnder),
      available: p.available ?? null,
      updatedAt: p.lastUpdatedAt ?? null
    };
  }
  return out;
}

function playerNameFromOdd(odd = {}) {
  const explicit =
    odd.playerName ||
    odd.statEntityName ||
    odd.entityName ||
    odd.participantName;
  if (explicit) return String(explicit);

  let name = String(odd.marketName || "");
  name = name
    .replace(/\s+(Pitcher\s+)?Strikeouts\s+Over\/Under.*$/i, "")
    .replace(/\s+Hits\s+Over\/Under.*$/i, "")
    .replace(/\s+Total\s+Bases\s+Over\/Under.*$/i, "")
    .trim();
  if (name) return name;

  return String(odd.playerID || odd.statEntityID || "")
    .replace(/_\d+_MLB$/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function marketKey(odd = {}) {
  return [
    odd.statID || "",
    odd.playerID || odd.statEntityID || ""
  ].join("|");
}

function summarizeEvent(event) {
  const groups = new Map();
  for (const odd of Object.values(event.odds || {})) {
    if (!odd || !PROP_PATTERNS.some((p) => {
      const stat = p.split("-PLAYER_ID-")[0];
      return odd.statID === stat;
    })) continue;

    const key = marketKey(odd);
    if (!groups.has(key)) {
      groups.set(key, {
        statID: odd.statID ?? null,
        playerID: odd.playerID ?? odd.statEntityID ?? null,
        playerName: playerNameFromOdd(odd),
        marketName: odd.marketName ?? null,
        over: null,
        under: null
      });
    }

    const row = groups.get(key);
    const side = odd.sideID;
    if (side !== "over" && side !== "under") continue;
    row[side] = {
      oddID: odd.oddID ?? null,
      side,
      consensus: {
        odds: num(odd.bookOdds),
        fairOdds: num(odd.fairOdds),
        line: num(odd.bookOverUnder),
        fairLine: num(odd.fairOverUnder)
      },
      books: compactBooks(odd.byBookmaker)
    };
  }

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
        id: event.teams?.away?.teamID ?? null,
        name:
          event.teams?.away?.names?.long ??
          event.teams?.away?.names?.medium ??
          null
      },
      home: {
        id: event.teams?.home?.teamID ?? null,
        name:
          event.teams?.home?.names?.long ??
          event.teams?.home?.names?.medium ??
          null
      }
    },
    props: [...groups.values()]
  };
}

function cacheKey(params) {
  return params.toString();
}

function trimCache() {
  while (cacheState.entries.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cacheState.entries.keys().next().value;
    if (!oldestKey) break;
    cacheState.entries.delete(oldestKey);
  }
}

function parsePayload(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return { error: raw.slice(0, 800) };
  }
}

async function fetchUpstream(url, apiKey) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const upstream = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        accept: "application/json"
      },
      cache: "no-store"
    });

    const raw = await upstream.text();
    const payload = parsePayload(raw);

    if (upstream.ok && payload?.success !== false) {
      return {
        payload,
        status: upstream.status,
        retryAfter: null
      };
    }

    const retryAfter = retryAfterSeconds(upstream.headers.get("retry-after"));
    const error = new Error(
      payload?.error ||
        payload?.message ||
        "SportsGameOdds prop request failed"
    );
    error.status = upstream.status || 502;
    error.retryAfter = retryAfter;

    const retryableServerError = error.status >= 500 && error.status <= 599;
    const shortRateLimit = error.status === 429 && retryAfter !== null && retryAfter <= 2;

    if (attempt === 0 && (retryableServerError || shortRateLimit)) {
      const delayMs = shortRateLimit
        ? Math.max(250, retryAfter * 1000)
        : 400;
      await sleep(delayMs);
      continue;
    }

    throw error;
  }

  throw new Error("SportsGameOdds prop request failed after retry");
}

function buildBody({ payload, books, startsAfter, startsBefore }) {
  const events = (payload?.data || [])
    .map(summarizeEvent)
    .filter((e) => e.props.length > 0);

  return {
    fetchedAt: new Date().toISOString(),
    version: "MLB Props Board v1.1",
    source: "SportsGameOdds v2",
    books,
    markets: [
      "pitching_strikeouts",
      "batting_hits",
      "batting_totalBases"
    ],
    window: {
      startsAfter: startsAfter || null,
      startsBefore: startsBefore || null
    },
    providerNotice: payload?.notice ?? null,
    eventCount: events.length,
    propCount: events.reduce((n, e) => n + e.props.length, 0),
    events
  };
}

async function getProps({ key, url, apiKey, books, startsAfter, startsBefore }) {
  const now = Date.now();
  const cached = cacheState.entries.get(key);
  if (cached && now - cached.storedAt < CACHE_TTL_MS) {
    return {
      body: cached.body,
      cacheStatus: "HIT",
      ageMs: now - cached.storedAt,
      upstreamError: null
    };
  }

  if (cacheState.inFlight.has(key)) {
    const shared = await cacheState.inFlight.get(key);
    return {
      ...shared,
      cacheStatus: shared.cacheStatus === "MISS" ? "COALESCED" : shared.cacheStatus
    };
  }

  const work = (async () => {
    try {
      const { payload } = await fetchUpstream(url, apiKey);
      const body = buildBody({ payload, books, startsAfter, startsBefore });
      cacheState.entries.delete(key);
      cacheState.entries.set(key, { body, storedAt: Date.now() });
      trimCache();
      return {
        body,
        cacheStatus: "MISS",
        ageMs: 0,
        upstreamError: null
      };
    } catch (error) {
      const stale = cacheState.entries.get(key);
      const ageMs = stale ? Date.now() - stale.storedAt : Infinity;
      const status = Number(error?.status || 502);
      const canServeStale =
        stale &&
        ageMs <= STALE_TTL_MS &&
        (status === 429 || status >= 500);

      if (canServeStale) {
        return {
          body: stale.body,
          cacheStatus: "STALE",
          ageMs,
          upstreamError: {
            status,
            message: error instanceof Error ? error.message : String(error),
            retryAfterSeconds: error?.retryAfter ?? null
          }
        };
      }

      throw error;
    }
  })();

  cacheState.inFlight.set(key, work);
  try {
    return await work;
  } finally {
    if (cacheState.inFlight.get(key) === work) {
      cacheState.inFlight.delete(key);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const apiKey = process.env.SPORTS_ODDS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "SPORTS_ODDS_API_KEY missing" });
  }

  const books = [...new Set(csv(req.query.books, DEFAULT_BOOKS))].sort();
  const limitRaw = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, limitRaw))
    : 100;
  const startsAfter = req.query.startsAfter ? String(req.query.startsAfter) : "";
  const startsBefore = req.query.startsBefore ? String(req.query.startsBefore) : "";

  const params = new URLSearchParams({
    leagueID: "MLB",
    oddIDs: PROP_PATTERNS.join(","),
    oddsAvailable: "true",
    includeOpenCloseOdds: "true",
    includeAltLines: "true",
    type: "match",
    limit: String(limit)
  });
  if (books.length) params.set("bookmakerID", books.join(","));
  if (startsAfter) params.set("startsAfter", startsAfter);
  if (startsBefore) params.set("startsBefore", startsBefore);

  const key = cacheKey(params);
  const url = `https://api.sportsgameodds.com/v2/events?${key}`;

  try {
    const result = await getProps({
      key,
      url,
      apiKey,
      books,
      startsAfter,
      startsBefore
    });

    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=60, stale-while-revalidate=240, stale-if-error=300"
    );
    res.setHeader(
      "CDN-Cache-Control",
      "public, max-age=60, stale-while-revalidate=240, stale-if-error=300"
    );
    res.setHeader("Vercel-Cache-Tag", "edge-lab-props");
    res.setHeader("X-Props-Cache", result.cacheStatus);

    return res.status(200).json({
      ...result.body,
      cache: {
        status: result.cacheStatus,
        ageSeconds: Number((result.ageMs / 1000).toFixed(1)),
        freshForSeconds: CACHE_TTL_MS / 1000,
        staleForSeconds: STALE_TTL_MS / 1000
      },
      servedStale: result.cacheStatus === "STALE",
      upstreamError: result.upstreamError
    });
  } catch (error) {
    const status = Number(error?.status || 502);
    const retryAfter = error?.retryAfter ?? null;
    if (retryAfter !== null) {
      res.setHeader("Retry-After", String(retryAfter));
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Props-Cache", "MISS");

    return res.status(status).json({
      error: error instanceof Error ? error.message : String(error),
      source: "SportsGameOdds v2",
      retryAfterSeconds: retryAfter,
      cache: {
        status: "MISS",
        freshForSeconds: CACHE_TTL_MS / 1000,
        staleForSeconds: STALE_TTL_MS / 1000
      }
    });
  }
}
