const BASE = "https://api.elections.kalshi.com/trade-api/v2";
module.exports = async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  const ticker = String(req.query?.ticker || "");
  if (!/^[A-Za-z0-9-]{3,120}$/.test(ticker)) return res.status(400).json({error:"Valid market ticker required"});
  try {
    const response = await fetch(BASE+"/markets/"+encodeURIComponent(ticker),{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error("Kalshi HTTP "+response.status);
    const {market} = await response.json();
    if (!market) throw new Error("Missing market");
    return res.status(200).json({source:"kalshi",asOf:new Date().toISOString(),ticker:market.ticker,status:market.status,closeTime:market.close_time,expectedExpirationTime:market.expected_expiration_time,yesBid:market.yes_bid_dollars,yesAsk:market.yes_ask_dollars,noBid:market.no_bid_dollars,noAsk:market.no_ask_dollars,floorStrike:market.floor_strike,strikeType:market.strike_type,result:market.result,settlementValue:market.settlement_value_dollars,rules:market.rules_primary});
  } catch(e) {return res.status(502).json({error:"Kalshi data unavailable",detail:String(e.message)});}
};
