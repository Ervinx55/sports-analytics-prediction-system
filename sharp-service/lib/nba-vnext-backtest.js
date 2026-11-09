import {projectNbaGames} from "./nba-vnext-baseline.js";

// Walk-forward offline audit: for a game at time T, use only final scores
// whose original kickoff was < T. No odds are inferred, no profitability
// claims are possible without legitimate historical execution quotes.
export function backtestNbaBaseline({games, minimumEvaluated = 30} = {}) {
  if(!Array.isArray(games))return {status:"INVALID_INPUT",productionEligible:false};
  const history=games.filter(g=>g?.completed&&Number.isFinite(Date.parse(g.startsAt))&&
    Number.isFinite(Number(g.homeScore))&&Number.isFinite(Number(g.awayScore)))
    .sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
  const seen=new Set(),unique=[];
  for(const g of history){
    const key=g.eventId || [g.startsAt,g.home,g.away].join("|");
    if(seen.has(key))continue;
    seen.add(key);unique.push(g);
  }
  let sumBrier=0,sumLog=0,n=0;const bins=Array.from({length:5},()=>({n:0,predictionSum:0,outcomeSum:0}));
  const records=[];
  for(const game of unique) {
    const cutoff=game.startsAt;
    const prior=unique.filter(x=>Date.parse(x.startsAt)<Date.parse(cutoff));
    if(prior.length<24)continue;
    const snap=projectNbaGames({historicalGames:prior,upcomingGames:[{...game,completed:false}],
      asOf:cutoff,historyComplete:true});
    const p=snap.rows?.[0]?.homeWinProbability;
    if(typeof p!=="number")continue;
    const actual=game.homeScore>game.awayScore?1:0;
    const bounded=Math.max(0.001,Math.min(0.999,p));
    const brier=(p-actual)**2,logloss=-(actual*Math.log(bounded)+(1-actual)*Math.log(1-bounded));
    const i=Math.min(4,Math.floor(p*5));
    bins[i].n+=1;bins[i].predictionSum+=p;bins[i].outcomeSum+=actual;
    sumBrier+=brier;sumLog+=logloss;n++;
    records.push({eventId:game.eventId,startsAt:game.startsAt,
      home:game.home,away:game.away,forecastAt:cutoff,
      predictedHomeWinProbability:p,actualHomeWin:actual,
      brier,logloss,source:"scoreboard_results_only"});
  }
  const reliability=bins.map((b,i)=>({range:[i/5,(i+1)/5],
    sampleSize:b.n,averageProbability:b.n?b.predictionSum/b.n:null,
    actualRate:b.n?b.outcomeSum/b.n:null}));
  const ece=n?bins.reduce((s,b)=>s+(b.n/n)*(b.n?Math.abs(b.predictionSum/b.n-b.outcomeSum/b.n):0),0):null;
  return {
    version:"nba-vnext-walk-forward-v1",status:n>=minimumEvaluated?"RESEARCH_AUDIT":"INSUFFICIENT_HOLDOUT",
    evaluatedGames:n,minimumEvaluated,historyGames:unique.length,
    brier:n?sumBrier/n:null,logLoss:n?sumLog/n:null,ece,
    constantHalfBrier:n?.25:null,
    marketBaselineBrier:null,sharpMatchedQuotes:0,
    payoutROI:null,productionEligible:false,automaticBuyEnabled:false,
    reliability,records
  };
}
