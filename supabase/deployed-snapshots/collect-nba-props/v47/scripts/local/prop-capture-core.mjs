import {createHash} from 'node:crypto';
import {normalizeResearch} from '../../sharp-service/research-data.js';
const time=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function capturePropFeed(db,body,receivedAt){
 const now=time(receivedAt);if(!Number.isFinite(now))throw Error('Invalid receipt time');
 const rows=normalizeResearch(body,'NBA',now),report={receivedAt,seen:rows.length,eligible:0,inserted:0,rejected:0,pairedCandidateForecasts:0,productionWeight:0};
 const sourceDigest=digest(body);
 const fresh=t=>Number.isFinite(time(t))&&time(t)<=now&&now-time(t)<=600000;
 for(const r of rows){
  if(!['points','rebounds','assists'].includes(r.marketType)||r.identityStatus!=='ROSTER_MATCHED'||!/^\d+$/.test(r.espnPlayerID)||!r.eventID||!r.book||!finite(r.line)||!finite(r.odds)||!fresh(r.generatedAt)||!fresh(r.updatedAt)||!fresh(r.oppositeUpdatedAt)||!finite(r.market)||!(time(r.startsAt)>now)) {report.rejected++;continue;}
  const context=r.context,validContext=context&&fresh(context.cutoff)&&finite(context.baselineProjection)&&context.baselineProjection>=0;
  const blockers=['PROJECTED_MINUTES_UNVERIFIED','INJURY_AVAILABILITY_UNVERIFIED','SETTLEMENT_POLICY_UNVERIFIED','PROBABILITY_DISTRIBUTION_UNVALIDATED'];
  if(!validContext)blockers.push('BASELINE_UNAVAILABLE');
  if(r.marketType!=='assists')blockers.push('TRAINING_HISTORY_CONTRACT_UNAVAILABLE');
  const identity=digest([r.eventID,r.espnPlayerID,r.marketType,r.side,r.line,r.book]);
  report.eligible++;
  report.inserted+=db.insert({identity,sport:'NBA',eventID:r.eventID,playerID:r.espnPlayerID,market:r.marketType,side:r.side,line:r.line,book:r.book,odds:r.odds,marketProbability:r.market,quoteAt:r.updatedAt,oppositeQuoteAt:r.oppositeUpdatedAt,generatedAt:r.generatedAt,receivedAt,startsAt:r.startsAt,source:r.provider,baselineProjection:validContext?context.baselineProjection:null,candidateProjection:null,candidateMode:r.marketType==='assists'?'BASELINE_ONLY':'BLOCKED_INPUT_CONTRACT',context:context??null,sourceDigest,productionWeight:0,productionEligible:false,modelProbability:null,blockers});
 }
 return report;
}
