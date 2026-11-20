// Read-only, authenticated PrizePicks diagnostic endpoint.
// Kept separate from the calibrated DraftKings NBA collector.
const ALLOWED_STATS = new Set([
  "points", "rebounds", "assists", "points+rebounds+assists",
  "threePointersMade", "three_pointers_made", "three-pointers-made"
]);
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({error:"GET only"});
  const token = process.env.SHARP_MONITOR_TOKEN;
  if (!token) return res.status(503).json({error:"SHARP_MONITOR_TOKEN must be configured"});
  if (req.headers["x-monitor-token"] !== token) return res.status(401).json({error:"Unauthorized"});
  const key = process.env.SPORTS_ODDS_API_KEY;
  if (!key) return res.status(503).json({error:"SPORTS_ODDS_API_KEY is not configured"});
  const params = new URLSearchParams({
    leagueID:"NBA", bookmakerID:"prizepicks", oddsAvailable:"true",
    type:"match", limit:"100"
  });
  try {
    const upstream = await fetch("https://api.sportsgameodds.com/v2/events?" + params, {
      headers:{"x-api-key":key,accept:"application/json"},cache:"no-store",
      signal:AbortSignal.timeout(20000)
    });
    if (!upstream.ok) return res.status(502).json({error:"Provider request failed",providerStatus:upstream.status});
    const payload = await upstream.json();
    const quotes = [];
    for (const event of payload.data ?? []) {
      for (const [oddID, odd] of Object.entries(event.odds ?? {})) {
        const quote = odd?.byBookmaker?.prizepicks;
        if (!quote || quote.available !== true) continue;
        const stat = String(odd.statID ?? "");
        if (!ALLOWED_STATS.has(stat)) continue;
        const line = numberOrNull(quote.overUnder);
        if (line === null) continue;
        quotes.push({
          eventID:event.eventID ?? null,startsAt:event.startsAt ?? null,
          playerID:odd.playerID ?? null, oddID,
          stat,side:odd.sideID ?? null,line,
          available:true,updatedAt:quote.lastUpdatedAt ?? null,
          source:"SportsGameOdds",book:"prizepicks"
        });
      }
    }
    return res.status(200).json({
      fetchedAt:new Date().toISOString(),source:"SportsGameOdds",
      book:"prizepicks",quotes,quoteCount:quotes.length,
      nextCursor:payload.nextCursor ?? null,
      note:"Diagnostic only. No model decisions, slips, or database writes."
    });
  } catch {
    return res.status(502).json({error:"PrizePicks diagnostic request failed"});
  }
}
