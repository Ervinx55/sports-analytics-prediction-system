import {attachNbaMarketEvidence} from './nba-market-evidence.js';
// Independent, research-only NBA game winner baseline.
// No sportsbook odds are an input. No injuries, rotations or pace adjustment
// are inferred. Data gaps make the forecast unavailable, not a BUY.
export const NBA_BASELINE_VERSION="nba-independent-margin-ridge-v0-unvalidated";

function finite(x) {const n=Number(x);return x!==null&&x!==undefined&&x!==""&&Number.isFinite(n)?n:null;}
function abbr(c) {return String(c?.team?.abbreviation||"").trim().toUpperCase();}
export function parseEspnScoreboard(payload) {
 if(!Array.isArray(payload?.events))return [];
 const results=[];
 for(const e of payload.events){
  const game=e?.competitions?.[0],team=game?.competitors||[];
  const home=team.find(c=>c.homeAway==="home"),away=team.find(c=>c.homeAway==="away");
  const date=e?.date || game?.date;
  if(!home||!away||!abbr(home)||!abbr(away)||!Number.isFinite(Date.parse(date)))continue;
  if(abbr(home)===abbr(away))continue;
  const finished=e?.status?.type?.completed===true || e?.status?.type?.state==="post" && e?.status?.type?.completed===true;
  const homeScore=finite(home.score),awayScore=finite(away.score);
  const validFinal=finished&&homeScore!==null&&awayScore!==null;
  results.push({
   eventId:String(e.id||""),startsAt:new Date(date).toISOString(),
   home:abbr(home),away:abbr(away),
   homeScore:validFinal?homeScore:null,awayScore:validFinal?awayScore:null,
   completed:validFinal
  });
 }
 return results;
}
function clamp(x,a,b){return Math.min(b,Math.max(a,x));}
function sigmoid(x){return 1/(1+Math.exp(-x));}

// Iteratively estimate schedule-adjusted per-team margin with ridge shrinkage.
// This is NOT calibrated and must be validated against historical closing odds.
export function fitNbaRatings({games,asOf,minGames=4,homeCourtPoints=2}) {
 const cutoff=Date.parse(asOf);
 if(!Number.isFinite(cutoff)||!Array.isArray(games))return null;
 const seen=new Set(),matches=[];
 for(const g of games){
  const start=Date.parse(g?.startsAt),home=String(g?.home||""),away=String(g?.away||"");
  if(!g?.completed||!Number.isFinite(start)||start>=cutoff||!home||!away||home===away)continue;
  const a=finite(g.homeScore),b=finite(g.awayScore);
  if(a===null||b===null||a<0||b<0||a>250||b>250)continue;
  const key=g.eventId||[start,home,away].join("|");
  if(seen.has(key))continue;seen.add(key);
  matches.push({home,away,margin:a-b});
 }
 const teams=new Set(matches.flatMap(g=>[g.home,g.away]));
 const counts=new Map([...teams].map(t=>[t,0]));
 const rating=new Map([...teams].map(t=>[t,0]));
 for(const g of matches){counts.set(g.home,counts.get(g.home)+1);counts.set(g.away,counts.get(g.away)+1);}
 for(let iter=0;iter<18;iter++){
  const sum=new Map([...teams].map(t=>[t,0]));
  for(const g of matches){
   sum.set(g.home,sum.get(g.home)+clamp(g.margin-homeCourtPoints+rating.get(g.away),-45,45));
   sum.set(g.away,sum.get(g.away)+clamp(-g.margin+homeCourtPoints+rating.get(g.home),-45,45));
  }
  const next=new Map([...teams].map(t=>{
   const n=counts.get(t);
   return [t,clamp(sum.get(t)/(n+7),-18,18)];
  }));
  const globalMean=[...next.values()].reduce((a,b)=>a+b,0)/Math.max(1,next.size);
  for(const t of teams)rating.set(t,next.get(t)-globalMean);
 }
 return {ratings:Object.fromEntries(rating),counts:Object.fromEntries(counts),
  eligibleGames:matches.length,teamCount:teams.size,minGames,
  homeCourtPoints,version:NBA_BASELINE_VERSION};
}
export function projectNbaGames({historicalGames,upcomingGames,asOf,historyComplete=false,marketBoard=null}) {
 const fit=fitNbaRatings({games:historicalGames,asOf});
 if(!fit)return {status:"UNAVAILABLE",reason:"Invalid history"};
 const timestamp=Date.parse(asOf);
 const rows=[];
 for(const g of upcomingGames||[]){
  const start=Date.parse(g?.startsAt);
  if(!Number.isFinite(start)||start<=timestamp||g.completed)continue;
  const homeGames=fit.counts[g.home]||0,awayGames=fit.counts[g.away]||0;
  const eligible=historyComplete&&homeGames>=fit.minGames&&awayGames>=fit.minGames;
  const mean=eligible?fit.homeCourtPoints+fit.ratings[g.home]-fit.ratings[g.away]:null;
  // Logistic approximation to normal game-margin noise, deliberately
  // uncalibrated. Recalibrate or replace after multi-season holdout tests.
  const p=eligible?clamp(sigmoid(mean/7.45),.02,.98):null;
  rows.push({
   eventId:g.eventId,startsAt:g.startsAt,away:g.away,home:g.home,
   gamesSampled:{away:awayGames,home:homeGames},
   projectedHomeMargin:mean,homeWinProbability:p,
   awayWinProbability:p===null?null:1-p,
   modelOrigin:"INDEPENDENT_UNCALIBRATED_NBA_MARGIN_BASELINE",
   calibrationState:"NOT_VALIDATED",decision:"AVOID",
   reasons:eligible?["NO_INJURY_ROTATION_ADJUSTMENT","UNCALIBRATED","BOOK_QUOTES_NOT_REQUESTED"]:
     ["INSUFFICIENT_OR_INCOMPLETE_HISTORICAL_GAMES"]
  });
 }
 const report={status:historyComplete?"RESEARCH_SHADOW":"SOURCE_INCOMPLETE",
   version:NBA_BASELINE_VERSION,generatedAt:asOf,
   eligibleHistoryGames:fit.eligibleGames,historyComplete,
   rows,productionEligible:false,automaticBuyEnabled:false};
 return marketBoard===null?report:attachNbaMarketEvidence(report,marketBoard);
}
