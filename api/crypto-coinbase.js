const BASE = "https://api.coinbase.com/api/v3/brokerage/market/products";
const ALLOWED = new Set(["BTC","ETH","SOL","XRP","DOGE","BNB","HYPE","ZEC","NEAR"]);
module.exports = async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  const asset = String(req.query?.asset || "BTC").toUpperCase();
  if (!ALLOWED.has(asset)) return res.status(400).json({error:"Unsupported asset"});
  const product = asset + "-USD";
  const end = Math.floor(Date.now()/1000);
  const start = end - 3600;
  try {
    const url = BASE + "/" + product + "/candles?" + new URLSearchParams({start:String(start),end:String(end),granularity:"ONE_MINUTE",limit:"60"});
    const response = await fetch(url,{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error("Coinbase HTTP "+response.status);
    const payload = await response.json();
    const candles = (payload.candles || []).map(c=>({time:Number(c.start),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close),volume:Number(c.volume)})).filter(c=>Object.values(c).every(Number.isFinite)).sort((a,b)=>a.time-b.time);
    if (!candles.length) return res.status(503).json({error:"No candles returned",asset});
    return res.status(200).json({source:"coinbase",asset,product,asOf:new Date().toISOString(),candles});
  } catch(e) { return res.status(502).json({error:"Coinbase data unavailable",detail:String(e.message)}); }
};
