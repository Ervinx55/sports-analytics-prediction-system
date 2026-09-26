const THE_ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const DEFAULT_BOARD_FRESH_MS = 5 * 60 * 1000;
const DEFAULT_PROP_FRESH_MS = 10 * 60 * 1000;
const DEFAULT_STALE_MS = 20 * 60 * 1000;

const state =
  globalThis.__edgeLabTheOddsApi ||
  (globalThis.__edgeLabTheOddsApi = {
    cache: new Map(),
    inFlight: new Map(),
    usage: {
      remaining: null,
      used: null,
      lastCost: null,
      updatedAt: null
    }
  });

const SPORT_KEYS = Object.freeze({
  MLB: "baseball_mlb",
  NFL: "americanfootball_nfl",
  NCAAF: "americanfootball_ncaaf",
  NBA: "basketball_nba",
  NCAAB: "basketball_ncaab",
  NHL: "icehockey_nhl",
  MLS: "soccer_usa_mls"
});

const BOOK_TO_PROVIDER = Object.freeze({
  caesars: "williamhill_us"
});

const PROVIDER_TO_BOOK = Object.freeze({
  williamhill_us: "caesars"
});

const MLB_PROP_MARKETS = Object.freeze({
  pitcher_strikeouts: "pitching_strikeouts",
  batter_hits: "batting_hits",
  batter_total_bases: "batting_totalBases"
});

const NFL_PROP_MARKETS = Object.freeze({
  player_pass_yds: "passing_yards",
  player_pass_tds: "passing_touchdowns",
  player_rush_yds: "rushing_yards",
  player_receptions: "receiving_receptions",
  player_reception_yds: "receiving_yards"
});

const NBA_PROP_MARKETS = Object.freeze({
  player_points: "points",
  player_rebounds: "rebounds",
  player_assists: "assists",
  player_threes: "threes_made",
  player_blocks: "blocks",
  player_steals: "steals",
  player_turnovers: "turnovers",
  player_blocks_steals: "blocks_steals",
  player_points_rebounds_assists: "points_rebounds_assists",
  player_points_rebounds: "points_rebounds",
  player_points_assists: "points_assists",
  player_rebounds_assists: "rebounds_assists"
});

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace("+", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
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
  const lines = rows
    .map((row) => num(row.line))
    .filter(Number.isFinite);
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

function sideContainer(side, market, books) {
  if (!books || Object.keys(books).length === 0) return null;
  return {
    oddID: null,
    market,
    side,
    consensus: consensusFromBooks(books),
    books
  };
}

function providerBookKey(book) {
  const normalized = String(book || "").toLowerCase();
  return BOOK_TO_PROVIDER[normalized] || normalized;
}

function edgeLabBookKey(book) {
  const normalized = String(book || "").toLowerCase();
  return PROVIDER_TO_BOOK[normalized] || normalized;
}

function requestedProviderBooks(books = []) {
  return [...new Set(
    (books || [])
      .map(providerBookKey)
      .filter(Boolean)
  )];
}

function cacheKeyFromUrl(urlLike) {
  const url = new URL(String(urlLike));
  url.searchParams.delete("apiKey");
  return url.toString();
}

function cached(key) {
  return state.cache.get(key) || null;
}

function storeCache(key, payload) {
  state.cache.delete(key);
  state.cache.set(key, {
    payload,
    fetchedAt: Date.now()
  });
  while (state.cache.size > 32) {
    state.cache.delete(state.cache.keys().next().value);
  }
}

function quotaReserve() {
  const configured = Number(process.env.THE_ODDS_API_CREDIT_RESERVE);
  return clamp(
    Number.isFinite(configured) ? Math.floor(configured) : 50,
    0,
    1000000
  );
}

function propEventCap() {
  const configured = Number(process.env.THE_ODDS_API_MAX_PROP_EVENTS);
  return clamp(
    Number.isFinite(configured) ? Math.floor(configured) : 2,
    0,
    20
  );
}

function quotaError() {
  const error = new Error(
    "The Odds API credit reserve is protecting the remaining quota"
  );
  error.status = 429;
  error.quotaBlocked = true;
  error.usage = { ...state.usage };
  return error;
}

function updateUsage(headers) {
  const remaining = num(headers.get("x-requests-remaining"));
  const used = num(headers.get("x-requests-used"));
  const lastCost = num(headers.get("x-requests-last"));
  if (
    remaining !== null ||
    used !== null ||
    lastCost !== null
  ) {
    state.usage = {
      remaining,
      used,
      lastCost,
      updatedAt: new Date().toISOString()
    };
  }
  return { ...state.usage };
}

async function requestJson({
  url,
  freshMs,
  staleMs,
  timeoutMs = 8_000,
  paid = true
}) {
  if (
    paid &&
    Number.isFinite(state.usage.remaining) &&
    state.usage.remaining <= quotaReserve()
  ) {
    throw quotaError();
  }

  const key = cacheKeyFromUrl(url);
  const entry = cached(key);
  const ageMs = entry ? Date.now() - entry.fetchedAt : Infinity;

  if (entry && ageMs < freshMs) {
    return {
      payload: entry.payload,
      fetchedAt: entry.fetchedAt,
      cacheStatus: "HIT",
      cacheLayer: "local",
      ageMs,
      servedStale: false,
      usage: { ...state.usage }
    };
  }

  if (state.inFlight.has(key)) {
    return state.inFlight.get(key);
  }

  const work = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
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
      const usage = updateUsage(response.headers);

      if (!response.ok) {
        const error = new Error(
          payload?.message ||
          payload?.error ||
          `The Odds API request failed (${response.status})`
        );
        error.status = response.status;
        error.usage = usage;
        throw error;
      }

      storeCache(key, payload);
      return {
        payload,
        fetchedAt: Date.now(),
        cacheStatus: "MISS",
        cacheLayer: "upstream",
        ageMs: 0,
        servedStale: false,
        usage
      };
    } catch (error) {
      const fallback = cached(key);
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
          usage: { ...state.usage },
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
      clearTimeout(timer);
      if (state.inFlight.get(key) === work) {
        state.inFlight.delete(key);
      }
    }
  })();

  state.inFlight.set(key, work);
  return work;
}

function blankBoardEvent(event, league, now) {
  const startsAt = event?.commence_time || null;
  const startsMs = Date.parse(startsAt || "");
  return {
    eventID: `theodds:${event.id}`,
    providerEventID: event.id,
    provider: "The Odds API",
    sport: String(event?.sport_key || "").toUpperCase(),
    league: String(
      event?.sport_title || league || ""
    ).toUpperCase(),
    startsAt,
    status: {
      started:
        Number.isFinite(startsMs) && startsMs <= now,
      live:
        Number.isFinite(startsMs) && startsMs <= now,
      completed: false,
      finalized: false,
      display:
        Number.isFinite(startsMs) && startsMs <= now
          ? "LIVE"
          : null
    },
    matchup: {
      away: {
        id: null,
        name: event?.away_team || null,
        short: null,
        score: null
      },
      home: {
        id: null,
        name: event?.home_team || null,
        short: null,
        score: null
      }
    },
    _marketBooks: {
      moneyline: { away: {}, home: {} },
      spread: { away: {}, home: {} },
      total: { over: {}, under: {} },
      threeWay: { away: {}, draw: {}, home: {} }
    }
  };
}

function normalizedBookPrice({
  outcome,
  updatedAt
}) {
  return {
    odds: num(outcome?.price),
    line: num(outcome?.point),
    openOdds: null,
    openLine: null,
    closeOdds: null,
    closeLine: null,
    available: true,
    updatedAt: updatedAt || null
  };
}

function outcomeSide(event, marketKey, outcome) {
  const name = String(outcome?.name || "");
  if (marketKey === "totals") {
    const side = name.toLowerCase();
    return ["over", "under"].includes(side) ? side : null;
  }
  if (name === event.home_team) return "home";
  if (name === event.away_team) return "away";
  if (/^draw$/i.test(name)) return "draw";
  return null;
}

export function normalizeTheOddsApiBoard(
  payload,
  {
    league,
    books = [],
    startsAfter = null,
    startsBefore = null,
    live = null,
    now = Date.now()
  } = {}
) {
  const wantedBooks = new Set(
    requestedProviderBooks(books)
  );
  const afterMs = Date.parse(startsAfter || "");
  const beforeMs = Date.parse(startsBefore || "");
  const events = [];

  for (const rawEvent of Array.isArray(payload) ? payload : []) {
    const startsAt = rawEvent?.commence_time || null;
    const startsMs = Date.parse(startsAt || "");
    if (
      Number.isFinite(afterMs) &&
      Number.isFinite(startsMs) &&
      startsMs < afterMs
    ) {
      continue;
    }
    if (
      Number.isFinite(beforeMs) &&
      Number.isFinite(startsMs) &&
      startsMs > beforeMs
    ) {
      continue;
    }
    const isLive =
      Number.isFinite(startsMs) && startsMs <= now;
    if (live === "true" && !isLive) continue;
    if (live === "false" && isLive) continue;

    const event = blankBoardEvent(rawEvent, league, now);

    for (const bookmaker of rawEvent?.bookmakers || []) {
      const providerBook = String(bookmaker?.key || "").toLowerCase();
      if (wantedBooks.size && !wantedBooks.has(providerBook)) continue;
      const book = edgeLabBookKey(providerBook);

      for (const market of bookmaker?.markets || []) {
        const marketKey = String(market?.key || "");
        for (const outcome of market?.outcomes || []) {
          const side = outcomeSide(rawEvent, marketKey, outcome);
          if (!side) continue;
          const price = normalizedBookPrice({
            outcome,
            updatedAt:
              market?.last_update ||
              bookmaker?.last_update ||
              null
          });

          if (marketKey === "h2h") {
            const hasDraw = (market?.outcomes || []).some(
              (row) => /^draw$/i.test(String(row?.name || ""))
            );
            const targetMarket = hasDraw ? "threeWay" : "moneyline";
            if (event._marketBooks[targetMarket][side]) {
              event._marketBooks[targetMarket][side][book] = price;
            }
          } else if (
            marketKey === "spreads" &&
            ["home", "away"].includes(side)
          ) {
            event._marketBooks.spread[side][book] = price;
          } else if (
            marketKey === "totals" &&
            ["over", "under"].includes(side)
          ) {
            event._marketBooks.total[side][book] = price;
          }
        }
      }
    }

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

    if (
      Object.values(markets).some((market) =>
        Object.values(market || {}).some(Boolean)
      )
    ) {
      events.push({ ...event, markets });
    }
  }

  return events.sort(
    (a, b) =>
      Date.parse(a.startsAt || "") -
      Date.parse(b.startsAt || "")
  );
}

export async function fetchTheOddsApiBoardLeague({
  apiKey,
  league,
  books = [],
  live = null,
  startsAfter = null,
  startsBefore = null,
  freshMs = DEFAULT_BOARD_FRESH_MS,
  staleMs = DEFAULT_STALE_MS
}) {
  if (!apiKey) {
    const error = new Error("THE_ODDS_API_KEY missing");
    error.status = 503;
    throw error;
  }

  const sportKey =
    SPORT_KEYS[String(league || "").toUpperCase()];
  if (!sportKey) {
    const error = new Error(
      `The Odds API sport mapping is not configured for ${league}`
    );
    error.status = 400;
    throw error;
  }

  const url = new URL(
    `${THE_ODDS_API_BASE}/sports/${sportKey}/odds/`
  );
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set(
    "markets",
    "h2h,spreads,totals"
  );
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");

  const providerBooks = requestedProviderBooks(books);
  if (providerBooks.length) {
    url.searchParams.set(
      "bookmakers",
      providerBooks.join(",")
    );
  } else {
    url.searchParams.set("regions", "us");
  }
  if (startsAfter) {
    url.searchParams.set(
      "commenceTimeFrom",
      new Date(startsAfter).toISOString().replace(/\.\d{3}Z$/, "Z")
    );
  }
  if (startsBefore) {
    url.searchParams.set(
      "commenceTimeTo",
      new Date(startsBefore).toISOString().replace(/\.\d{3}Z$/, "Z")
    );
  }

  const result = await requestJson({
    url,
    freshMs,
    staleMs,
    paid: true
  });
  const events = normalizeTheOddsApiBoard(
    result.payload,
    {
      league,
      books,
      startsAfter,
      startsBefore,
      live
    }
  );

  return {
    league: String(league || "").toUpperCase(),
    ok: true,
    provider: "The Odds API",
    events,
    providerFetchedAt:
      new Date(result.fetchedAt).toISOString(),
    cache: {
      status: result.cacheStatus,
      layer: result.cacheLayer,
      ageSeconds:
        Number((result.ageMs / 1000).toFixed(1)),
      servedStale:
        Boolean(result.servedStale),
      upstreamError:
        result.upstreamError || null
    },
    usage: result.usage || null
  };
}

async function fetchEvents({
  apiKey,
  sportKey,
  startsAfter,
  startsBefore
}) {
  const url = new URL(
    `${THE_ODDS_API_BASE}/sports/${sportKey}/events`
  );
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("dateFormat", "iso");
  if (startsAfter) {
    url.searchParams.set(
      "commenceTimeFrom",
      new Date(startsAfter).toISOString().replace(/\.\d{3}Z$/, "Z")
    );
  }
  if (startsBefore) {
    url.searchParams.set(
      "commenceTimeTo",
      new Date(startsBefore).toISOString().replace(/\.\d{3}Z$/, "Z")
    );
  }
  return requestJson({
    url,
    freshMs: 5 * 60 * 1000,
    staleMs: DEFAULT_STALE_MS,
    paid: false
  });
}

function propSideContainer({
  side,
  market,
  books
}) {
  return sideContainer(side, market, books);
}

function normalizePropEvent(event, books, {
  league = "MLB",
  marketMap = MLB_PROP_MARKETS,
  sport = "BASEBALL"
} = {}) {
  const groups = new Map();
  const wantedBooks = new Set(
    requestedProviderBooks(books)
  );

  for (const bookmaker of event?.bookmakers || []) {
    const providerBook =
      String(bookmaker?.key || "").toLowerCase();
    if (wantedBooks.size && !wantedBooks.has(providerBook)) {
      continue;
    }
    const book = edgeLabBookKey(providerBook);

    for (const market of bookmaker?.markets || []) {
      const statID =
        marketMap[String(market?.key || "")];
      if (!statID) continue;

      for (const outcome of market?.outcomes || []) {
        const side =
          String(outcome?.name || "").toLowerCase();
        if (!["over", "under"].includes(side)) continue;

        const playerName =
          String(outcome?.description || "").trim();
        if (!playerName) continue;

        const groupKey = [
          statID,
          playerName.toLowerCase()
        ].join("|");
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            statID,
            playerID: null,
            playerName,
            marketName:
              market?.key || statID,
            _books: {
              over: {},
              under: {}
            }
          });
        }

        groups.get(groupKey)._books[side][book] =
          normalizedBookPrice({
            outcome,
            updatedAt:
              market?.last_update ||
              bookmaker?.last_update ||
              null
          });
      }
    }
  }

  const props = [...groups.values()]
    .map((prop) => {
      const over = propSideContainer({
        side: "over",
        market: prop.marketName,
        books: prop._books.over
      });
      const under = propSideContainer({
        side: "under",
        market: prop.marketName,
        books: prop._books.under
      });
      delete prop._books;
      return { ...prop, over, under };
    })
    .filter((prop) => prop.over || prop.under);

  return {
    eventID: `theodds:${event.id}`,
    providerEventID: event.id,
    provider: "The Odds API",
    sport,
    league: String(league).toUpperCase(),
    startsAt: event?.commence_time || null,
    status: {
      started:
        Date.parse(event?.commence_time || "") <=
        Date.now(),
      live:
        Date.parse(event?.commence_time || "") <=
        Date.now(),
      completed: false,
      finalized: false,
      display: null
    },
    matchup: {
      away: {
        id: null,
        name: event?.away_team || null
      },
      home: {
        id: null,
        name: event?.home_team || null
      }
    },
    props
  };
}

async function fetchTheOddsApiProps({
  apiKey,
  league,
  marketMap,
  sport,
  books = [],
  startsAfter = null,
  startsBefore = null,
  freshMs = DEFAULT_PROP_FRESH_MS,
  staleMs = DEFAULT_STALE_MS
}) {
  if (!apiKey) {
    const error = new Error("THE_ODDS_API_KEY missing");
    error.status = 503;
    throw error;
  }

  const sportKey = SPORT_KEYS[String(league).toUpperCase()];
  if (!sportKey) {
    const error = new Error(`Unsupported The Odds API league: ${league}`);
    error.status = 400;
    throw error;
  }

  const eventsResult = await fetchEvents({
    apiKey,
    sportKey,
    startsAfter,
    startsBefore
  });

  const eventCap = propEventCap();
  const events = (Array.isArray(eventsResult.payload)
    ? eventsResult.payload
    : [])
    .filter((event) => {
      const startsMs =
        Date.parse(event?.commence_time || "");
      const afterMs = Date.parse(startsAfter || "");
      const beforeMs = Date.parse(startsBefore || "");
      if (
        Number.isFinite(afterMs) &&
        Number.isFinite(startsMs) &&
        startsMs < afterMs
      ) {
        return false;
      }
      if (
        Number.isFinite(beforeMs) &&
        Number.isFinite(startsMs) &&
        startsMs > beforeMs
      ) {
        return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        Date.parse(a?.commence_time || "") -
        Date.parse(b?.commence_time || "")
    )
    .slice(0, eventCap);

  const providerBooks = requestedProviderBooks(books);
  const marketKeys = Object.keys(marketMap);
  const normalizedEvents = [];
  const usageRows = [];

  for (const event of events) {
    const url = new URL(
      `${THE_ODDS_API_BASE}/sports/${sportKey}/events/${event.id}/odds`
    );
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set(
      "markets",
      marketKeys.join(",")
    );
    url.searchParams.set("oddsFormat", "american");
    url.searchParams.set("dateFormat", "iso");
    if (providerBooks.length) {
      url.searchParams.set(
        "bookmakers",
        providerBooks.join(",")
      );
    } else {
      url.searchParams.set("regions", "us");
    }

    const result = await requestJson({
      url,
      freshMs,
      staleMs,
      paid: true
    });
    usageRows.push(result.usage || null);
    const normalized = normalizePropEvent(
      result.payload,
      books,
      {
        league,
        marketMap,
        sport
      }
    );
    if (normalized.props.length) {
      normalizedEvents.push(normalized);
    }
  }

  return {
    source: "The Odds API",
    league,
    events: normalizedEvents,
    fetchedAt: new Date().toISOString(),
    eventCap,
    usage:
      usageRows.filter(Boolean).at(-1) ||
      { ...state.usage },
    cache: {
      status: "MIXED",
      layer: "local/upstream",
      servedStale: false
    }
  };
}

export async function fetchTheOddsApiMlbProps(options) {
  return fetchTheOddsApiProps({
    ...options,
    league: "MLB",
    marketMap: MLB_PROP_MARKETS,
    sport: "BASEBALL"
  });
}

export async function fetchTheOddsApiNflProps(options) {
  return fetchTheOddsApiProps({
    ...options,
    league: "NFL",
    marketMap: NFL_PROP_MARKETS,
    sport: "FOOTBALL"
  });
}

export async function fetchTheOddsApiNbaProps(options) {
  return fetchTheOddsApiProps({
    ...options,
    league: "NBA",
    marketMap: NBA_PROP_MARKETS,
    sport: "BASKETBALL"
  });
}

export function getTheOddsApiUsageSnapshot() {
  return {
    ...state.usage,
    reserve: quotaReserve(),
    maxPropEvents: propEventCap()
  };
}
