import {createHash} from 'node:crypto';
import {exactSgoEvents} from '../local/sgo-nba-collector.mjs';
export const inactiveContract='nba-official-inactive-auto-v1';
const tricode=name=>({GS:'GSW',NO:'NOP',SA:'SAS',NY:'NYK',UTAH:'UTA'}[name]??name);
const normalize=s=>typeof s==='string'?s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,''):'';
const instant=s=>typeof s==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(s)?Date.parse(s):NaN;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const official=(s,host,path)=>{try{const u=new URL(s);return u.protocol==='https:'&&u.hostname===host&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&path.test(u.pathname);}catch{return false;}};
const issued=new WeakMap();
const digest=row=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
export function isValidatedAutomaticInactive(row,pending){return issued.get(row)===digest(row)&&row.outcome==='INACTIVE'&&row.actual===null&&row.actualMinutes===0&&row.researchOnly===true&&row.sourceContract===inactiveContract&&pending?.context?.sourceContract==='sgo-nba-v1'&&pending.eventID===row.eventID&&pending.playerID===row.playerID&&pending.context.teamId===row.teamId;}
function validateGame(e,b,now){
 if(e?.leagueID!=='NBA'||e.type!=='match'||e.status?.finalized!==true||e.status.completed!==true||e.status.ended!==true||e.status.cancelled===true)throw Error('INACTIVE_SGO_NOT_FINAL');
 if(b?.contract!==inactiveContract||b.gameFinal!==true||!/^\d{10}$/.test(b.gameId)||!Array.isArray(b.inactive))throw Error('INACTIVE_OFFICIAL_NOT_FINAL');
 const start=instant(e.status.startsAt),officialStart=instant(b.startsAt),retrieved=instant(b.retrievedAt);
 if(!Number.isFinite(now)||!Number.isFinite(start)||!Number.isFinite(officialStart)||Math.abs(start-officialStart)>900000||officialStart>=now||!Number.isFinite(retrieved)||retrieved>now||now-retrieved>21600000||retrieved<officialStart)throw Error('INACTIVE_TIME_MISMATCH');
 if(!official(b.sourceUrl,'statsdmz.nba.com',/^\/pdfs\/\d{8}\/\d{8}_[A-Z]{6}_book\.pdf$/)||!sha(b.sourceSha256)||!official(b.gamePageUrl,'www.nba.com',new RegExp('^/game/(?:[^/]+-)?'+b.gameId+'/box-score$'))||!sha(b.gamePageSha256)||!Array.isArray(b.rosterUrls)||b.rosterUrls.length!==2||!Array.isArray(b.rosterSha256)||b.rosterSha256.length!==2||!b.rosterSha256.every(sha))throw Error('INACTIVE_SOURCE_UNVERIFIED');
 for(const side of ['home','away']){
  const t=b[side],sgo=e.teams?.[side]?.teamID;
  if(!t||!/^\d{10}$/.test(String(t.teamId))||!/^[A-Z]{3}$/.test(t.tricode)||typeof sgo!=='string'||!sgo.endsWith('_NBA')||normalize(t.name)!==normalize(sgo.slice(0,-4))||!b.rosterUrls.some(url=>official(url,'www.nba.com',new RegExp('^/team/'+t.teamId+'/(?:[^/]+/)?roster$'))))throw Error('INACTIVE_TEAM_MISMATCH');
 }
 if(b.home.teamId===b.away.teamId||b.home.tricode===b.away.tricode)throw Error('INACTIVE_TEAM_MISMATCH');
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(officialStart)),compact=date.replaceAll('-','');
 if(b.gameDate!==date||b.sourceUrl!==`https://statsdmz.nba.com/pdfs/${compact}/${compact}_${b.away.tricode}${b.home.tricode}_book.pdf`||b.rosterUrls[0]===b.rosterUrls[1])throw Error('INACTIVE_SOURCE_GAME_MISMATCH');
}
export function automaticInactiveOutcome(row,event,body,now=new Date().toISOString()){
 try{
  validateGame(event,body,instant(now));
  const p=event.players?.[row.playerID],teams=[event.teams.home.teamID,event.teams.away.teamID];
  if(row.context?.sourceContract!=='sgo-nba-v1'||row.eventID!==`sgo:${event.eventID}`||!p||p.playerID!==row.playerID||!p.firstName?.trim()||!p.lastName?.trim()||p.teamID!==row.context.teamId||!teams.includes(p.teamID)||row.context.opponentTeamId!==teams.find(t=>t!==p.teamID)||Math.abs(instant(row.startsAt)-instant(event.status.startsAt))>900000||!Number.isFinite(instant(row.startsAt))||!(instant(row.receivedAt)<Math.min(instant(row.startsAt),instant(body.startsAt))))return null;
  const team=body[event.teams.home.teamID===p.teamID?'home':'away'],name=normalize(p.firstName+' '+p.lastName);
  if(Object.values(event.players).filter(x=>x.teamID===p.teamID&&normalize(x.firstName+' '+x.lastName)===name).length!==1)return null;
  const matches=body.inactive.filter(x=>x.teamTricode===team.tricode&&normalize(x.fullName)===name&&normalize(x.firstName+' '+x.lastName)===name);
  if(matches.length!==1||!/^\d+$/.test(String(matches[0].nbaPlayerId))||body.inactive.filter(x=>String(x.nbaPlayerId)===String(matches[0].nbaPlayerId)).length!==1)return null;
  const seconds=event.results?.game?.[row.playerID]?.secondsPlayed;
  if(seconds!=null&&(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds!==0))return null;
  const evidence={...body,contract:inactiveContract,officialGameId:body.gameId,officialStartAt:body.startsAt,eventID:row.eventID,playerID:row.playerID,teamId:p.teamID,nbaPlayerId:matches[0].nbaPlayerId,providerFirstName:p.firstName,providerLastName:p.lastName,teamTricode:team.tricode,participation:'OFFICIAL_INACTIVE',verificationMethod:'EXACT_OFFICIAL_GAMEBOOK_ROSTER_MATCH',reviewed:false};
  const outcome={identity:row.identity,eventID:row.eventID,playerID:row.playerID,teamId:p.teamID,actual:null,actualMinutes:0,outcome:'INACTIVE',researchOnly:true,source:'NBA official gamebook',sourceContract:inactiveContract,settlementPolicy:'RESEARCH_INACTIVE_NOT_GRADED',officialEventId:row.eventID,officialStartAt:body.startsAt,retrievedAt:body.retrievedAt,participationEvidence:evidence};
  issued.set(outcome,digest(outcome));return outcome;
 }catch{return null;}
}
export async function fetchInactiveEvidence(url,fetchImpl){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),40000);
 try{
  const r=await fetchImpl(url,{signal:controller.signal,redirect:'error',headers:{accept:'application/json'}});if(!r.ok)throw Error('INACTIVE_SOURCE_HTTP');
  const reader=r.body?.getReader();if(!reader)throw Error('INACTIVE_EMPTY_RESPONSE');let text='',size=0;const decoder=new TextDecoder();
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2097152){await reader.cancel();throw Error('INACTIVE_RESPONSE_TOO_LARGE');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  return JSON.parse(text);
 }finally{clearTimeout(timer);}
}
export async function verifyOneInactiveEvent(db,{state,page,fetchImpl=fetch,clock=()=>new Date().toISOString(),remainingMs=()=>100000}){
 const report={checkedEvents:0,inactiveOutcomes:0,reason:null};
 if(remainingMs()<45000){report.reason='RUN_BUDGET';return report;}
 const now=instant(clock()),rows=db.pending().filter(r=>r.context?.sourceContract==='sgo-nba-v1'&&r.eventID?.startsWith('sgo:')&&now-instant(r.startsAt)>=28800000&&now-instant(r.startsAt)<=604800000);
 const ids=[...new Set(rows.map(r=>r.eventID))].sort();
 const s=state.inactiveVerification??={cursor:null,events:{}};s.events??={};
 const ordered=[...ids.filter(x=>x>(s.cursor??'')),...ids.filter(x=>x<=(s.cursor??''))];
 const id=ordered.find(id=>!(s.events[id]?.retryAfter>now));
 if(!id){report.reason=ids.length?'COOLDOWN':'NO_ELIGIBLE_PENDING';return report;}
 s.cursor=id;s.events[id]={checkedAt:clock(),retryAfter:now+1800000};
 for(const old of Object.keys(s.events).sort((a,b)=>(instant(s.events[b].checkedAt)||0)-(instant(s.events[a].checkedAt)||0)).slice(31))delete s.events[old];
 report.checkedEvents=1;report.eventID=id;
 try{
  const p=await exactSgoEvents([id.slice(4)],page,true),e=p.events[0];
  if(!e||p.events.length!==1||e.status?.finalized!==true||e.leagueID!=='NBA')throw Error('INACTIVE_SGO_NOT_FINAL');
  if(remainingMs()<45000)throw Error('RUN_BUDGET');
  const tri=side=>tricode(e.teams?.[side]?.names?.short);
  if(!/^[A-Z]{3}$/.test(tri('home'))||!/^[A-Z]{3}$/.test(tri('away')))throw Error('INACTIVE_TEAM_TRICODE_MISSING');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.status.startsAt));
  const url='https://sports-analytics-prediction-system-tau.vercel.app/api/nbaavailability?'+new URLSearchParams({finalDate:date,away:tri('away'),home:tri('home')});
  const b=await fetchInactiveEvidence(url,fetchImpl);validateGame(e,b,instant(clock()));
  if(b.away.tricode!==tri('away')||b.home.tricode!==tri('home'))throw Error('INACTIVE_TEAM_MISMATCH');
  for(const row of rows.filter(r=>r.eventID===id)){const out=automaticInactiveOutcome(row,e,b,clock());if(out)report.inactiveOutcomes+=db.settle(out);}
  s.events[id].retryAfter=now+21600000;report.reason=report.inactiveOutcomes?'VERIFIED_INACTIVE':'VERIFIED_NO_INACTIVE';
 }catch(error){report.reason=error.message||'INACTIVE_SOURCE_FAILED';}
 s.events[id].reason=report.reason;return report;
}


