const DAY=86400000;
export const MODEL_FAMILY='cfb-elo-winner-v1';
export function availableAfter(g){
 // Historical scores lack archived finalization times. Hold until the next UTC
 // midnight after a 12-hour completion buffer, including late-night kickoffs.
 const start=Date.parse(g.startsAt);return Math.floor((start+12*3600000)/DAY)*DAY+DAY;
}
const probability=(h,a,adv)=>1/(1+10**((a-h-adv)/400));
const validResult=g=>g.completed===true&&g.cancelled!==true&&g.fbsVerified===true&&typeof g.neutralSite==='boolean'&&g.homeID&&g.awayID&&g.homeID!==g.awayID&&Number.isInteger(g.homeScore)&&Number.isInteger(g.awayScore)&&g.homeScore>=0&&g.awayScore>=0&&g.homeScore!==g.awayScore&&Number.isFinite(Date.parse(g.startsAt));
export function forecastGames(history,targets,config,asOf=null){
 if(![16,24,32].includes(config.k)||![0,35,65].includes(config.homeAdvantage)||![0.5,0.75].includes(config.carry))throw Error('UNAPPROVED_PARAMETER_GRID');
 const seen=new Set();for(const g of history){if(seen.has(g.id))throw Error('DUPLICATE_HISTORY_EVENT');seen.add(g.id);}
 const pending=history.filter(validResult).sort((a,b)=>availableAfter(a)-availableAfter(b)||a.id.localeCompare(b.id));
 const teams=new Map();let index=0,season=null;const forecasts=[],excluded=[];
 const team=id=>{if(!teams.has(id))teams.set(id,{rating:1500,results:[]});return teams.get(id);};
 const advanceSeason=next=>{if(season!==null&&next>season)for(const t of teams.values())t.rating=1500+(t.rating-1500)*config.carry**(next-season);season=Math.max(season??next,next);};
 for(const g of [...targets].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.id.localeCompare(b.id))){
  const cutoff=Math.min(Date.parse(g.startsAt),asOf===null?Infinity:Date.parse(asOf));
  if(!Number.isFinite(cutoff))throw Error('INVALID_FORECAST_CUTOFF');
  while(index<pending.length&&availableAfter(pending[index])<cutoff){
   const past=pending[index++];advanceSeason(past.season);const h=team(past.homeID),a=team(past.awayID);
   const delta=config.k*((past.homeScore>past.awayScore?1:0)-probability(h.rating,a.rating,past.neutralSite?0:config.homeAdvantage));
   h.rating+=delta;a.rating-=delta;h.results.push(past);a.results.push(past);
  }
  advanceSeason(g.season);
  const h=team(g.homeID),a=team(g.awayID),since=new Date(cutoff);since.setUTCMonth(since.getUTCMonth()-18);
  const recent=t=>t.results.filter(r=>Date.parse(r.startsAt)>=since.getTime());const homeHistory=recent(h),awayHistory=recent(a),reasons=[];
  if(!g.fbsVerified)reasons.push('FBS_MEMBERSHIP_UNVERIFIED');
  if(typeof g.neutralSite!=='boolean')reasons.push('VENUE_UNVERIFIED');
  if(g.cancelled)reasons.push('EVENT_CANCELLED_OR_POSTPONED');
  if(!g.homeID||!g.awayID||g.homeID===g.awayID)reasons.push('TEAM_IDENTITY_UNVERIFIED');
  if(homeHistory.length<8||awayHistory.length<8)reasons.push('INSUFFICIENT_TEAM_HISTORY');
  if(reasons.length){excluded.push({eventID:g.id,reasons,homeCount:homeHistory.length,awayCount:awayHistory.length});continue;}
  const homeProbability=probability(h.rating,a.rating,g.neutralSite?0:config.homeAdvantage);
  const latest=[...homeHistory,...awayHistory].sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt))[0];
  forecasts.push({eventID:g.sgoID||g.id,espnEventID:g.id,homeID:g.sgoHomeID||g.homeID,awayID:g.sgoAwayID||g.awayID,homeName:g.homeName,awayName:g.awayName,startsAt:g.startsAt,period:'game',marketType:'moneyline',homeProbability,awayProbability:1-homeProbability,homeRating:h.rating,awayRating:a.rating,homeAdvantage:g.neutralSite?0:config.homeAdvantage,neutralSite:g.neutralSite,homeCount:homeHistory.length,awayCount:awayHistory.length,inputCutoff:new Date(cutoff).toISOString(),latestResultAt:latest?.startsAt??null,productionEligible:false,status:'RESEARCH',family:MODEL_FAMILY});
 }
 return {forecasts,excluded};
}
export function prospectiveEligible(game,capturedAt){const delta=Date.parse(game.startsAt)-Date.parse(capturedAt);return Number.isFinite(delta)&&delta>=30*60000&&delta<=24*3600000;}
export function scoreForecasts(rows){
 const valid=rows.filter(r=>Number.isFinite(r.probability)&&r.probability>0&&r.probability<1&&[0,1].includes(r.outcome));
 const n=valid.length,bins=Array.from({length:10},(_,i)=>({from:i/10,to:(i+1)/10,n:0,probabilitySum:0,wins:0}));
 let brier=0,loss=0,correct=0;for(const r of valid){brier+=(r.probability-r.outcome)**2;loss-=r.outcome*Math.log(r.probability)+(1-r.outcome)*Math.log(1-r.probability);correct+=(r.probability>=0.5?1:0)===r.outcome?1:0;const b=bins[Math.min(9,Math.floor(r.probability*10))];b.n++;b.probabilitySum+=r.probability;b.wins+=r.outcome;}
 return {n,brier:n?brier/n:null,logLoss:n?loss/n:null,accuracy:n?correct/n:null,bins:bins.map(b=>({from:b.from,to:b.to,n:b.n,mean:b.n?b.probabilitySum/b.n:null,observed:b.n?b.wins/b.n:null}))};
}
