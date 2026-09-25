const SHARPAPI_BASE = "https://api.sharpapi.io/api/v1";
const DEFAULT_FRESH_MS = 60_000;
const DEFAULT_STALE_MS = 5 * 60_000;
const MAX_PAGES = 4;

const state =
  globalThis.__edgeLabSharpApi ||
  (globalThis.__edgeLabSharpApi = {
    cache: new Map(),
    inFlight: new Map()
  });

const LEAGUE_SLUGS = Object.freeze({
  MLB: "mlb",
  NFL: "nfl",
  NBA: "nba",
  NHL: "nhl",
  NCAAF: "ncaaf",
  NCAAB: "ncaab",
  MLS: "mls"
});

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace("+", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values) {
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2
    ? usable[middle]
    : (usable[middle - 1] + usable[middle]) / 2;
}

function americanToProbability(odds) {
  const value = num(odds);
  if (value === null || value === 0) return null;
  return value > 0
    ? 100 / (value + 100)
    : Math.abs(value) / (Math.abs(value) + 100);
}

function probabilityToAmerican(probability) {
  const p = num(probability);
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5
    ? Math.round((-100 * p) / (1 - p))
    : Math.round((100 * (1 - p)) / p);
}

function consensusFromBooks(books = {}) {
  const rows = Object.values(books || {}).filter(
    (row) => row && row.available !== false
  );
  const probabilities = rows
    .map((row) => americanToProbability(row.odds))
    .filter(Number.isFinite);
  const lines = rows.map((row) => num(row.line)).filter(Number.isFinite);
  const probability =
    probabilities.length
      ? probabilities.reduce((sum, value) => sum + value, 0) /
        probabilities.length
      : null;

  return {
    odds:
      probability === null
        ? null
        : probabilityToAmerican(probability),
    fairOdds: null,
    line: median(lines),
    fairLine: null,
    openOdds: null,
    openFairOdds: null,
    openLine: null,
    closeOdds: null,
    closeFairOdds: null,
    closeLine: null
  };
}

function sideContainer(side, marketType, books) {
  if (!books || Object.keys(books).length === 0) return null;
  return {
    oddID: null,
    market: marketType,
    side,
    consensus: consensusFromBooks(books),
    books
  };
}

function normalizeBookRow(row) {
  return {
    odds: num(row.odds_american),
    line: num(row.line),
    openOdds: null,
    openLine: null,
    closeOdds: null,
    closeLine: null,
    available: true,
    updatedAt: row.timestamp || null
  };
}

function boardMarketTarget(row) {
  const type = String(row.market_type || "").toLowerCase();
  const side = String(row.selection_type || "").toLowerCase();

  if (type === "moneyline" && ["home", "away"].includes(side)) {
    return ["moneyline", side];
  }
  if (type === "moneyline_3-way" && ["home", "away", "draw"].includes(side)) {
    return ["threeWay", side];
  }
  if (
    ["point_spread", "run_line", "puck_line"].includes(type) &&
    ["home", "away"].includes(side)
  ) {
    return ["spread", side];
  }
  if (
    ["total_points", "total_runs", "total_goals"].includes(type) &&
    ["over", "under"].includes(side)
  ) {
    return ["total", side];
  }
  return null;
}

function normalizedSport(row) {
  const value = String(row?.sport || "").toUpperCase();
  if (value === "BASEBALL") return "BASEBALL";
  if (value === "FOOTBALL") return "FOOTBALL";
  if (value === "BASKETBALL") return "BASKETBALL";
  if (value === "HOCKEY") return "HOCKEY";
  if (value === "SOCCER") return "SOCCER";
  return value || null;
}

export function normalizeSharpApiBoardRows(rows, {
  league,
  books = [],
  startsAfter = null,
  startsBefore = null,
  now = Date.now()
} = {}) {
  const wantedBooks = new Set(
    (books || []).map((book) => String(book).toLowerCase())
  );
  const afterMs = Date.parse(startsAfter || "");
  const beforeMs = Date.parse(startsBefore || "");
  const grouped = new Map();

  for (const row of rows || []) {
    const book = String(row?.sportsbook || "").toLowerCase();
    if (wantedBooks.size && !wantedBooks.has(book)) continue;

    const startsAt = row?.event_start_time || null;
    const startsMs = Date.parse(startsAt || "");
    if (Number.isFinite(afterMs) && Number.isFinite(startsMs) && startsMs < afterMs) {
      continue;
    }
    if (Number.isFinite(beforeMs) && Number.isFinite(startsMs) && startsMs > beforeMs) {
      continue;
    }

    const target = boardMarketTarget(row);
    if (!target) continue;
    const eventID = String(row?.event_id || "");
    if (!eventID) continue;

    if (!grouped.has(eventID)) {
      grouped.set(eventID, {
        eventID: `sharpapi:${eventID}`,
        providerEventID: eventID,
        provider: "SharpAPI",
        sport: normalizedSport(row),
        league: String(row?.league || league || "").toUpperCase(),
        startsAt,
        status: {
          started:
            Boolean(row?.is_live) ||
            (Number.isFinite(startsMs) && startsMs <= now),
          live: Boolean(row?.is_live),
          completed: false,
          finalized: false,
          display: row?.is_live ? "LIVE" : null
        },
        matchup: {
          away: {
            id: row?.away?.id || null,
            name: row?.away_team || null,
            short: row?.away?.abbreviation || null,
            score: null
          },
          home: {
            id: row?.home?.id || null,
            name: row?.home_team || null,
            short: row?.home?.abbreviation || null,
            score: null
          }
        },
        _marketBooks: {
          moneyline: { away: {}, home: {} },
          spread: { away: {}, home: {} },
          total: { over: {}, under: {} },
          threeWay: { away: {}, draw: {}, home: {} }
        }
      });
    }

    const event = grouped.get(eventID);
    event.status.live = event.status.live || Boolean(row?.is_live);
    if (event.status.live) {
      event.status.started = true;
      event.status.display = "LIVE";
    }
    const [market, side] = target;
    event._marketBooks[market][side][book] = normalizeBookRow(row);
  }

  return [...grouped.values()]
    .map((event) => {
      const markets = {
        moneyline: {
          away: sideContainer(
            "away",
            "moneyline",
            event._marketBooks.moneyline.away
          ),
          home: sideContainer(
            "home",
            "moneyline",
            event._marketBooks.moneyline.home
          )
        },
        spread: {
          away: sideContainer(
            "away",
            "spread",
            event._marketBooks.spread.away
          ),
          home: sideContainer(
            "home",
            "spread",
            event._marketBooks.spread.home
          )
        },
        total: {
          over: sideContainer(
            "over",
            "total",
            event._marketBooks.total.over
          ),
          under: sideContainer(
            "under",
            "total",
            event._marketBooks.total.under
          )
        },
        threeWay: {
          away: sideContainer(
            "away",
            "threeWay",
            event._marketBooks.threeWay.away
          ),
          draw: sideContainer(
            "draw",
            "threeWay",
            event._marketBooks.threeWay.draw
          ),
          home: sideContainer(
            "home",
            "threeWay",
            event._marketBooks.threeWay.home
          )
        }
      };
      delete event._marketBooks;
      return { ...event, markets };
    })
    .filter((event) =>
      Object.values(event.markets).some((market) =>
        Object.values(market || {}).some(Boolean)
      )
    )
    .sort(
      (a, b) =>
        Date.parse(a.startsAt || "") - Date.parse(b.startsAt || "")
    );
}

function propStatID(row, league = "MLB") {
  const type = String(row?.market_type || "").toLowerCase();
  const category = String(row?.stat_category || "").toLowerCase();
  const combined = `${type}|${category}`;

  const normalizedLeague = String(league).toUpperCase();

  if (normalizedLeague === "NFL") {
    if (/pass(ing)?[_ ]?(yards|yds)/.test(combined)) {
      return "passing_yards";
    }
    if (/pass(ing)?[_ ]?(touchdowns|tds)/.test(combined)) {
      return "passing_touchdowns";
    }
    if (/rush(ing)?[_ ]?(yards|yds)/.test(combined)) {
      return "rushing_yards";
    }
    if (/receptions?/.test(combined)) {
      return "receiving_receptions";
    }
    if (/receiv(ing|e)?[_ ]?(yards|yds)/.test(combined)) {
      return "receiving_yards";
    }
    return null;
  }

  if (normalizedLeague === "NBA") {
    if (/points?.*rebounds?.*assists?|pra/.test(combined)) {
      return "points_rebounds_assists";
    }
    if (/points?.*rebounds?/.test(combined)) {
      return "points_rebounds";
    }
    if (/points?.*assists?/.test(combined)) {
      return "points_assists";
    }
    if (/rebounds?.*assists?/.test(combined)) {
      return "rebounds_assists";
    }
    if (/blocks?.*steals?/.test(combined)) {
      return "blocks_steals";
    }
    if (/three[_ ]?(pointers?|point|pt)?[_ ]?(made|makes)|threes?/.test(combined)) {
      return "threes_made";
    }
    if (/turnovers?/.test(combined)) return "turnovers";
    if (/rebounds?/.test(combined)) return "rebounds";
    if (/assists?/.test(combined)) return "assists";
    if (/blocks?/.test(combined)) return "blocks";
    if (/steals?/.test(combined)) return "steals";
    if (/points?/.test(combined)) return "points";
    return null;
  }

  if (/strikeout/.test(combined) && !/batter.*strikeout/.test(combined)) {
    return "pitching_strikeouts";
  }
  if (/total[_ ]?bases/.test(combined)) {
    return "batting_totalBases";
  }
  if (
    /player_hits/.test(type) ||
    category === "hits" ||
    /batting[_ ]?hits/.test(combined)
  ) {
    if (/allowed/.test(combined)) return null;
    return "batting_hits";
  }
  return null;
}

export function normalizeSharpApiPropRows(rows, {
  league = "MLB",
  books = [],
  startsAfter = null,
  startsBefore = null,
  now = Date.now()
} = {}) {
  const wantedBooks = new Set(
    (books || []).map((book) => String(book).toLowerCase())
  );
  const afterMs = Date.parse(startsAfter || "");
  const beforeMs = Date.parse(startsBefore || "");
  const events = new Map();

  for (const row of rows || []) {
    const statID = propStatID(row, league);
    if (!statID) continue;

    const side = String(row?.selection_type || "").toLowerCase();
    if (!["over", "under"].includes(side)) continue;

    const book = String(row?.sportsbook || "").toLowerCase();
    if (wantedBooks.size && !wantedBooks.has(book)) continue;

    const startsAt = row?.event_start_time || null;
    const startsMs = Date.parse(startsAt || "");
    if (Number.isFinite(afterMs) && Number.isFinite(startsMs) && startsMs < afterMs) {
      continue;
    }
    if (Number.isFinite(beforeMs) && Number.isFinite(startsMs) && startsMs > beforeMs) {
      continue;
    }

    const eventID = String(row?.event_id || "");
    const playerName = String(row?.player_name || "").trim();
    if (!eventID || !playerName) continue;

    if (!events.has(eventID)) {
      events.set(eventID, {
        eventID: `sharpapi:${eventID}`,
        providerEventID: eventID,
        provider: "SharpAPI",
        sport:
          String(league).toUpperCase() === "NFL"
            ? "FOOTBALL"
            : String(league).toUpperCase() === "NBA"
            ? "BASKETBALL"
            : "BASEBALL",
        league: String(league).toUpperCase(),
        startsAt,
        status: {
          started:
            Boolean(row?.is_live) ||
            (Number.isFinite(startsMs) && startsMs <= now),
          live: Boolean(row?.is_live),
          completed: false,
          finalized: false,
          display: row?.is_live ? "LIVE" : null
        },
        matchup: {
          away: { id: row?.away?.id || null, name: row?.away_team || null },
          home: { id: row?.home?.id || null, name: row?.home_team || null }
        },
        _props: new Map()
      });
    }

    const event = events.get(eventID);
    const propKey = [
      statID,
      playerName.toLowerCase(),
      String(num(row?.line))
    ].join("|");
    if (!event._props.has(propKey)) {
      event._props.set(propKey, {
        statID,
        playerID: null,
        playerName,
        marketName: row?.market_ref?.label || row?.market_type || null,
        over: null,
        under: null,
        _books: { over: {}, under: {} }
      });
    }

    const prop = event._props.get(propKey);
    prop._books[side][book] = normalizeBookRow(row);
  }

  return [...events.values()]
    .map((event) => {
      const props = [...event._props.values()].map((prop) => {
        const over = sideContainer("over", prop.marketName, prop._books.over);
        const under = sideContainer("under", prop.marketName, prop._books.under);
        delete prop._books;
        return { ...prop, over, under };
      }).filter((prop) => prop.over || prop.under);
      delete event._props;
      return { ...event, props };
    })
    .filter((event) => event.props.length > 0)
    .sort(
      (a, b) =>
        Date.parse(a.startsAt || "") - Date.parse(b.startsAt || "")
    );
}

function cacheKey(params) {
  return JSON.stringify(params);
}

function cacheEntry(key) {
  return state.cache.get(key) || null;
}

function storeCache(key, payload) {
  state.cache.delete(key);
  state.cache.set(key, { payload, fetchedAt: Date.now() });
  while (state.cache.size > 24) {
    state.cache.delete(state.cache.keys().next().value);
  }
}

async function fetchPage(url, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
        accept: "application/json"
      },
      cache: "no-store",
      signal: controller.signal
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text.slice(0, 500) };
    }

    if (!response.ok) {
      const error = new Error(
        payload?.error?.message ||
        payload?.message ||
        `SharpAPI request failed (${response.status})`
      );
      error.status = response.status;
      error.retryAfter = Number(
        response.headers.get("retry-after") || 0
      ) || null;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSharpApiOdds({
  apiKey,
  league,
  market = "main",
  live = null,
  startsAfter = null,
  startsBefore = null,
  maxPages = MAX_PAGES,
  freshMs = DEFAULT_FRESH_MS,
  staleMs = DEFAULT_STALE_MS,
  timeoutMs = 8_000
}) {
  if (!apiKey) {
    const error = new Error("SHARPAPI_KEY missing");
    error.status = 503;
    throw error;
  }

  const leagueSlug =
    LEAGUE_SLUGS[String(league || "").toUpperCase()] ||
    String(league || "").toLowerCase();
  const paramsBase = {
    league: leagueSlug,
    market,
    live: live === "true" || live === "false" ? live : null
  };
  const key = cacheKey(paramsBase);
  const cached = cacheEntry(key);
  const ageMs = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (cached && ageMs < freshMs) {
    return {
      payload: cached.payload,
      fetchedAt: cached.fetchedAt,
      cacheStatus: "HIT",
      cacheLayer: "local",
      ageMs,
      servedStale: false
    };
  }

  if (state.inFlight.has(key)) {
    return state.inFlight.get(key);
  }

  const work = (async () => {
    const rows = [];
    let cursor = null;
    let pages = 0;
    try {
      do {
        const url = new URL(`${SHARPAPI_BASE}/odds`);
        url.searchParams.set("league", leagueSlug);
        url.searchParams.set("market", market);
        url.searchParams.set("limit", "200");
        if (live === "true" || live === "false") {
          url.searchParams.set("is_live", live);
        }
        if (market === "main") {
          url.searchParams.set("is_main_line", "true");
        }
        if (cursor) url.searchParams.set("cursor", cursor);

        const payload = await fetchPage(url, apiKey, timeoutMs);
        const pageRows = Array.isArray(payload?.data) ? payload.data : [];
        rows.push(...pageRows);
        pages += 1;

        if (
          Number.isFinite(Date.parse(startsBefore || "")) &&
          pageRows.some((row) =>
            Date.parse(row?.event_start_time || "") >
            Date.parse(startsBefore)
          )
        ) {
          break;
        }

        cursor =
          payload?.pagination?.has_more
            ? payload?.pagination?.next_cursor || null
            : null;
      } while (cursor && pages < Math.max(1, maxPages));

      const payload = {
        data: rows,
        pagination: {
          pages,
          truncated: Boolean(cursor)
        },
        source: "SharpAPI"
      };
      storeCache(key, payload);
      return {
        payload,
        fetchedAt: Date.now(),
        cacheStatus: "MISS",
        cacheLayer: "upstream",
        ageMs: 0,
        servedStale: false
      };
    } catch (error) {
      const fallback = cacheEntry(key);
      const fallbackAge = fallback
        ? Date.now() - fallback.fetchedAt
        : Infinity;
      if (fallback && fallbackAge <= staleMs) {
        return {
          payload: fallback.payload,
          fetchedAt: fallback.fetchedAt,
          cacheStatus: "STALE",
          cacheLayer: "local",
          ageMs: fallbackAge,
          servedStale: true,
          upstreamError: {
            status: Number(error?.status || 502),
            message:
              error instanceof Error
                ? error.message
                : String(error)
          }
        };
      }
      throw error;
    } finally {
      if (state.inFlight.get(key) === work) {
        state.inFlight.delete(key);
      }
    }
  })();

  state.inFlight.set(key, work);
  return work;
}

export async function fetchSharpApiBoardLeague(options) {
  const result = await fetchSharpApiOdds({
    ...options,
    market: "main"
  });
  const events = normalizeSharpApiBoardRows(
    result.payload?.data || [],
    options
  );
  return {
    league: String(options.league || "").toUpperCase(),
    ok: true,
    provider: "SharpAPI",
    events,
    providerFetchedAt: new Date(result.fetchedAt).toISOString(),
    cache: {
      status: result.cacheStatus,
      layer: result.cacheLayer,
      ageSeconds: Number((result.ageMs / 1000).toFixed(1)),
      servedStale: Boolean(result.servedStale),
      upstreamError: result.upstreamError || null
    }
  };
}

export function normalizeSharpApiMlbPropRows(rows, options = {}) {
  return normalizeSharpApiPropRows(rows, {
    ...options,
    league: "MLB"
  });
}

export function normalizeSharpApiNflPropRows(rows, options = {}) {
  return normalizeSharpApiPropRows(rows, {
    ...options,
    league: "NFL"
  });
}

export function normalizeSharpApiNbaPropRows(rows, options = {}) {
  return normalizeSharpApiPropRows(rows, {
    ...options,
    league: "NBA"
  });
}

async function fetchSharpApiProps(options, league) {
  const result = await fetchSharpApiOdds({
    ...options,
    league,
    market: "props"
  });
  const events = normalizeSharpApiPropRows(
    result.payload?.data || [],
    { ...options, league }
  );
  return {
    source: "SharpAPI",
    league,
    events,
    fetchedAt: new Date(result.fetchedAt).toISOString(),
    cache: {
      status: result.cacheStatus,
      layer: result.cacheLayer,
      ageSeconds: Number((result.ageMs / 1000).toFixed(1)),
      servedStale: Boolean(result.servedStale),
      upstreamError: result.upstreamError || null
    }
  };
}

export async function fetchSharpApiMlbProps(options) {
  return fetchSharpApiProps(options, "MLB");
}

export async function fetchSharpApiNflProps(options) {
  return fetchSharpApiProps(options, "NFL");
}

export async function fetchSharpApiNbaProps(options) {
  return fetchSharpApiProps(options, "NBA");
}
