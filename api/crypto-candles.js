// Public Coinbase candles for TradingView-style charting; no trading credentials.
const ALLOWED = new Set(["BTC","ETH","SOL","XRP","DOGE","BNB","HYPE","ZEC","NEAR"]);
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=15");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const asset = String(req.query.asset || "ETH").toUpperCase();
  const interval = String(req.query.interval || "1m");
  if (!ALLOWED.has(asset) || !["1m","5m"].includes(interval)) return res.status(400).json({ error: "Unsupported asset or interval" });
  const granularity = interval === "1m" ? "ONE_MINUTE" : "FIVE_MINUTE";
  const seconds = interval === "1m" ? 60 : 300;
  const end = Math.floor(Date.now() / 1000);
  const start = end - seconds * 120;
  const product = asset + "-USD";
  const url = new URL("https://api.coinbase.com/api/v3/brokerage/market/products/" + product + "/candles");
  url.search = new URLSearchParams({ start: String(start), end: String(end), granularity, limit: "120" }).toString();
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return res.status(502).json({ error: "Coinbase market data unavailable", upstreamStatus: response.status });
    const json = await response.json();
    if (!Array.isArray(json.candles)) return res.status(502).json({ error: "Invalid Coinbase candle response" });
    const candles = json.candles.map(c => ({ time: Number(c.start), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume) })).filter(c => Object.values(c).every(Number.isFinite)).sort((a,b) => a.time-b.time);
    return res.status(200).json({ source: "coinbase", product, interval, fetchedAt: new Date().toISOString(), candles });
  } catch (_) { return res.status(502).json({ error: "Coinbase request failed" }); }
};
