const DEFAULT_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

const PROP_PATTERNS = [
  "pitching_strikeouts-PLAYER_ID-game-ou-over",
  "pitching_strikeouts-PLAYER_ID-game-ou-under",
  "batting_hits-PLAYER_ID-game-ou-over",
  "batting_hits-PLAYER_ID-game-ou-under",
  "batting_totalBases-PLAYER_ID-game-ou-over",
  "batting_totalBases-PLAYER_ID-game-ou-under"
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

function num(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace("+", ""));
  return Number.isFinite(n) ? n : null;
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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const apiKey = process.env.SPORTS_ODDS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "SPORTS_ODDS_API_KEY missing" });
  }

  const books = csv(req.query.books, DEFAULT_BOOKS);
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

  const upstream = await fetch(
    `https://api.sportsgameodds.com/v2/events?${params.toString()}`,
    {
      headers: {
        "x-api-key": apiKey,
        accept: "application/json"
      },
      cache: "no-store"
    }
  );

  const raw = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { error: raw.slice(0, 800) };
  }

  if (!upstream.ok || payload?.success === false) {
    return res.status(upstream.status || 502).json({
      error:
        payload?.error ||
        payload?.message ||
        "SportsGameOdds prop request failed"
    });
  }

  const events = (payload?.data || [])
    .map(summarizeEvent)
    .filter((e) => e.props.length > 0);

  return res.status(200).json({
    fetchedAt: new Date().toISOString(),
    version: "MLB Props Board v1",
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
    eventCount: events.length,
    propCount: events.reduce((n, e) => n + e.props.length, 0),
    events
  });
}