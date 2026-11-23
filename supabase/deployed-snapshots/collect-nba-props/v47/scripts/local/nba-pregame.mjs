import {matchOfficialInjury} from './official-injury-match.mjs';
const at=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
export function projectMinutes(history,q){
 const unknown=reason=>({status:'UNAVAILABLE',reason,projectedMinutes:null,productionEligible:false,productionWeight:0});
 const issued=at(q.issuedAt),start=at(q.startsAt);
 if(!Number.isFinite(issued)||!Number.isFinite(start)||issued>=start)return unknown('INVALID_PREGAME_TIME');
 const seen=new Set(),rows=[];
 for(const g of history??[]){
  if(seen.has(g.id))throw Error('DUPLICATE_MINUTES_HISTORY');seen.add(g.id);
  const ended=at(g.startsAt)+8*3600000,observed=at(g.observedAt);
  if(!Number.isFinite(ended)||!Number.isFinite(observed)||ended>issued||observed>issued||observed<at(g.startsAt))continue;
  const p=(g.players??[]).filter(p=>p.id===q.playerId&&p.teamId===q.teamId);
  if(p.length>1)throw Error('DUPLICATE_MINUTES_PLAYER');
  if(!p.length)continue;
  const m=p[0].minutes;if(typeof m!=='number'||!Number.isFinite(m)||m<0||m>70)throw Error('INVALID_MINUTES_HISTORY');
  if(m>0)rows.push({id:g.id,startsAt:g.startsAt,minutes:m});
 }
 rows.sort((a,b)=>at(a.startsAt)-at(b.startsAt)||String(a.id).localeCompare(String(b.id)));
 const sample=rows.slice(-10);
 if(sample.length<5)return unknown('MINUTES_SAMPLE_BELOW_FIVE');
 if(issued-at(sample.at(-1).startsAt)>21*86400000)return unknown('MINUTES_HISTORY_STALE');
 const weights=sample.map((_,i)=>2**(-(sample.length-1-i)/3));
 const projectedMinutes=Math.min(48,sample.reduce((s,r,i)=>s+r.minutes*weights[i],0)/weights.reduce((a,b)=>a+b,0));
 return {version:'nba-minutes-ewma-v1',status:'EXPERIMENTAL_UNVALIDATED',projectedMinutes,
  baselineMinutes:sample.reduce((s,r)=>s+r.minutes,0)/sample.length,sampleSize:sample.length,
  historyIds:sample.map(r=>r.id),issuedAt:q.issuedAt,condition:'POSITIVE_MINUTE_PARTICIPATION',
  halfLifeGames:3,productionEligible:false,productionWeight:0,
  limitations:['NO_CONFIRMED_ROTATION_OR_MINUTES_RESTRICTION','NO_PROSPECTIVE_VALIDATION']};
}
export function pregameEvidence(report,event,playerId,issuedAt,history=[]){
 const p=event.players?.[playerId],sides=['home','away'],own=sides.map(s=>event.teams?.[s]).find(t=>t?.teamID===p?.teamID);
 const q={playerId,teamId:p?.teamID,startsAt:event.status?.startsAt,issuedAt};
 const validReport=/^https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_[\w.-]+\.pdf$/.test(report?.url??'')&&/^[a-f0-9]{64}$/.test(report?.sha256??'');
 const availability=p?.playerID===playerId&&own&&validReport?matchOfficialInjury(report,{...q,teamName:own.names?.long,
  matchup:sides.reverse().map(s=>event.teams?.[s]?.names?.short??'').join('@'),firstName:p.firstName,lastName:p.lastName}):
  {status:'UNKNOWN',reason:'OFFICIAL_REPORT_OR_PLAYER_IDENTITY_UNVERIFIED',participationConfirmed:false};
 let minutes;try{minutes=projectMinutes(history,q);}catch(e){minutes={status:'UNAVAILABLE',reason:e.message,projectedMinutes:null,productionEligible:false,productionWeight:0};}
 return {availability,minutes,participationConfirmed:false,productionEligible:false,productionWeight:0,
  blockers:[...(availability.status==='UNKNOWN'?['AVAILABILITY_UNVERIFIED']:[]),
   ...(['Out','Doubtful','Questionable'].includes(availability.status)?['OFFICIAL_STATUS_'+availability.status.toUpperCase()]:[]),
   'PARTICIPATION_UNVERIFIED','PROJECTED_MINUTES_UNVERIFIED']};
}
