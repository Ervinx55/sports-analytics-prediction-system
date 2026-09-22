const DEFAULT_BOOKS = [
  "pinnacle",
  "circa",
  "bookmakereu",
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "kalshi"
];

const DEFAULT_LEAGUES = ["MLB", "NFL", "NBA", "WNBA", "NHL", "NCAAF", "NCAAB"];

function csv(value, fallback) {
  if (!value) return fallback;
  const text = Array.isArray(value) ? value[0] : value;
  return String(text)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 40);
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
  const books = csv(req.query.books, DEFAULT_BOOKS);
  const includeAltLines = String(req.query.alts || "0") === "1";
  const limitRaw = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 100;

  const params = new URLSearchParams({
    leagueID: leagues.join(","),
    bookmakerID: books.join(","),
    oddsAvailable: "true",
    includeOpenCloseOdds: "true",
    includeAltLines: includeAltLines ? "true" : "false",
    type: "match",
    limit: String(limit)
  });

  const upstream = await fetch(`https://api.sportsgameodds.com/v2/events?${params}`, {
    headers: {
      "x-api-key": apiKey,
      "accept": "application/json"
    },
    cache: "no-store"
  });

  const text = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { error: "Upstream returned non-JSON", body: text.slice(0, 1000) };
  }

  if (!upstream.ok) {
    return res.status(upstream.status).json({
      error: "SportsGameOdds request failed",
      upstream: payload
    });
  }

  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
  return res.status(200).json({
    fetchedAt: new Date().toISOString(),
    leagues,
    books,
    includeAltLines,
    source: "SportsGameOdds v2",
    data: payload.data ?? [],
    nextCursor: payload.nextCursor ?? null
  });
}
