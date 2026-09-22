const DEFAULT_LEAGUES = ["MLB"];

const CORE_ODD_IDS = [
  "points-away-game-ml-away",
  "points-home-game-ml-home",
  "points-away-game-sp-away",
  "points-home-game-sp-home",
  "points-all-game-ou-over",
  "points-all-game-ou-under",
  "points-away-game-ml3way-away",
  "points-home-game-ml3way-home",
  "points-all-game-ml3way-draw"
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

  const moneyline = {
    away: compactMarket(odds["points-away-game-ml-away"]),
    home: compactMarket(odds["points-home-game-ml-home"])
  };

  const spread = {
    away: compactMarket(odds["points-away-game-sp-away"], "spread"),
    home: compactMarket(odds["points-home-game-sp-home"], "spread")
  };

  const total = {
    over: compactMarket(odds["points-all-game-ou-over"], "overUnder"),
    under: compactMarket(odds["points-all-game-ou-under"], "overUnder")
  };

  const threeWay = {
    away: compactMarket(odds["points-away-game-ml3way-away"]),
    draw: compactMarket(odds["points-all-game-ml3way-draw"]),
    home: compactMarket(odds["points-home-game-ml3way-home"])
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

async function fetchLeague({ league, books, limit, apiKey, live }) {
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

  const response = await fetch(
    `https://api.sportsgameodds.com/v2/events?${params.toString()}`,
    {
      headers: {
        "x-api-key": apiKey,
        accept: "application/json"
      },
      cache: "no-store"
    }
  );

  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { success: false, error: raw.slice(0, 500) };
  }

  if (!response.ok || payload?.success === false) {
    return {
      league,
      ok: false,
      status: response.status,
      error:
        payload?.error ||
        payload?.message ||
        "SportsGameOdds request failed"
    };
  }

  return {
    league,
    ok: true,
    events: (payload?.data || []).map(summarizeEvent),
    nextCursor: payload?.nextCursor ?? null
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

  const leagues = csv(req.query.leagues, DEFAULT_LEAGUES);
  const books = csv(req.query.books, []);
  const limitRaw = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, limitRaw))
    : 100;
  const live = String(req.query.live ?? "");

  const results = await Promise.all(
    leagues.map((league) =>
      fetchLeague({ league, books, limit, apiKey, live })
    )
  );

  const available = results.filter((r) => r.ok);
  const unavailable = results
    .filter((r) => !r.ok)
    .map(({ league, status, error }) => ({ league, status, error }));

  const events = available.flatMap((r) => r.events);

  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");

  return res.status(200).json({
    fetchedAt: new Date().toISOString(),
    source: "SportsGameOdds v2",
    endpoint: "compact-board",
    requestedLeagues: leagues,
    books: books.length ? books : "account-entitled bookmakers",
    unavailableLeagues: unavailable,
    eventCount: events.length,
    events
  });
}
