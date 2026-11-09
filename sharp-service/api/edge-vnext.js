import { buildEdgeBoard } from "../lib/edge-vnext-board.js";
import { poissonMass, thresholdProbability, priceKalshi, priceAmerican,
  comboProbability, summarizePositions } from "../lib/edge-vnext.js";

const MAX_WAIT_MS = 18000;
function cleanUrl(raw) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed : null;
  } catch { return null; }
}
function respond(res, code, payload) {
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(code).json(payload);
}
async function getNflModel(req) {
  // A request is only allowed after the user explicitly asks to refresh.
  // No scheduled paid provider requests or automatic polling.
  const origin = process.env.EDGE_LAB_VNEXT_NFL_MODEL_URL ||
    (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL + "/api/nflmodel" : "");
  const url = cleanUrl(origin);
  if (!url) throw new Error("NFL model source URL is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),MAX_WAIT_MS);
  try {
    const r = await fetch(url,{signal:controller.signal,headers:{"accept":"application/json"},cache:"no-store"});
    if (!r.ok) throw new Error("NFL model HTTP " + r.status);
    const data = await r.json();
    if (!data || data.error || data.league!=="NFL") throw new Error("NFL model unavailable");
    return data;
  } finally { clearTimeout(timeout); }
}
function finiteInput(value, max=1e6) {
  const x = Number(value);
  return value === undefined || value === null || value === "" || !Number.isFinite(x) || Math.abs(x)>max ? null : x;
}
export default async function handler(req,res) {
  if(req.method!=="GET") {res.setHeader("Allow","GET");return respond(res,405,{error:"GET only"});}
  const mode = String(req.query?.mode || "board");
  if(mode==="alt") {
    const lambda=finiteInput(req.query.mean,200), threshold=finiteInput(req.query.threshold,1000);
    const direction=String(req.query.direction||"at_least");
    if(lambda===null||threshold===null) return respond(res,400,{error:"Valid count mean and threshold required"});
    const pmf=poissonMass(lambda);
    const probability=pmf?thresholdProbability({pmf,threshold,direction}):null;
    if(!probability) return respond(res,400,{error:"Unsupported count distribution or line"});
    const odds=finiteInput(req.query.odds,100000);
    const quote=odds===null?null:priceAmerican({...probability,odds});
    const kalshiPrice=finiteInput(req.query.kalshiPrice,1);
    const fees=finiteInput(req.query.fees,100000);
    const contract=kalshiPrice===null?null:priceKalshi({
      winProbability:probability.winProbability,contractPrice:kalshiPrice,
      fees:fees??0,contracts:1
    });
    return respond(res,200,{mode,modelOrigin:"USER_SUPPLIED_POISSON_SCENARIO",
      calibrated:false,productionEligible:false,decision:"AVOID",distribution:"Poisson count",
      input:{mean:lambda,threshold,direction},probability,americanQuote:quote,kalshiContract:contract,
      warning:"Scenario only. A user-entered mean is not an independently trained model forecast; count Poisson is not appropriate for yardage, rebounds without validation, or winning margins."});
  }
  if(mode==="combo") {
    const raw=String(req.query.probabilities||"");
    if(raw.length>200) return respond(res,400,{error:"Too many probabilities"});
    const tokens=raw.split(",");
    if(!tokens.length||tokens.length>12||tokens.some(x=>!x.trim())) return respond(res,400,{error:"Provide 1-12 probabilities as decimals"});
    const legs=tokens.map((x,i)=>({probability:finiteInput(x,1),outcomeKey:"leg-"+i}));
    const joint=comboProbability({legs,independenceVerified:false});
    return joint?respond(res,200,{mode,decision:"AVOID",joint,
      warning:"Shared teams, players or markets can be correlated. Independence is not assumed."})
      :respond(res,400,{error:"Probabilities must each be between zero and one"});
  }
  if(mode==="ledger") {
    let entries;
    try {entries=JSON.parse(String(req.query.entries||"[]"))} catch {return respond(res,400,{error:"Invalid entries"});}
    if(!Array.isArray(entries)||entries.length>30) return respond(res,400,{error:"Maximum 30 entries"});
    const result=summarizePositions(entries);
    return result?respond(res,200,{mode,...result}):respond(res,400,{error:"Invalid or unsettled positions"});
  }
  if(mode!=="board") return respond(res,400,{error:"Unknown mode"});
  const now=new Date().toISOString();
  if(String(req.query.live||"0")!=="1") {
    return respond(res,200,{...buildEdgeBoard({now}),requestRequired:true,
      message:"Click Refresh NFL to fetch existing model. May consume third-party odds-provider quota."});
  }
  try {
    const nfl=await getNflModel(req);
    return respond(res,200,{...buildEdgeBoard({nflResponse:nfl,now:new Date().toISOString()}),
      source:"existing /api/nflmodel",requestRequired:false});
  } catch(error) {
    return respond(res,200,{...buildEdgeBoard({now:new Date().toISOString()}),
      requestRequired:false,sourceError:error instanceof Error?error.message:"Model source unavailable"});
  }
}
