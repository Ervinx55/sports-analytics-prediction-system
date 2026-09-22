const DEFAULT_LEAGUES = ["MLB", "NFL", "NBA", "NHL", "NCAAF", "NCAAB", "MLS"];

function csv(value, fallback = []) {
  if (!value) return fallback;
  const text = Array.isArray(value) ? value[0] : value;
  return String(text)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 40);
}

async function fetchLeague({ league, books, includeAltLines, limit, apiKey }) {
  const params = new URLSearchParams({
    leagueID: league,
    oddsAvailable: "true",
    includeOpenCloseOdds: "true",
    includeAltLines: includeAltLines ? "true" : "false",
    type: "match",
    limit: String(limit)
  });

  // On the free tier, omit bookmakerID by default so SportsGameOdds
  // automatically returns only the books the account is entitled to use.
  if (books.length) {
    params.set("bookmakerID", books.join(","));
  }

  const upstream = await fetch(`https://api.sportsgameodds.com/v2/events?${params}`, {
    headers: {
      "x-api-key": apiKey,
      "accept": "application/json"
    },
    cache: "no-store"
  });

  const raw = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { error: "Upstream returned non-JSON", body: raw.slice(0, 1000) };
  }

  if (!upstream.ok || payload?.success === false) {
    return {
      league,
      ok: false,
      status: upstream.status,
      error: payload?.error || payload?.message || "SportsGameOdds request failed"
    };
  }

  return {
    league,
    ok: true,
    data: payload?.data ?? [],
    nextCursor: payload?.nextCursor ?? null
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

  const leagues = csv(req.query.leagues, DEFAULT_LEAGUES);
  const books = csv(req.query.books, []);
  const includeAltLines = String(req.query.alts || "0") === "1";
  const limitRaw = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 100;

  const results = await Promise.all(
    leagues.map((league) =>
      fetchLeague({ league, books, includeAltLines, limit, apiKey })
    )
  );

  const availableLeagues = results.filter((r) => r.ok);
  const unavailableLeagues = results
    .filter((r) => !r.ok)
    .map(({ league, status, error }) => ({ league, status, error }));

  const data = availableLeagues.flatMap((r) =>
    (r.data || []).map((event) => ({ ...event, _requestedLeague: r.league }))
  );

  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");

  if (availableLeagues.length === 0) {
    return res.status(502).json({
      error: "No requested leagues were available from SportsGameOdds",
      fetchedAt: new Date().toISOString(),
      leagues,
      books: books.length ? books : "account-entitled bookmakers",
      unavailableLeagues
    });
  }

  return res.status(200).json({
    fetchedAt: new Date().toISOString(),
    source: "SportsGameOdds v2",
    requestedLeagues: leagues,
    availableLeagues: availableLeagues.map((r) => r.league),
    unavailableLeagues,
    books: books.length ? books : "account-entitled bookmakers",
    includeAltLines,
    eventCount: data.length,
    data
  });
}
