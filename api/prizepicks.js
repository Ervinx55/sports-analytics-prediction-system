// Read-only PrizePicks diagnostic; isolated from the calibrated DraftKings collector.
// Keep raw stat IDs to avoid silently losing newly introduced provider markets.
const MAX_PAGES = 3;
const ALLOWED_SIDES = new Set(["over", "under"]);
function lineNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function normalizePrizePicks(events) {
  const quotes = [];
  const statCounts = {};
  for (const event of Array.isArray(events) ? events : []) {
    for (const [oddID, odd] of Object.entries(event?.odds ?? {})) {
      const book = odd?.byBookmaker?.prizepicks;
      if (!book || book.available !== true) continue;
      const side = String(odd.sideID ?? "").toLowerCase();
      const stat = String(odd.statID ?? "");
      const line = lineNumber(book.overUnder);
      if (!ALLOWED_SIDES.has(side) || !stat || line === null) continue;
      statCounts[stat] = (statCounts[stat] ?? 0) + 1;
      quotes.push({
        eventID: event.eventID ?? null,
        startsAt: event.startsAt ?? null,
        playerID: odd.playerID ?? null,
        oddID, stat, side, line,
        updatedAt: book.lastUpdatedAt ?? null,
        available: true, source: "SportsGameOdds", book: "prizepicks"
      });
    }
  }
  return {quotes, statCounts};
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({error:"GET only"});
  const token = process.env.SHARP_MONITOR_TOKEN;
  if (!token) return res.status(503).json({error:"SHARP_MONITOR_TOKEN not configured"});
  if (req.headers["x-monitor-token"] !== token) return res.status(401).json({error:"Unauthorized"});
  const key = process.env.SPORTS_ODDS_API_KEY;
  if (!key) return res.status(503).json({error:"SPORTS_ODDS_API_KEY not configured"});
  const pages = [];
  const seen = new Set();
  let cursor = null;
  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const params = new URLSearchParams({
        leagueID:"NBA", bookmakerID:"prizepicks", oddsAvailable:"true",
        type:"match", limit:"100"
      });
      if (cursor) params.set("cursor", cursor);
      const upstream = await fetch("https://api.sportsgameodds.com/v2/events?" + params, {
        headers:{"x-api-key":key,accept:"application/json"},cache:"no-store",
        signal:AbortSignal.timeout(20000)
      });
      if (!upstream.ok) return res.status(502).json({error:"Provider request failed",providerStatus:upstream.status});
      const payload = await upstream.json();
      if (!Array.isArray(payload.data)) return res.status(502).json({error:"Invalid provider data shape"});
      pages.push(...payload.data);
      const next = typeof payload.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null;
      if (!next || seen.has(next)) {cursor = null;break;}
      seen.add(next);cursor = next;
    }
    const {quotes,statCounts} = normalizePrizePicks(pages);
    return res.status(200).json({
      fetchedAt:new Date().toISOString(),book:"prizepicks",source:"SportsGameOdds",
      quoteCount:quotes.length,statCounts,quotes,
      nextCursor:cursor,complete:cursor === null,
      note:"Read-only diagnostic. Does not create BUYs, wagers, or database records."
    });
  } catch {
    return res.status(502).json({error:"PrizePicks provider diagnostic failed"});
  }
}
