const instant=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const count=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function parseSgoNbaSummary(e,observedAt,seasonYear){
 const start=instant(e?.status?.startsAt),observed=instant(observedAt);
 // NBA official 2026-27 schedule establishes Oct 20 opening; bounded before Cup knockout exceptions.
 const verifiedWindow=seasonYear===2026&&start>=Date.parse('2026-10-20T00:00:00Z')&&start<Date.parse('2026-12-01T00:00:00Z');
 const seasons=[`NBA ${String(seasonYear).slice(-2)}/${String(seasonYear+1).slice(-2)}`,`NBA Cup ${seasonYear}`];
 if(e?.leagueID!=='NBA'||e.type!=='match'||!e.eventID||e.status?.finalized!==true||e.status?.completed!==true||e.status?.ended!==true||e.status.cancelled===true||!Number.isFinite(start)||!Number.isFinite(observed)||start>=observed||!verifiedWindow||(e.info?.seasonWeek!=null&&!seasons.includes(e.info.seasonWeek)))throw Error('SGO_INVALID_FINAL_GAME');
 const result=e.results?.game,teams=['home','away'].map(side=>({id:e.teams?.[side]?.teamID,points:result?.[side]?.points,possessions:0}));
 if(teams.some(t=>typeof t.id!=='string'||!t.id.endsWith('_NBA')||!count(t.points))||teams[0].id===teams[1].id)throw Error('SGO_INVALID_TEAMS');
 const players=[];
 for(const [id,r] of Object.entries(result??{})){
  if(['home','away','all'].includes(id))continue;
  if(!id.endsWith('_NBA')||!count(r.secondsPlayed)||r.secondsPlayed>4200)throw Error('SGO_INVALID_MINUTES');
  // Explicit zero-minute participants are not observations of ability.
  if(r.secondsPlayed===0)continue;
  const p=e.players?.[id],team=teams.find(t=>t.id===p?.teamID);
  if(!team||p.playerID!==id)throw Error('SGO_PLAYER_TEAM_UNVERIFIED');
  if(['points','rebounds','assists','fieldGoalsAttempted','freeThrowsAttempted','offensiveRebounds','turnovers'].some(k=>!count(r[k])))throw Error('SGO_INCOMPLETE_PLAYER_STATS');
  team.possessions+=r.fieldGoalsAttempted+.44*r.freeThrowsAttempted-r.offensiveRebounds+r.turnovers;
  players.push({id,teamId:team.id,minutes:r.secondsPlayed/60,points:r.points,rebounds:r.rebounds,assists:r.assists,starter:null});
 }
 const seconds=[];
 for(const [i,t] of teams.entries()){
  const rows=Object.entries(result).filter(([id,r])=>e.players?.[id]?.teamID===t.id&&r.secondsPlayed>0).map(([,r])=>r);
  const total=rows.reduce((s,r)=>s+r.secondsPlayed,0);seconds.push(total);
  const overtime=Math.round((total-14400)/1500);
  if(t.possessions<=0||rows.length<5||overtime<0||overtime>6||Math.abs(total-(14400+1500*overtime))>5)throw Error('SGO_INCOMPLETE_BOXSCORE');
  const teamStats=result[i===0?'home':'away'];
  for(const k of ['points','rebounds','assists','fieldGoalsAttempted','freeThrowsAttempted','offensiveRebounds','turnovers'])if(!count(teamStats[k])||rows.reduce((s,r)=>s+r[k],0)!==teamStats[k])throw Error('SGO_INCOMPLETE_BOXSCORE');
 }
 if(Math.abs(seconds[0]-seconds[1])>5)throw Error('SGO_INCOMPLETE_BOXSCORE');
 return {id:`sgo:${e.eventID}`,startsAt:e.status.startsAt,observedAt,source:'SportsGameOdds',sourceContract:'sgo-nba-v1',teams,players};
}
/** Bounded authenticated request; caller owns pagination and durable cooldown state. */
export async function sgoPage(params,{key,state,clock=()=>new Date().toISOString(),fetchImpl=fetch}){
 const now=instant(clock());if(!key||/redact/i.test(key))throw Error('SGO_KEY_NOT_CONFIGURED');
 if(!Number.isFinite(now))throw Error('INVALID_CLOCK');
 if((state.sgoCooldownUntil??0)>now)throw Error('SGO_COOLDOWN');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const r=await fetchImpl('https://api.sportsgameodds.com/v2/events?'+new URLSearchParams(params),{headers:{accept:'application/json','x-api-key':key},signal:controller.signal,redirect:'error'});
  if(!r.ok){const retry=r.headers.get('retry-after');const seconds=/^\d+$/.test(retry??'')?Number(retry):Math.max(0,(Date.parse(retry)-now)/1000)||0;
   state.sgoCooldownUntil=now+1000*Math.min(86400,Math.max(seconds,r.status===429?60:[401,403].includes(r.status)?3600:30));throw Error(`SGO_HTTP_${r.status}`);}
  let bytes=0,text='';const reader=r.body?.getReader(),decoder=new TextDecoder();if(!reader)throw Error('SGO_EMPTY_BODY');
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4*1024*1024){await reader.cancel();throw Error('SGO_RESPONSE_TOO_LARGE');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  const b=JSON.parse(text);if(b.success!==true||!Array.isArray(b.data)||b.data.length>Number(params.limit??20)||b.nextCursor!=null&&typeof b.nextCursor!=='string')throw Error('SGO_INVALID_PAGE');
  return {events:b.data,nextCursor:b.nextCursor||null,observedAt:clock()};
 }finally{clearTimeout(timer);}
}
export function sgoOutcome(row,event,retrievedAt,seasonYear,verifiedSummary=null){
 try{
  if(row.context?.sourceContract!=='sgo-nba-v1'||row.eventID!==`sgo:${event.eventID}`||!['points','rebounds','assists'].includes(row.market)||!['OVER','UNDER'].includes(row.side)||typeof row.line!=='number'||!Number.isFinite(row.line))return null;
  const g=verifiedSummary??parseSgoNbaSummary(event,retrievedAt,seasonYear),p=g.players.find(p=>p.id===row.playerID&&p.teamId===row.context.teamId);
  if(g.id!==row.eventID||!p||!g.teams.some(t=>t.id===row.context.opponentTeamId)||row.context.teamId===row.context.opponentTeamId||Math.abs(instant(row.startsAt)-instant(g.startsAt))>900000||!(instant(row.receivedAt)<Math.min(instant(row.startsAt),instant(g.startsAt))))return null;
  const actual=p[row.market],outcome=actual===row.line?'PUSH':(row.side==='OVER'?actual>row.line:actual<row.line)?'WIN':'LOSS';
  return {identity:row.identity,playerID:row.playerID,actualMinutes:p.minutes,actual,outcome,researchOnly:true,source:g.source,sourceContract:g.sourceContract,...(g.backupEvidence?{backupEvidence:g.backupEvidence}:{}),officialEventId:g.id,officialStartAt:g.startsAt,retrievedAt,settlementPolicy:'RESEARCH_POSITIVE_MINUTE_PARTICIPATION_ONLY'};
 }catch{return null;}
}
