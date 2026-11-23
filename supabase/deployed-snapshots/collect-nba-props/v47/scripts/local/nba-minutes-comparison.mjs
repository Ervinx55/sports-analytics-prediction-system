import {createHash} from 'node:crypto';
import {probabilityForecast} from './nba-probability.mjs';
export const comparisonContract='nba-minutes-paired-v1';
export const comparisonHash=artifact=>createHash('sha256').update(JSON.stringify({contract:comparisonContract,artifact})).digest('hex');
const time=x=>typeof x==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(x)?Date.parse(x):NaN;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function minutesPair({base,history,artifact,protocol,reviewedContinuation=false}){
 const p=artifact?.policy,modelHash=comparisonHash(artifact),issued=time(base.issuedAt),start=time(base.startsAt);
 const enrolled=time(protocol?.startsAt)<=issued&&issued<start&&start<time(protocol?.endsAt);
 const continuation=reviewedContinuation&&time(protocol?.endsAt)<=issued&&issued<start;
 if(protocol?.modelHash!==modelHash||protocol.baselineModelHash!==base.modelHash||protocol.productionWeight!==0||protocol.productionEligible!==false||!protocol.id||!(enrolled||continuation))throw Error('MINUTES_PROTOCOL_MISMATCH');
 if(p?.version!=='nba-role-minutes-development-v1'||p.productionWeight!==0||p.productionEligible!==false||p.minimumPriorGames!==5||p.minutesHalfLifeGames!==3||p.projectedMinutesCap!==48||p.condition!=='POSITIVE_MINUTE_PARTICIPATION'||!(time(p.frozenAt)<=issued&&time(p.fitBefore)<=issued)||artifact.selected?.[base.market]!=='minutes_only')throw Error('MINUTES_ARTIFACT_INVALID');
 const seen=new Set();
 for(const g of history){if(seen.has(g.id)||!(time(g.observedAt)<=issued)||!Number.isFinite(time(g.startsAt)))throw Error('MINUTES_HISTORY_INVALID');seen.add(g.id);}
 const games=history.filter(g=>time(g.startsAt)+8*3600000<=start&&new Date(g.startsAt).toISOString().slice(0,10)<new Date(start).toISOString().slice(0,10)).sort((a,b)=>time(a.startsAt)-time(b.startsAt));
 const sample=games.flatMap(g=>{
  const ps=g.players.filter(x=>x.id===base.playerID&&x.teamId===base.context.teamId);
  if(ps.length>1)throw Error('MINUTES_DUPLICATE_PLAYER');
  return ps.filter(x=>x.minutes>0).map(x=>({...x,gameId:g.id}));
 }).slice(-10);
 if(sample.length<5)throw Error('MINUTES_INSUFFICIENT_HISTORY');
 if(sample.some(x=>!finite(x.minutes)||x.minutes>70||!finite(x[base.market])||x[base.market]<0))throw Error('MINUTES_INVALID_STATS');
 const weights=sample.map((_,i)=>2**(-(sample.length-1-i)/3)),sum=a=>a.reduce((s,x)=>s+x,0);
 const minutes=Math.min(48,sum(sample.map((x,i)=>x.minutes*weights[i]))/sum(weights));
 const baselineMean=sum(sample.map(x=>x[base.market]))/sample.length;
 const candidateMean=minutes*sum(sample.map(x=>x[base.market]))/sum(sample.map(x=>x.minutes));
 const probability=(variant,mean)=>probabilityForecast({policy:{version:'nba-baseline-probability-v1',productionWeight:0,productionEligible:false,condition:p.condition,meanModel:'LAST_TEN_SAME_TEAM_BASELINE',frozenAt:p.frozenAt,trainedBefore:p.fitBefore},markets:{[base.market]:artifact.markets[base.market][variant]}},base.market,mean,base.line,base.side,base.issuedAt);
 const baselineProbability=probability('baseline',baselineMean),candidateProbability=probability('minutes_only',candidateMean);
 candidateProbability.version=comparisonContract;candidateProbability.meanModel='EWMA_MINUTES_TIMES_LAST_TEN_RATE';
 return {...base,modelHash,validationProtocol:enrolled?protocol.id:null,reviewedProtocol:protocol.id,forecastScope:enrolled?'PAIRED_MINUTES_COMPARISON':'REVIEWED_MINUTES_CONTINUATION',productionWeight:0,productionEligible:false,
  baselineProjection:baselineMean,candidateProjection:candidateMean,modelProbability:candidateProbability.modelProbability,probability:candidateProbability,
  comparison:{contract:comparisonContract,liveBaselineModelHash:base.modelHash,historyIds:sample.map(x=>x.gameId),sample:sample.length,
   baseline:{mean:baselineMean,minutes:sum(sample.map(x=>x.minutes))/sample.length,probability:baselineProbability},
   candidate:{mean:candidateMean,minutes,probability:candidateProbability}},
  blockers:[...(base.blockers??[]),'PROSPECTIVE_MINUTES_VALIDATION_REQUIRED']};
}

