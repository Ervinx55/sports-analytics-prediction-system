const BASE="https://external-api.kalshi.com/trade-api/v2";
module.exports=async function(req,res){
 res.setHeader("Cache-Control","no-store");
 const series=String(req.query?.series||"").toUpperCase();
 if(!/^[A-Z0-9-]{3,50}$/.test(series))return res.status(400).json({error:"Provide an exact Kalshi series ticker"});
 try{
  const url=BASE+"/markets?"+new URLSearchParams({series_ticker:series,status:"open",limit:"100"});
  const r=await fetch(url,{signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error("Kalshi HTTP "+r.status);
  const data=await r.json();
  const markets=(data.markets||[]).map(m=>({ticker:m.ticker,title:m.title,subtitle:m.yes_sub_title,status:m.status,closeTime:m.close_time,strikeType:m.strike_type,target:m.floor_strike,yesAsk:m.yes_ask_dollars,noAsk:m.no_ask_dollars,yesBid:m.yes_bid_dollars,noBid:m.no_bid_dollars,rules:m.rules_primary})).sort((a,b)=>String(a.closeTime).localeCompare(String(b.closeTime)));
  res.status(200).json({series,asOf:new Date().toISOString(),markets,cursor:data.cursor||null});
 }catch(e){res.status(502).json({error:"Kalshi market discovery failed",detail:e.message});}
};
