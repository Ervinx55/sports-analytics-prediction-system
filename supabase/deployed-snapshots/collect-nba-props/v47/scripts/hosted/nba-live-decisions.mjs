import {createHash} from 'node:crypto';
const time=x=>typeof x==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(x)?Date.parse(x):NaN;
const number=x=>typeof x==='number'&&Number.isFinite(x);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fresh=(t,now,age)=>Number.isFinite(time(t))&&time(t)<=now&&now-time(t)<=age;
const implied=o=>o>0?100/(o+100):-o/(-o+100);
const descriptions={
 MODEL_NOT_APPROVED:'No matching reviewed model approval is active.',
 APPROVAL_REVIEW_OR_VALIDITY_UNVERIFIED:'The review evidence or approval dates are not verified.',
 APPROVAL_SCOPE_MISMATCH:'This market or sportsbook is outside the reviewed scope.',
 APPROVAL_POLICY_UNVERIFIED:'The reviewed minutes method or decision thresholds are not verified.',
 MODEL_VARIANT_MISMATCH:'This forecast is not the model variant covered by the approval.',
 FORECAST_IDENTITY_OR_HISTORY_UNVERIFIED:'Player identity or required game history is not verified.',
 FORECAST_NOT_CURRENT_PREGAME:'A fresh pregame forecast is required.',
 EXACT_QUOTE_PAIR_UNVERIFIED:'A unique, available price pair at the same sportsbook and line is required.',
 QUOTE_NOT_CURRENT:'Both prices and the source feed must be current.',
 QUOTE_PROBABILITY_MISMATCH:'The market probability does not match the verified price pair.',
 EXPLICIT_AVAILABILITY_REQUIRED:'An explicit, current official Available report is required; omission or Probable does not qualify.',
 VALIDATED_MINUTES_REQUIRED:'A usable projected-minutes estimate is missing.',
 MODEL_PROBABILITY_INVALID:'The saved model probability is invalid.',
 VALUE_BELOW_APPROVED_THRESHOLDS:'The estimated edge or expected return is below the reviewed thresholds.',
 INVALID_EVALUATION_TIME:'The evaluation time is invalid.'
};
export const explainReadiness=reason=>descriptions[reason]??reason;
export function evaluateNbaLiveDecision({approval:a,forecast:f,quote:q,now}){
 const n=time(now),reasons=[],av=f?.pregame?.availability;
 const block=(ok,reason)=>{if(!ok)reasons.push(reason);};
 block(Number.isFinite(n),'INVALID_EVALUATION_TIME');
 block(a&&a.status==='APPROVED'&&a.modelHash===f.modelHash&&a.protocolId===(f.reviewedProtocol??f.validationProtocol),'MODEL_NOT_APPROVED');
 if(a)block(a&&typeof a.reviewer==='string'&&a.reviewer.trim()&&sha(a.evaluationSha256)&&sha(a.settlementSha256)&&time(a.holdoutEndedAt)<=time(a.reviewedAt)&&time(a.reviewedAt)<=time(a.effectiveAt)&&time(a.effectiveAt)<=n&&n<time(a.expiresAt),'APPROVAL_REVIEW_OR_VALIDITY_UNVERIFIED');
 if(a)block(a?.markets?.includes(f.market)&&a?.books?.includes(f.book)&&['points','rebounds','assists'].includes(f.market)&&['OVER','UNDER'].includes(f.side),'APPROVAL_SCOPE_MISMATCH');
 if(a)block(a?.productionWeight===1&&a?.minutesValidated===true&&a?.availabilityPolicy==='OFFICIAL_AVAILABLE'&&number(a?.minEdge)&&a.minEdge>0&&a.minEdge<1&&number(a?.minEv)&&a.minEv>0&&a.minEv<10,'APPROVAL_POLICY_UNVERIFIED');
 const variant=f.comparison?'MINUTES_ONLY':'BASELINE';
 if(a)block(a?.variant===variant,'MODEL_VARIANT_MISMATCH');
 block(f.context?.sourceContract==='sgo-nba-v1'&&f.eventID?.startsWith('sgo:')&&f.playerID&&f.context.teamId&&f.pregame?.historyReadiness?.baseline?.ready===true,'FORECAST_IDENTITY_OR_HISTORY_UNVERIFIED');
 block(time(f.startsAt)>n&&fresh(f.issuedAt,n,600000)&&time(f.issuedAt)<time(f.startsAt),'FORECAST_NOT_CURRENT_PREGAME');
 block(q&&['eventID','playerID','book','side','line','odds'].every(k=>q[k]===f[k])&&q.market===f.market&&q.available===true&&q.oppositeAvailable===true&&q.oppositeLine===q.line&&number(q.line)&&q.line>=0&&[q.odds,q.oppositeOdds].every(o=>number(o)&&Math.abs(o)>=100),'EXACT_QUOTE_PAIR_UNVERIFIED');
 block(q&&[q.generatedAt,q.updatedAt,q.oppositeUpdatedAt].every(t=>fresh(t,n,600000))&&q.updatedAt===f.quoteAt&&q.oppositeUpdatedAt===f.oppositeQuoteAt,'QUOTE_NOT_CURRENT');
 const market=q&&number(q.odds)&&number(q.oppositeOdds)?implied(q.odds)/(implied(q.odds)+implied(q.oppositeOdds)):null;
 block(number(f.marketProbability)&&number(market)&&Math.abs(f.marketProbability-market)<1e-6,'QUOTE_PROBABILITY_MISMATCH');
 block(av?.status==='Available'&&av.matchedPlayer&&av.matchedTeam&&/^https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_[\w.-]+\.pdf$/.test(av.sourceUrl??'')&&sha(av.sourceSha256)&&fresh(av.publishedAt,n,5400000)&&time(av.publishedAt)<=time(av.retrievedAt)&&time(av.retrievedAt)<=time(f.issuedAt),'EXPLICIT_AVAILABILITY_REQUIRED');
 const minutes=variant==='MINUTES_ONLY'?f.comparison?.candidate?.minutes:f.pregame?.minutes?.projectedMinutes;
 block(number(minutes)&&minutes>0&&minutes<=48,'VALIDATED_MINUTES_REQUIRED');
 const p=f.modelProbability;
 block(number(p)&&p>=0&&p<=1,'MODEL_PROBABILITY_INVALID');
 const edge=number(p)&&number(market)?p-market:null,ev=number(p)&&q&&number(q.odds)?p*(q.odds>0?q.odds/100:100/-q.odds)-(1-p):null;
 if(a&&number(a.minEdge)&&number(a.minEv))block(number(edge)&&number(ev)&&edge>=a.minEdge&&ev>=a.minEv,'VALUE_BELOW_APPROVED_THRESHOLDS');
 const deadlines=[time(f.startsAt),time(f.issuedAt)+600000,time(q?.generatedAt)+600000,time(q?.updatedAt)+600000,time(q?.oppositeUpdatedAt)+600000,time(av?.publishedAt)+5400000,time(a?.expiresAt)].filter(Number.isFinite);
 const validUntil=new Date(Math.min(n+600000,...deadlines)).toISOString();
 const out={contract:'nba-reviewed-live-v1',identity:f.identity,modelHash:f.modelHash,validationProtocol:f.reviewedProtocol??f.validationProtocol,approvalId:a?.id??null,eventID:f.eventID,playerID:f.playerID,market:f.market,book:f.book,side:f.side,line:f.line,odds:f.odds,oppositeOdds:q?.oppositeOdds??null,startsAt:f.startsAt,modelProbability:p,marketProbability:market,edge,ev,status:reasons.length?'PASS':'PLAY',productionEligible:!reasons.length,productionWeight:reasons.length?0:1,issuedAt:now,forecastAt:f.issuedAt,quoteAt:q?.updatedAt??null,oppositeQuoteAt:q?.oppositeUpdatedAt??null,validUntil,reasons,reason:reasons.length?reasons.map(explainReadiness).join(' '):'Reviewed model, current paired prices and explicit availability passed all checks.'};
 out.evidence={availability:av??null,projectedMinutes:minutes??null,quoteGeneratedAt:q?.generatedAt??null,evaluationSha256:a?.evaluationSha256??null,settlementSha256:a?.settlementSha256??null};
 out.decisionId=digest(out);return out;
}
export function decisionQuote(body,f){
 const events=(body?.events??[]).filter(e=>e.eventID===f.eventID);if(events.length!==1)return null;
 const props=events[0].players?.map(p=>p.prop).filter(p=>p?.playerID===f.playerID&&p.statID===f.market)??[];
 const side=f.side.toLowerCase(),other=side==='over'?'under':'over';
 const candidates=props.filter(p=>p[side]?.books?.[f.book]?.line===f.line);if(candidates.length!==1)return null;
 const a=candidates[0][side].books[f.book],b=candidates[0][other]?.books?.[f.book];
 return {eventID:f.eventID,playerID:f.playerID,market:f.market,book:f.book,side:f.side,line:a.line,odds:a.odds,oppositeLine:b?.line,oppositeOdds:b?.odds,available:a.available!==false,oppositeAvailable:!!b&&b.available!==false,updatedAt:a.updatedAt,oppositeUpdatedAt:b?.updatedAt,generatedAt:body.generatedAt};
}
export async function publishNbaLiveDecisions({rpc,forecasts,body,clock}){
 try{
  const generation=await rpc('begin_nba_live_refresh_v1',{});
  if(typeof generation!=='string')throw Error('REFRESH_INVALID');
  const approvals=await rpc('load_nba_model_approvals_v1',{});if(!Array.isArray(approvals))throw Error('APPROVAL_RESPONSE_INVALID');
  // Never silently choose between overlapping approvals.
  const decisions=forecasts.map(f=>{const matches=approvals.filter(a=>a.modelHash===f.modelHash&&a.protocolId===(f.reviewedProtocol??f.validationProtocol)&&a.markets?.includes(f.market)&&a.books?.includes(f.book));return evaluateNbaLiveDecision({approval:matches.length===1?matches[0]:null,forecast:f,quote:decisionQuote(body,f),now:clock()});});
  let inserted=0;for(let i=0;i<decisions.length;i+=500){const r=await rpc('publish_nba_live_decisions_v1',{p_generation:generation,p_decisions:decisions.slice(i,i+500)});inserted+=r.inserted;}
  return {ok:true,evaluated:decisions.length,inserted,plays:decisions.filter(d=>d.status==='PLAY').length,activeApprovals:approvals.length};
 }catch{return {ok:false,reason:'LIVE_DECISION_PUBLICATION_UNAVAILABLE'};}
}

