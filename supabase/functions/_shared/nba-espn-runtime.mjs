import {fetchResultResponse} from './performance-worker.mjs';
import {normalizeFinalResult} from './performance-result-sources.mjs';

const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const id=value=>(typeof value==='string'&&/^[1-9]\d*$/.test(value)||Number.isSafeInteger(value)&&value>0)&&Number.isSafeInteger(Number(value))?String(value):null;
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):null;
const score=value=>{const n=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;return Number.isSafeInteger(n)&&n>=0?n:null;};
const unavailable=reason=>({ok:false,reason});

function scoreboardEvent(event,retrievedAt) {
 const eventId=id(event?.id),competition=event?.competitions?.[0],teams=competition?.competitors;
 if(!eventId||event?.uid!==`s:40~l:46~e:${eventId}`||event?.competitions?.length!==1||id(competition.id)!==eventId||!Array.isArray(teams)||teams.length!==2)return null;
 const home=teams.find(x=>x?.homeAway==='home'),away=teams.find(x=>x?.homeAway==='away');
 const homeId=id(home?.id),awayId=id(away?.id);
 if(!homeId||!awayId||homeId===awayId||id(home?.team?.id)!==homeId||id(away?.team?.id)!==awayId)return null;
 const starts=stamp(competition.date??event.date),type=competition.status?.type;
 if(starts===null||!type)return null;
 const status=type.name==='STATUS_FINAL'&&type.completed===true&&type.state==='post'?'FINAL':type.name==='STATUS_CANCELED'?'CANCELLED':type.name==='STATUS_POSTPONED'?'POSTPONED':type.state==='in'?'LIVE':type.state==='pre'?'SCHEDULED':'UNKNOWN';
 if(status==='UNKNOWN'||status==='FINAL'&&starts>stamp(retrievedAt))return null;
 const homeScore=status==='FINAL'?score(home.score):null,awayScore=status==='FINAL'?score(away.score):null;
 if(status==='FINAL'&&(homeScore===null||awayScore===null))return null;
 return {source:'espn',sourceEventId:eventId,eventKey:`espn:nba:${eventId}`,startsAt:new Date(starts).toISOString(),homeTeamId:homeId,awayTeamId:awayId,status,homeScore,awayScore};
}

/** Read-only, present-time ESPN NBA source. Cutoffs earlier than retrieval are unverifiable. */
export function createEspnNbaRuntime({fetchImpl=fetch,clock=()=>new Date().toISOString(),timeoutMs=12000,cacheTtlMs=30000,maxConcurrent=3}={}) {
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isInteger(cacheTtlMs)||cacheTtlMs<0||cacheTtlMs>300000||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>5)throw Error('Invalid runtime bounds');
 const cache=new Map();let active=0;const queue=[];
 const release=()=>{active--;queue.shift()?.();};
 async function acquire(){if(active>=maxConcurrent)await new Promise(resolve=>queue.push(resolve));active++;}
 function cutoff(cutoffAt){
  if(cutoffAt===undefined)return null;
  const value=stamp(cutoffAt),now=stamp(clock());
  return value===null||now===null?unavailable('INVALID_REQUEST'):value<now?unavailable('HISTORICAL_CUTOFF_UNVERIFIABLE'):null;
 }
 async function get(url,cutoffAt){
  const blocked=cutoff(cutoffAt);if(blocked)return blocked;
  const now=stamp(clock()),entry=cache.get(url);
  if(entry&&now-entry.at<=cacheTtlMs)return entry.value;
  await acquire();
  try{
   // Recheck after a queued request; no post-cutoff observation may enter the result.
   const queuedBlock=cutoff(cutoffAt);if(queuedBlock)return queuedBlock;
   const fetched=await fetchResultResponse(url,{fetchImpl,timeoutMs});
   const retrievedAt=clock(),retrieved=stamp(retrievedAt);
   if(retrieved===null)return unavailable('INVALID_REQUEST');
   if(cutoffAt!==undefined&&retrieved>stamp(cutoffAt))return unavailable('HISTORICAL_CUTOFF_UNVERIFIABLE');
   if(!fetched.ok)return unavailable(fetched.error);
   const value={ok:true,body:fetched.body,retrievedAt:new Date(retrieved).toISOString()};
   cache.set(url,{at:retrieved,value});
   if(cache.size>128)cache.delete(cache.keys().next().value);
   return value;
  }finally{release();}
 }
 async function scoreboard({date,cutoffAt}={}){
  if(typeof date!=='string'||!/^\d{8}$/.test(date))return unavailable('INVALID_REQUEST');
  const fetched=await get(`${BASE}/scoreboard?dates=${date}`,cutoffAt);if(!fetched.ok)return fetched;
  const p=fetched.body;if(!Array.isArray(p.leagues)||!p.leagues.some(x=>id(x?.id)==='46'&&x.uid==='s:40~l:46')||!Array.isArray(p.events)||p.events.length>100)return unavailable('INVALID_SCOREBOARD');
  const events=p.events.map(event=>scoreboardEvent(event,fetched.retrievedAt));if(events.some(x=>!x)||new Set(events.map(x=>x.eventKey)).size!==events.length)return unavailable('INVALID_SCOREBOARD');
  return {ok:true,source:'espn',retrievedAt:fetched.retrievedAt,events};
 }
 async function game(eventId,cutoffAt){
  const fetched=await get(`${BASE}/summary?event=${eventId}`,cutoffAt);if(!fetched.ok)return fetched;
  const result=normalizeFinalResult(fetched.body,{sport:'NBA',source:'espn',retrievedAt:fetched.retrievedAt});
  if(result.sourceEventId!==eventId||result.eventKey!==`espn:nba:${eventId}`||result.identityAmbiguous)return unavailable('INVALID_RESULT_IDENTITY');
  if(result.status!=='FINAL')return unavailable('RESULT_NOT_FINAL');
  const startsAt=stamp(fetched.body.header?.competitions?.[0]?.date);
  if(startsAt===null||startsAt>stamp(fetched.retrievedAt))return unavailable('INVALID_EVENT_DATE');
  const groups=fetched.body.boxscore?.players;
  if(!Array.isArray(groups)||groups.length!==2||new Set(groups.map(x=>id(x?.team?.id))).size!==2||!groups.some(x=>id(x?.team?.id)===result.homeTeamId)||!groups.some(x=>id(x?.team?.id)===result.awayTeamId)||groups.some(x=>!Array.isArray(x?.statistics)||x.statistics.length===0||x.statistics.every(s=>!Array.isArray(s?.athletes)||s.athletes.length===0))||!result.homeTeamId||!result.awayTeamId||result.homeScore===null||result.awayScore===null)return unavailable('INCOMPLETE_BOXSCORE');
  const players=Object.values(result.players);
  if(![result.homeTeamId,result.awayTeamId].every(teamId=>players.some(player=>player.teamId===teamId)))return unavailable('INCOMPLETE_BOXSCORE');
  return {ok:true,source:'espn',retrievedAt:fetched.retrievedAt,result};
 }
 async function completedGames({eventIds,cutoffAt}={}){
  if(!Array.isArray(eventIds)||eventIds.length<1||eventIds.length>20||eventIds.some(x=>!id(x))||new Set(eventIds.map(id)).size!==eventIds.length)return [unavailable('INVALID_REQUEST')];
  return Promise.all(eventIds.map(value=>game(id(value),cutoffAt)));
 }
 return {scoreboard,completedGames};
}
