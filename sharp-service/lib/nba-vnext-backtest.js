import {projectNbaGames} from "./nba-vnext-baseline.js";

// Replay requires an archived observation of this exact final result. A start
// time, an estimated game duration, or a final score fetched today cannot prove
// that the score was available for an earlier forecast.
function time(value) {
  const m=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
  if(!m)return NaN;
  const [,year,month,day,hour,minute,second]=m;
  const y=Number(year),mo=Number(month),d=Number(day),leap=y%4===0&&(y%100!==0||y%400===0);
  if(y<1||mo<1||mo>12||d<1||d>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo-1]||Number(hour)>23||Number(minute)>59||Number(second)>59)return NaN;
  return Date.parse(value);
}
const named=value=>typeof value==='string'&&value.trim().length>0;
const score=value=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=250;
function finalObservedAt(game,now) {
  const observation=game.finalObservation;
  if(!observation||observation.contract!=='nba-final-observation-v1')return null;
  const at=time(observation.observedAt),start=time(game.startsAt);
  if(!Number.isFinite(at)||at<=start||at>now||observation.completed!==true||
    time(observation.startsAt)!==start||
    ['eventId','home','away','homeScore','awayScore'].some(key=>observation[key]!==game[key])||
    !/^[a-f0-9]{64}$/.test(observation.sourceSha256??''))return null;
  try{const url=new URL(observation.sourceUrl);if(url.protocol!=='https:'||url.username||url.password)return null;}
  catch{return null;}
  return at;
}

// One archived final observation per physical game is required. Conflicting
// revisions must be resolved against their original snapshots before replay;
// choosing the first input row could silently select a later corrected score.
export function backtestNbaBaseline({games, minimumEvaluated = 30} = {}) {
  if(!Array.isArray(games))return {status:"INVALID_INPUT",productionEligible:false,productionWeight:0,automaticBuyEnabled:false};
  const now=Date.now(),seen=new Set(),physical=new Set(),unique=[],availability=new Map(),issues=[];
  for(const g of games){
    if(!g?.completed)continue;
    if(g.completed!==true||!named(g.eventId)||!named(g.home)||!named(g.away)||g.home===g.away||
      !Number.isFinite(time(g.startsAt))||!score(g.homeScore)||!score(g.awayScore)||g.homeScore===g.awayScore){
      issues.push({eventId:g.eventId??null,reason:'INVALID_FINAL_GAME'});continue;
    }
    const key=JSON.stringify([time(g.startsAt),...[g.home,g.away].sort()]);
    if(seen.has(g.eventId)||physical.has(key)){
      issues.push({eventId:g.eventId,reason:'DUPLICATE_OR_CONFLICTING_FINAL_GAME'});continue;
    }
    seen.add(g.eventId);physical.add(key);unique.push(g);
    const observed=finalObservedAt(g,now);
    if(observed===null)issues.push({eventId:g.eventId,reason:g.finalObservation?'FINAL_OBSERVATION_INVALID':'FINAL_OBSERVATION_MISSING'});
    else availability.set(g.eventId,observed);
  }
  unique.sort((a,b)=>time(a.startsAt)-time(b.startsAt));
  const reasonCounts={};for(const issue of issues)reasonCounts[issue.reason]=(reasonCounts[issue.reason]??0)+1;
  const blocked=issues.length>0;
  let sumBrier=0,sumLog=0,n=0;const bins=Array.from({length:5},()=>({n:0,predictionSum:0,outcomeSum:0}));
  const records=[];
  // Missing evidence blocks the cohort instead of silently dropping games and
  // claiming complete historical coverage for an altered training population.
  for(const game of blocked?[]:unique) {
    const cutoff=game.startsAt;
    // Forecast snapshot is strictly before tipoff. Projector excludes
    // games whose scheduled start is <= asOf, so use T-1 millisecond.
    const forecastAt=new Date(Date.parse(cutoff)-1).toISOString();
    const prior=unique.filter(x=>availability.get(x.eventId)<Date.parse(forecastAt));
    if(prior.length<24)continue;
    const snap=projectNbaGames({historicalGames:prior,upcomingGames:[{
      eventId:game.eventId,startsAt:game.startsAt,home:game.home,away:game.away,completed:false}],
      asOf:forecastAt,historyComplete:true});
    const p=snap.rows?.[0]?.homeWinProbability;
    if(typeof p!=="number")continue;
    const actual=game.homeScore>game.awayScore?1:0;
    const bounded=Math.max(0.001,Math.min(0.999,p));
    const brier=(p-actual)**2,logloss=-(actual*Math.log(bounded)+(1-actual)*Math.log(1-bounded));
    const i=Math.min(4,Math.floor(p*5));
    bins[i].n+=1;bins[i].predictionSum+=p;bins[i].outcomeSum+=actual;
    sumBrier+=brier;sumLog+=logloss;n++;
    records.push({eventId:game.eventId,startsAt:game.startsAt,
      home:game.home,away:game.away,forecastAt,
      predictedHomeWinProbability:p,actualHomeWin:actual,
      brier,logloss,eligibleHistoryGames:prior.length,historyEventIds:prior.map(x=>x.eventId),
      latestHistoricalFinalObservedAt:new Date(Math.max(...prior.map(x=>availability.get(x.eventId)))).toISOString(),
      source:"archived_final_observations"});
  }
  const reliability=bins.map((b,i)=>({range:[i/5,(i+1)/5],
    sampleSize:b.n,averageProbability:b.n?b.predictionSum/b.n:null,
    actualRate:b.n?b.outcomeSum/b.n:null}));
  const ece=n?bins.reduce((s,b)=>s+(b.n/n)*(b.n?Math.abs(b.predictionSum/b.n-b.outcomeSum/b.n):0),0):null;
  return {
    version:"nba-vnext-walk-forward-v2",status:blocked?"BLOCKED_TEMPORAL_EVIDENCE":n>=minimumEvaluated?"RESEARCH_AUDIT":"INSUFFICIENT_HOLDOUT",
    reasons:Object.keys(reasonCounts),
    temporalEvidence:{contract:'nba-final-observation-v1',status:blocked?'BLOCKED':unique.length?'COMPLETE_OBSERVATION_METADATA':'NO_FINAL_GAMES',
      policy:'ARCHIVED_FINAL_OBSERVATION_STRICTLY_BEFORE_FORECAST',provenance:'CALLER_SUPPLIED_ARCHIVE_REFERENCES',
      gamesWithObservation:availability.size,reasonCounts,issues},
    evaluatedGames:n,minimumEvaluated,historyGames:unique.length,
    brier:n?sumBrier/n:null,logLoss:n?sumLog/n:null,ece,
    constantHalfBrier:n?.25:null,
    marketBaselineBrier:null,sharpMatchedQuotes:0,
    payoutROI:null,productionEligible:false,productionWeight:0,automaticBuyEnabled:false,
    reliability,records
  };
}
