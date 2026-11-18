import {createHash,timingSafeEqual} from 'node:crypto';
import {protectedSportsGameOddsFetch,optimizeSportsGameOddsObjectLimit} from '../lib/provider-protection.js';
import {parseCsv,NFLVERSE_GAMES_URL,normalizeTeam} from '../lib/nfl-model.js';
import {buildWinnerCandidates,inspectWinnerQuotes} from '../lib/winner-capture-policy.js';
import {createWinnerModelManifest} from '../lib/winner-prospective-models.js';
import {applyOfficialScheduleRevision,cloneScheduleForRevision,resolveOfficialScheduleFinal,NFL_SCHEDULE_REVISIONS} from '../lib/winner-schedule-revisions.js';
import {createWinnerLineupCollector,nflInactiveEvidence,lineupReadiness} from '../lib/winner-lineup-evidence.js';
import {collectWinnerSpreadQuotes,WINNER_SPREAD_ODD_IDS} from '../lib/winner-spread-quotes.js';

const ESPN_NBA='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const BOOKS=['draftkings','fanduel','betmgm','caesars','bovada','pinnacle'];
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const stamp=now=>new Date(now()).toISOString();
const sameSecret=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length>0&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const nbaAlias={NY:'NYK',GS:'GSW',SA:'SAS',NO:'NOP',WSH:'WAS',UTAH:'UTA',PHO:'PHX'};
const nbaTeam=value=>nbaAlias[String(value??'').toUpperCase()]||String(value??'').toUpperCase();
const validNumber=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value));
const easternParts=value=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
const easternDate=value=>{const p=easternParts(value);return `${p.year}-${p.month}-${p.day}`;};
const dateOffset=(date,offset)=>new Date(Date.parse(date+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);

export function nflKickoff(row){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(row?.gameday??'')||!/^\d{2}:\d{2}$/.test(row?.gametime??''))return null;
 const wall=Date.parse(row.gameday+'T'+row.gametime+':00Z');if(!Number.isFinite(wall))return null;
 const matches=[4,5].map(h=>wall+h*3600000).filter(t=>{const p=easternParts(t);return `${p.year}-${p.month}-${p.day}`===row.gameday&&`${p.hour}:${p.minute}`===row.gametime;});
 return matches.length===1?new Date(matches[0]).toISOString():null;
}
function deduplicate(events){
 const out=new Map();
 const comparable=e=>({...e,sourceFetchedAt:null,sourceHash:null,sourceUrl:null});
 for(const event of events){const old=out.get(event.eventID);if(old&&JSON.stringify(comparable(old))!==JSON.stringify(comparable(event)))throw Error('SOURCE_IDENTITY_CONFLICT');if(!old)out.set(event.eventID,event);}
 return [...out.values()];
}
export function parseWinnerScoreboard(payload,fetchedAt){
 if(!Array.isArray(payload?.events)||payload.events.length>30)throw Error('NBA_SCOREBOARD_INVALID');
 const events=payload.events.map(e=>{
  const c=e?.competitions?.[0],teams=c?.competitors,home=teams?.find(t=>t.homeAway==='home'),away=teams?.find(t=>t.homeAway==='away');
  if(!/^\d+$/.test(String(e.id??''))||!Array.isArray(teams)||teams.length!==2||![home,away].every(t=>/^\d+$/.test(String(t?.team?.id??''))&&/^[A-Z]{2,4}$/.test(nbaTeam(t.team.abbreviation)))||home.team.id===away.team.id||!Number.isFinite(Date.parse(e.date)))throw Error('NBA_EVENT_INVALID');
  const state=e.status?.type?.state,completed=e.status?.type?.completed===true;
  const unavailable=/CANCEL|POSTPON|SUSPEND|DELAY/i.test([e.status?.type?.name,e.status?.type?.description,e.status?.type?.detail].join(' '));
  if(completed&&(Date.parse(e.date)>=Date.parse(fetchedAt)||![home.score,away.score].every(validNumber)||![home.score,away.score].every(s=>Number.isInteger(Number(s))&&Number(s)>=0&&Number(s)<=250)))throw Error('NBA_FINAL_INVALID');
  return {sport:'NBA',eventID:'espn:'+e.id,startsAt:new Date(e.date).toISOString(),season:Number(e.season?.year??c.season?.year??new Date(e.date).getUTCFullYear()),home:{id:String(home.team.id),abbreviation:nbaTeam(home.team.abbreviation)},away:{id:String(away.team.id),abbreviation:nbaTeam(away.team.abbreviation)},neutralSite:c.neutralSite===true,sourceIds:{espn:String(e.id)},identityVerified:true,sourceFetchedAt:fetchedAt,status:unavailable?'UNAVAILABLE':completed?'FINAL':state==='pre'?'SCHEDULED':'UNAVAILABLE',homeScore:completed?Number(home.score):null,awayScore:completed?Number(away.score):null};
 });
 return deduplicate(events);
}
export function parseWinnerNflSchedule(text,fetchedAt){
 const schedule=parseCsv(text);if(!schedule.length||schedule.length>30000)throw Error('NFL_SCHEDULE_INVALID');
 const events=[],verifiedSchedule=[],rejectedHistoryRows=[];
 for(const row of schedule){
  const startsAt=nflKickoff(row),home=normalizeTeam(row.home_team),away=normalizeTeam(row.away_team);
  const hasScores=[row.home_score,row.away_score].some(v=>typeof v==='string'?v.trim()!=='':v!==null&&v!==undefined);
  if(!startsAt||!home||!away||home===away||!/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(row.game_id??'')||row.game_id!==`${row.season}_${String(Number(row.week)).padStart(2,'0')}_${row.away_team}_${row.home_team}`){if(hasScores)rejectedHistoryRows.push({game_id:row.game_id,season:Number(row.season)});continue;}
  const scored=[row.home_score,row.away_score].every(validNumber);
  const completed=scored&&[row.home_score,row.away_score].every(v=>Number.isInteger(Number(v))&&Number(v)>=0&&Number(v)<100)&&validNumber(row.result)&&Number(row.result)===Number(row.home_score)-Number(row.away_score)&&Date.parse(startsAt)<Date.parse(fetchedAt);
  const status=completed?'FINAL':!hasScores?'SCHEDULED':'UNAVAILABLE';
  if(status!=='UNAVAILABLE')verifiedSchedule.push(row);else rejectedHistoryRows.push({game_id:row.game_id,season:Number(row.season)});
  events.push({sport:'NFL',eventID:'nflverse:'+row.game_id,startsAt,season:Number(row.season),week:Number(row.week),gameDate:row.gameday,home:{id:home,abbreviation:home},away:{id:away,abbreviation:away},neutralSite:String(row.location).toLowerCase()==='neutral',sourceIds:{nflverse:row.game_id},identityVerified:true,sourceFetchedAt:fetchedAt,status,homeScore:completed?Number(row.home_score):null,awayScore:completed?Number(row.away_score):null});
 }
 if(!events.length)throw Error('NFL_EVENTS_UNAVAILABLE');
 return {schedule:verifiedSchedule,events:deduplicate(events),rejectedHistoryRows};
}

async function limitedMap(values,limit,fn){
 const result=new Array(values.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(cursor<values.length){const i=cursor++;try{result[i]={ok:true,value:await fn(values[i])};}catch{result[i]={ok:false};}}}));
 return result;
}
function sourceRow(sourceUrl,text,fetchedAt){const rawSha256=sha(text);return {source_hash:sha({sourceUrl,rawSha256}),source_url:sourceUrl,fetched_at:fetchedAt,body:{rawText:text,rawSha256}};}
const snapshot=s=>({sourceUrl:s.source_url,fetchedAt:s.fetched_at,sha256:s.source_hash});
async function fetchSource(url,{fetchImpl,now,signal,maxBytes=8*1024*1024}){
 const response=await fetchImpl(url,{headers:{accept:'application/json,text/csv'},cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(4000)])});
 if(!response.ok)throw Error('SOURCE_UNAVAILABLE');
 if(Number(response.headers?.get?.('content-length'))>maxBytes)throw Error('SOURCE_TOO_LARGE');
 let text;
 if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('SOURCE_TOO_LARGE');}chunks.push(r.value);}}finally{reader.releaseLock();}text=Buffer.concat(chunks.map(c=>Buffer.from(c))).toString('utf8');}
 else{text=await response.text();if(Buffer.byteLength(text)>maxBytes)throw Error('SOURCE_TOO_LARGE');}
 return sourceRow(url,text,stamp(now));
}

export function createWinnerSourceLoader({fetchImpl=fetch,now=Date.now,providerFetch=protectedSportsGameOddsFetch,optimize=optimizeSportsGameOddsObjectLimit,env=process.env,scheduleRevisions=NFL_SCHEDULE_REVISIONS}={}){
 const historicalCache=new Map(),collectLineups=createWinnerLineupCollector({fetchImpl,now});
 return async({action,pending=[],signal=AbortSignal.timeout(23000)}={})=>{
  const today=easternDate(now()),historyDates=Array.from({length:21},(_,i)=>dateOffset(today,i-21));
  const settleDates=[...new Set(pending.filter(p=>p.sport==='NBA').map(p=>easternDate(p.starts_at??p.forecast?.identity?.startsAt)))].sort().slice(0,21);
  const dates=action==='settle'?settleDates:[...historyDates,today,dateOffset(today,1)];
  const [nbaResults,nflResult]=await Promise.all([
   limitedMap(dates,6,async date=>{
    let row=historicalCache.get(date);if(row&&now()-Date.parse(row.fetched_at)>6*3600000)row=null;
    if(!row)row=await fetchSource(ESPN_NBA+'?dates='+date.replaceAll('-','')+'&limit=100',{fetchImpl,now,signal});
    const events=parseWinnerScoreboard(JSON.parse(row.body.rawText),row.fetched_at).map(e=>({...e,sourceHash:row.source_hash,sourceUrl:row.source_url}));
    if(date<today){historicalCache.set(date,row);if(historicalCache.size>28)historicalCache.delete(historicalCache.keys().next().value);}
    return {date,row,events};
   }),
   fetchSource(NFLVERSE_GAMES_URL,{fetchImpl,now,signal}).then(row=>{const parsed=parseWinnerNflSchedule(row.body.rawText,row.fetched_at);return {ok:true,row,...parsed,events:parsed.events.map(e=>({...e,sourceHash:row.source_hash,sourceUrl:row.source_url}))};}).catch(()=>({ok:false}))
  ]);
  const sources=nbaResults.filter(r=>r.ok).map(r=>r.value.row);if(nflResult.ok)sources.push(nflResult.row);
  let nbaEvents=[],nbaConflict=false;try{nbaEvents=deduplicate(nbaResults.filter(r=>r.ok).flatMap(r=>r.value.events));}catch{nbaConflict=true;}
  const nbaHistorySources=nbaResults.filter((r,i)=>r.ok&&historyDates.includes(dates[i])).map(r=>r.value.row);
  const nbaComplete=!nbaConflict&&action==='refresh'&&nbaResults.length===23&&nbaResults.every(r=>r.ok);
  const nbaGames=nbaEvents.filter(e=>e.status==='FINAL').map(e=>({eventId:e.sourceIds.espn,startsAt:e.startsAt,home:e.home.abbreviation,away:e.away.abbreviation,homeScore:e.homeScore,awayScore:e.awayScore,completed:true}));
  const inWindow=e=>e.status==='SCHEDULED'&&Date.parse(e.startsAt)>now()+300000&&Date.parse(e.startsAt)<=now()+7*86400000;
  const season=new Date(now()).getUTCFullYear()-(new Date(now()).getUTCMonth()<2?1:0);
  const invalidNflHistory=nflResult.rejectedHistoryRows?.filter(r=>r.season>=season-1&&r.season<=season).length??0;
  const nflComplete=nflResult.ok&&invalidNflHistory===0;
  const groups={NBA:{events:nbaEvents.filter(inWindow),history:{games:nbaGames,complete:nbaComplete,sourceSnapshots:nbaResults.filter(r=>r.ok).map(r=>snapshot(r.value.row))}},NFL:{events:nflResult.ok?nflResult.events.filter(inWindow):[],history:{schedule:nflResult.ok?nflResult.schedule:[],complete:nflComplete,sourceSnapshots:nflResult.ok?[snapshot(nflResult.row)]:[]}}};
  const finals=[...nbaEvents,...(nflResult.events??[]).map(e=>e.status==='FINAL'?resolveOfficialScheduleFinal(e,stamp(now),scheduleRevisions):e)].filter(e=>e.status==='FINAL');
  const quoteStatus={NBA:'NOT_REQUESTED',NFL:'NOT_REQUESTED'},quotes=[],scheduleSourceConflicts=[];
  const quoteSourceReasons={},quoteMappings=new Map(),spreadInputs=new Map();
  // Fetch pregame evidence alongside quotes inside the same outer deadline.
  // NFL observations are rebound below after any audited schedule revision.
  const lineupPromise=action==='refresh'?collectLineups({events:[...groups.NBA.events,...groups.NFL.events],signal}):Promise.resolve({sources:[],lineupEvidence:[],coverage:{}});
  const apiKey=env.SPORTS_ODDS_API_KEY||env.SPORTSGAMEODDS_API_KEY||env.Sports_Game_Odds_API;
  for(const sport of ['NBA','NFL']){
   quoteSourceReasons[sport]=action!=='refresh'?'QUOTE_SOURCE_NOT_REQUESTED':!apiKey?'QUOTE_SOURCE_NOT_CONFIGURED':'QUOTE_SOURCE_UNAVAILABLE';
   for(const event of groups[sport].events)quoteMappings.set(event,{mappingStatus:'UNMATCHED',oneSidedBooks:0,unavailableBooks:0});
  }
  if(action==='refresh'&&apiKey&&!signal.aborted){
   const result=await limitedMap(['NBA','NFL'],2,async sport=>{
    const policy=await optimize({apiKey,requestedLimit:40,defaultLimit:40,priority:'background',fanout:2});if(policy.blocked){quoteSourceReasons[sport]='PROVIDER_BUDGET_RESERVED';throw Error('PROVIDER_BUDGET_RESERVED');}
    const bucket=Math.floor(now()/300000)*300000;
    const params=new URLSearchParams({leagueID:sport,type:'match',oddIDs:['points-home-game-ml-home','points-away-game-ml-away',...WINNER_SPREAD_ODD_IDS].join(','),bookmakerID:BOOKS.join(','),oddsAvailable:'true',finalized:'false',includeAltLines:'false',limit:String(policy.effectiveLimit||40),startsAfter:new Date(bucket).toISOString(),startsBefore:new Date(bucket+7*86400000).toISOString()});
    const url='https://api.sportsgameodds.com/v2/events?'+params;
    const r=await providerFetch({url,apiKey,freshMs:60000,staleMs:60000,timeoutMs:5000,consumer:'winner-prospective-quotes',priority:'background',objectPolicy:policy});
    const fetchedAt=new Date(r.fetchedAt).toISOString();
    if(r.upstreamError||!Array.isArray(r.payload?.data)||r.payload.data.length>40||Date.parse(fetchedAt)>now()||now()-Date.parse(fetchedAt)>60000)throw Error('QUOTE_SOURCE_UNAVAILABLE');
    const row=sourceRow(url,JSON.stringify(r.payload),fetchedAt);sources.push(row);
    const mappings=new Map();
    for(const raw of r.payload.data){
     if(typeof raw.eventID!=='string'||!raw.eventID||raw.leagueID!==sport||raw.type!=='match'||['started','live','completed','finalized','cancelled','canceled'].some(k=>raw.status?.[k]))continue;
     const normalize=sport==='NBA'?nbaTeam:normalizeTeam;
     const home=normalize(raw.teams?.home?.names?.short||raw.teams?.home?.names?.long),away=normalize(raw.teams?.away?.names?.short||raw.teams?.away?.names?.long);
     const providerStart=Date.parse(raw.status?.startsAt);if(!Number.isFinite(providerStart))continue;
     const sameDate=groups[sport].events.filter(e=>e.home.abbreviation===home&&e.away.abbreviation===away&&easternDate(e.startsAt)===easternDate(providerStart));
     if(sport==='NFL'&&sameDate.length===1){
      const revised=applyOfficialScheduleRevision({event:sameDate[0],provider:{...raw,home,away},providerSource:row,issuedAt:stamp(now),revisions:scheduleRevisions});
      if(revised){const correctedSchedule=cloneScheduleForRevision(groups.NFL.history.schedule,revised);Object.assign(sameDate[0],revised);groups.NFL.history.schedule=correctedSchedule;}
     }
     if(sameDate.length===1&&Date.parse(sameDate[0].startsAt)!==providerStart){
      const event=sameDate[0];event.identityVerified=false;event.identityConflict='SCHEDULE_SOURCE_CONFLICT';
      quoteMappings.get(event).mappingStatus='SCHEDULE_SOURCE_CONFLICT';
      scheduleSourceConflicts.push({sport,eventID:event.eventID,sourceEventId:raw.eventID,reason:'SCHEDULE_SOURCE_CONFLICT',home:event.home.abbreviation,away:event.away.abbreviation,scheduleStartsAt:event.startsAt,providerStartsAt:new Date(providerStart).toISOString(),scheduleSourceHash:event.sourceHash,providerSourceHash:row.source_hash,scheduleSourceFetchedAt:event.sourceFetchedAt,providerSourceFetchedAt:row.fetched_at});
      continue;
     }
     const matches=groups[sport].events.filter(e=>e.home.abbreviation===home&&e.away.abbreviation===away&&Date.parse(e.startsAt)===providerStart);
     if(matches.length!==1)continue;const event=matches[0];
     if(!mappings.has(event))mappings.set(event,[]);mappings.get(event).push(raw);
    }
    for(const [event,rawMatches] of mappings){
     const mapping=quoteMappings.get(event);
     if(rawMatches.length!==1){mapping.mappingStatus='QUOTE_EVENT_MAPPING_AMBIGUOUS';continue;}
     if(event.identityVerified!==true)continue;const raw=rawMatches[0];mapping.mappingStatus='EXACT_MATCH';
     event.sourceIds.sgo=raw.eventID;
     spreadInputs.set(event,{raw,source:row});
     for(const book of BOOKS){const h=raw.odds?.['points-home-game-ml-home']?.byBookmaker?.[book],a=raw.odds?.['points-away-game-ml-away']?.byBookmaker?.[book];if(h?.available!==true||a?.available!==true){if((h?.available===true)!==(a?.available===true))mapping.oneSidedBooks++;else mapping.unavailableBooks++;continue;}
      quotes.push({eventID:event.eventID,sourceEventId:raw.eventID,book,homeOdds:Number(h.odds),awayOdds:Number(a.odds),homeUpdatedAt:h.lastUpdatedAt,awayUpdatedAt:a.lastUpdatedAt,fetchedAt,sourceUrl:url,sourceHash:row.source_hash});
     }
    }
    quoteStatus[sport]=r.payload.nextCursor?'PARTIAL_PROVIDER_PAGE':'OBSERVED';
   });
   ['NBA','NFL'].forEach((sport,i)=>{if(!result[i].ok)quoteStatus[sport]='UNAVAILABLE';});
  }
  const lineupResult=await lineupPromise;sources.push(...lineupResult.sources);
  const lineupEvidence=lineupResult.lineupEvidence.filter(e=>e.kind!=='NFL_OFFICIAL_INACTIVES'&&groups.NBA.events.some(event=>event.eventID===e.eventID&&event.identityVerified===true));
  if(action==='refresh')for(const source of lineupResult.sources)if(source.source_url.startsWith('https://www.nfl.com/news/')&&source.source_url.includes('inactives'))lineupEvidence.push(...nflInactiveEvidence({events:groups.NFL.events,html:source.body.rawText,source,issuedAt:stamp(now)}));
  // Collection can finish before quote mapping applies an audited NFL revision.
  // Rebuild diagnostics from the corrected identities and rebound observations.
  const lineupCoverage={...lineupResult.coverage,nflInactiveGames:new Set(lineupEvidence.filter(e=>e.status==='VERIFIED_INACTIVE_LISTS').map(e=>e.eventID)).size,
   nflOutsideGameDayWindow:groups.NFL.events.filter(e=>Date.parse(e.startsAt)-now()>3*3600000).length,
   ...lineupReadiness([...groups.NBA.events,...groups.NFL.events],lineupEvidence,lineupResult.coverage.unavailable??[],stamp(now))};
  const quoteCoverage={},spreadCoverage={},assessedAt=stamp(now);
  for(const sport of ['NBA','NFL']){
   const status=quoteStatus[sport],reasonCounts={};
   const readiness=groups[sport].events.map(event=>{
    const mapping=quoteMappings.get(event),{comparison,diagnostics}=inspectWinnerQuotes(event,quotes,assessedAt);
    const reasons=Object.keys(diagnostics.reasonCounts);
    if(!['OBSERVED','PARTIAL_PROVIDER_PAGE'].includes(status))reasons.push(quoteSourceReasons[sport]);
    else if(mapping.mappingStatus==='UNMATCHED')reasons.push(status==='PARTIAL_PROVIDER_PAGE'?'QUOTE_EVENT_NOT_RETURNED_PARTIAL_PAGE':'QUOTE_EVENT_NOT_RETURNED');
    else if(mapping.mappingStatus!=='EXACT_MATCH')reasons.push(mapping.mappingStatus);
    else {
     if(mapping.oneSidedBooks)reasons.push('QUOTE_ONE_SIDED_BOOK');
     if(!diagnostics.matchingQuotes&&!mapping.oneSidedBooks)reasons.push('QUOTE_AVAILABLE_BOOK_PAIR_MISSING');
    }
    for(const reason of new Set(reasons))reasonCounts[reason]=(reasonCounts[reason]??0)+1;
    return {eventID:event.eventID,startsAt:event.startsAt,sourceStatus:status,...mapping,pairedPriceEligible:comparison.eligible,pairCount:comparison.pairs.length,matchingQuotes:diagnostics.matchingQuotes,rejectedQuotes:diagnostics.rejectedQuotes,conflictingBooks:diagnostics.conflictingBooks,reasons:[...new Set(reasons)]};
   });
   quoteCoverage[sport]={status,assessedAt,expectedEvents:readiness.length,mappedEvents:readiness.filter(r=>r.mappingStatus==='EXACT_MATCH').length,eventsWithPairs:readiness.filter(r=>r.pairedPriceEligible).length,eligiblePairs:readiness.reduce((n,r)=>n+r.pairCount,0),reasonCounts,readiness};
   const spreadReasons={},spreadReadiness=groups[sport].events.slice(0,100).map(event=>{
    const mapping=quoteMappings.get(event),input=spreadInputs.get(event);
    const missing=!['OBSERVED','PARTIAL_PROVIDER_PAGE'].includes(status)?quoteSourceReasons[sport]:mapping.mappingStatus==='UNMATCHED'?(status==='PARTIAL_PROVIDER_PAGE'?'QUOTE_EVENT_NOT_RETURNED_PARTIAL_PAGE':'QUOTE_EVENT_NOT_RETURNED'):mapping.mappingStatus;
    const observation=input?collectWinnerSpreadQuotes({event,...input,books:BOOKS,issuedAt:assessedAt}):{pairedPriceEligible:false,pairs:[],matchingQuotes:0,rejectedQuotes:0,oneSidedBooks:0,unavailableBooks:0,reasons:[missing.replace(/^QUOTE_/,'SPREAD_')]};
    for(const reason of observation.reasons)spreadReasons[reason]=(spreadReasons[reason]??0)+1;
    return {eventID:event.eventID,startsAt:event.startsAt,sourceStatus:status,mappingStatus:mapping.mappingStatus,pairedPriceEligible:observation.pairedPriceEligible,pairCount:observation.pairs.length,matchingQuotes:observation.matchingQuotes,rejectedQuotes:observation.rejectedQuotes,oneSidedBooks:observation.oneSidedBooks,unavailableBooks:observation.unavailableBooks,reasons:observation.reasons,pairs:observation.pairs};
   });
   if(groups[sport].events.length>spreadReadiness.length)spreadReasons.SPREAD_DIAGNOSTIC_LIMIT_EXCEEDED=groups[sport].events.length-spreadReadiness.length;
   spreadCoverage[sport]={purpose:'PRICE_EVIDENCE_ONLY',coverProbabilityAvailable:false,productionEligible:false,status,assessedAt,expectedEvents:groups[sport].events.length,inspectedEvents:spreadReadiness.length,mappedEvents:spreadReadiness.filter(r=>r.mappingStatus==='EXACT_MATCH').length,eventsWithPairs:spreadReadiness.filter(r=>r.pairedPriceEligible).length,eligiblePairs:spreadReadiness.reduce((n,r)=>n+r.pairCount,0),reasonCounts:spreadReasons,readiness:spreadReadiness};
  }
  return {groups,finals,sources,quotes,lineupEvidence,coverage:{nbaHistoryDays:nbaHistorySources.length,nbaHistoryComplete:nbaComplete,nbaIdentityConflict:nbaConflict,nflHistoryComplete:nflComplete,nflRejectedHistoryRows:invalidNflHistory,quoteStatus,quotes:quoteCoverage,spreads:spreadCoverage,lineups:lineupCoverage,scheduleSourceConflicts,scheduleSourceConflictCount:new Set(scheduleSourceConflicts.map(c=>c.sport+':'+c.eventID)).size,scheduleRevisionsApplied:groups.NFL.events.filter(e=>e.scheduleRevision).map(e=>({eventID:e.eventID,providerEventID:e.providerEventID,revisionHash:e.scheduleRevision.revisionHash}))}};
 };
}

export function winnerOutcomeRevisions(pending,finals,sources,observedAt){
 const rows=[],conflicts=[];
 for(const saved of pending){
  const identity=saved.forecast?.identity??saved.identity,eventID=saved.event_id??identity?.eventID;
  const matches=finals.filter(e=>e.sport===saved.sport&&e.eventID===eventID);if(matches.length!==1)continue;const e=matches[0];
  const match=identity&&identity.startsAt===e.startsAt&&['home','away'].every(s=>identity[s]?.id===e[s].id&&identity[s]?.abbreviation===e[s].abbreviation)&&Object.entries(identity.sourceIds??{}).filter(([k])=>k!=='sgo').every(([k,v])=>e.sourceIds[k]===v);
  if(!match){conflicts.push(eventID);continue;}
  const source=sources.find(s=>s.source_hash===e.sourceHash&&s.fetched_at===e.sourceFetchedAt);
  if(!source)continue;
  const outcome={identity:structuredClone(identity),status:e.homeScore===e.awayScore?'TIE':'FINAL',homeScore:e.homeScore,awayScore:e.awayScore,result:e.homeScore===e.awayScore?'TIE':e.homeScore>e.awayScore?'HOME_WIN':'AWAY_WIN',final:true,source:e.sport==='NBA'?'ESPN_SCOREBOARD':'NFLVERSE_SCHEDULE',sourceAuthority:'PROVIDER_REPORTED_FINAL',leagueOfficialVerified:false,sourceUrl:source.source_url,sourceHash:source.source_hash,sourceFetchedAt:source.fetched_at,productionEligible:false};
  const evidenceHash=sha(outcome);if(!rows.some(r=>r.sport===e.sport&&r.event_id===e.eventID&&r.evidence_hash===evidenceHash))rows.push({sport:e.sport,event_id:e.eventID,evidence_hash:evidenceHash,observed_at:source.fetched_at,outcome});
 }
 return {rows,conflicts:[...new Set(conflicts)]};
}

// Sequential POST work leaves 2.5 seconds for parsing, inference, and the response.
export const WINNER_PHASE_BUDGET_MS=Object.freeze({status:2500,pending:2500,sources:14000,append:11000});
export function createWinnerStore({env=process.env,fetchImpl=fetch,deadlineSignal=AbortSignal.timeout}={}){
 const key=env.EDGE_LAB_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY;
 const base=(env.SUPABASE_URL||'https://yeoxroijaptomomshdii.supabase.co').replace(/\/$/,'');
 const rpc=async(name,phase,args={})=>{const headers={'content-type':'application/json',apikey:key};if(key?.startsWith('eyJ'))headers.authorization='Bearer '+key;const response=await fetchImpl(base+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args),signal:deadlineSignal(WINNER_PHASE_BUDGET_MS[phase]),redirect:'error'});if(!response.ok)throw Object.assign(Error('DATABASE_UNAVAILABLE'),{code:'DATABASE_HTTP_ERROR'});return response.json();};
 return {status:()=>rpc('winner_research_status','status'),pending:()=>rpc('winner_research_pending','pending'),append:payload=>rpc('winner_research_append','append',payload)};
}
const safeCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(value);
const safeTime=value=>typeof value==='string'&&value.length<=35&&Number.isFinite(Date.parse(value));
const safeEventId=value=>typeof value==='string'&&value.length<=200&&/^(espn|nflverse|sgo):[a-zA-Z0-9_:-]+$/.test(value);
const safeCounts=(value,keys)=>Object.fromEntries(keys.filter(k=>Number.isInteger(value?.[k])&&value[k]>=0).map(k=>[k,value[k]]));
const safeReasons=value=>Array.isArray(value)?[...new Set(value.filter(safeCode))].slice(0,30):[];
const safeReasonCounts=value=>Object.fromEntries(Object.entries(value??{}).filter(([k,v])=>safeCode(k)&&Number.isInteger(v)&&v>=0).slice(0,60));
function publicLineupCoverage(value){
 const result=safeCounts(value,['nbaCheckedGames','nbaConfirmedGames','nbaExpectedGames','nbaInjuryGames','nflCheckedGames','nflInactiveGames','nflOutsideGameDayWindow']);
 if(value.reasonCounts)result.reasonCounts=safeReasonCounts(value.reasonCounts);
 if(Array.isArray(value.readiness))result.readiness=value.readiness.filter(r=>['NBA','NFL'].includes(r?.sport)&&safeEventId(r.eventID)&&safeTime(r.startsAt)&&safeCode(r.status)).slice(0,100).map(r=>({sport:r.sport,eventID:r.eventID,startsAt:r.startsAt,status:r.status,reason:safeCode(r.reason)?r.reason:null,...Object.fromEntries(['injuryReportObserved','inactiveListsVerified','participationConfirmed'].filter(k=>typeof r[k]==='boolean').map(k=>[k,r[k]]))}));
 return result;
}
function publicQuoteCoverage(value){
 const result={};
 for(const sport of ['NBA','NFL']){
  const row=value?.[sport];if(!row||!safeCode(row.status))continue;
  result[sport]={status:row.status,...(safeTime(row.assessedAt)?{assessedAt:row.assessedAt}:{}),...safeCounts(row,['expectedEvents','inspectedEvents','mappedEvents','eventsWithPairs','eligiblePairs']),reasonCounts:safeReasonCounts(row.reasonCounts)};
  if(Array.isArray(row.readiness))result[sport].readiness=row.readiness.filter(r=>safeEventId(r?.eventID)&&safeTime(r.startsAt)&&safeCode(r.sourceStatus)&&safeCode(r.mappingStatus)).slice(0,100).map(r=>({eventID:r.eventID,startsAt:r.startsAt,sourceStatus:r.sourceStatus,mappingStatus:r.mappingStatus,pairedPriceEligible:r.pairedPriceEligible===true,...safeCounts(r,['pairCount','matchingQuotes','rejectedQuotes','conflictingBooks','oneSidedBooks','unavailableBooks']),reasons:safeReasons(r.reasons)}));
 }
 return result;
}
function publicReadiness(value){
 if(value?.basis!=='LATEST_PREGAME_OBSERVATION_NOT_ORIGINAL_FORECAST')return null;
 return {basis:value.basis,...safeCounts(value,['maxAgeSeconds']),events:(Array.isArray(value.events)?value.events:[]).filter(r=>['NBA','NFL'].includes(r?.sport)&&safeEventId(r.event_id)&&safeTime(r.starts_at)&&safeTime(r.observed_at)&&safeTime(r.issued_at)&&['EARLY','PRE90_30','PRE30_5'].includes(r.capture_window)).slice(0,100).map(r=>({sport:r.sport,event_id:r.event_id,starts_at:r.starts_at,observed_at:r.observed_at,issued_at:r.issued_at,...(safeTime(r.recorded_at)?{recorded_at:r.recorded_at}:{}),capture_window:r.capture_window,observation_fresh:r.observation_fresh===true,lineup_verified_at_observation:r.lineup_verified_at_observation===true,lineup_status:safeCode(r.lineup_status)?r.lineup_status:'UNAVAILABLE',lineup_reason:safeCode(r.lineup_reason)?r.lineup_reason:null,paired_prices_at_observation:r.paired_prices_at_observation===true,...safeCounts(r,['pair_count']),price_reasons:safeReasons(r.price_reasons)}))};
}
function publicValidationStudies(value){
 if(value?.basis!=='REQUESTS_ONLY_NO_CONFIRMATION_ENROLLMENT')return null;
 const studies=[],seen=new Set();
 for(const row of (Array.isArray(value.studies)?value.studies:[]).slice(0,100)){
  if(!['NBA','NFL'].includes(row?.sport)||!['WINNER','SPREAD'].includes(row.market)||typeof row.studyId!=='string'||!/^[a-zA-Z0-9_:.\-]{1,200}$/.test(row.studyId)||!safeTime(row.recordedAt)||![row.policyHash,row.incumbentHash].every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/i.test(h))||row.status!=='RECORDED_NOT_ENROLLING'||row.confirmationStatus!=='NOT_STARTED'||row.enrollmentEnabled!==false||row.registration!==null)continue;
  const key=row.sport+':'+row.market;if(seen.has(key))continue;seen.add(key);
  studies.push({studyId:row.studyId,sport:row.sport,market:row.market,recordedAt:row.recordedAt,policyHash:row.policyHash,incumbentHash:row.incumbentHash,status:'RECORDED_NOT_ENROLLING',confirmationStatus:'NOT_STARTED',enrollmentEnabled:false,registration:null,blockers:safeReasons(row.blockers),productionEligible:false,productionWeight:0});
 }
 return {basis:'REQUESTS_ONLY_NO_CONFIRMATION_ENROLLMENT',studies:studies.slice(0,4)};
}
function publicStatus(data){
 const result={status:typeof data?.status==='string'?data.status:'RESEARCH_ONLY',productionEligible:false,productionWeight:0};
 for(const key of ['capturedForecasts','distinctGames','settledGames','binaryPairs','sourceCount','outcomeRevisions','quarantined_games','quality_flagged_events','schedule_resolutions'])if(Number.isFinite(data?.[key]))result[key]=data[key];
 if(typeof data?.generatedAt==='string')result.generatedAt=data.generatedAt;
 Object.assign(result,safeCounts(data,['readinessObservations']));
 const readiness=publicReadiness(data?.readiness);if(readiness)result.readiness=readiness;
 const validationStudies=publicValidationStudies(data?.validationStudies);if(validationStudies)result.validationStudies=validationStudies;
 if(Array.isArray(data?.sports))result.sports=data.sports.filter(r=>['NBA','NFL'].includes(r?.sport)).map(r=>({sport:r.sport,...Object.fromEntries(Object.entries(r).filter(([k,v])=>/^(forecasts|distinctGames|settledGames|binaryPairs|sourceCount|baselineOnly|fullFeatureEligible|capturedForecasts|outcomeRevisions)$/.test(k)&&Number.isFinite(v)))}));
 if(Array.isArray(data?.cohorts))result.cohorts=data.cohorts.filter(r=>['NBA','NFL'].includes(r?.sport)).map(r=>({sport:r.sport,capture_window:['EARLY','PRE90_30','PRE30_5'].includes(r.capture_window)?r.capture_window:null,...Object.fromEntries(Object.entries(r).filter(([k,v])=>/^(forecast_rows|games|eligible_games|quarantined_games|schedule_resolved_games|lineup_verified|paired_prices|final_results|ties|awaiting_outcome)$/.test(k)&&Number.isFinite(v)))}));
 if(data?.latest&&typeof data.latest.generatedAt==='string')result.latest={generatedAt:data.latest.generatedAt,status:'RESEARCH_ONLY',...Object.fromEntries(['candidates','excluded','outcomeConflicts'].filter(k=>Number.isFinite(data.latest[k])).map(k=>[k,data.latest[k]]))};
 if(result.latest){const count=data.latest.scheduleSourceConflicts??data.latest.coverage?.scheduleSourceConflictCount;if(Number.isInteger(count)&&count>=0)result.latest.schedule_source_conflicts=count;}
 if(result.latest&&data.latest.coverage?.lineups)result.latest.lineups=publicLineupCoverage(data.latest.coverage.lineups);
 if(result.latest&&data.latest.coverage?.quotes)result.latest.quotes=publicQuoteCoverage(data.latest.coverage.quotes);
 if(result.latest&&data.latest.coverage?.spreads)result.latest.spreads=Object.fromEntries(Object.entries(publicQuoteCoverage(data.latest.coverage.spreads)).map(([sport,row])=>[sport,{...row,purpose:'PRICE_EVIDENCE_ONLY',coverProbabilityAvailable:false,productionEligible:false}]));
 return result;
}
export function createWinnerHandler({env=process.env,fetchImpl=fetch,now=Date.now,providerFetch=protectedSportsGameOddsFetch,optimize=optimizeSportsGameOddsObjectLimit,store,loadSources,collectionTimeoutMs=WINNER_PHASE_BUDGET_MS.sources,logger=entry=>console.error(JSON.stringify(entry))}={}){
 const database=store??createWinnerStore({env,fetchImpl}),load=loadSources??createWinnerSourceLoader({env,fetchImpl,now,providerFetch,optimize});
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  const key=env.EDGE_LAB_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY;
  if(!key)return res.status(503).json({error:'WINNER_SERVICE_UNAVAILABLE',productionEligible:false});
  if(req.method==='POST'&&!sameSecret(req.headers?.authorization,'Bearer '+key))return res.status(401).json({error:'UNAUTHORIZED'});
  let body=req.body??{};if(typeof body==='string'){try{body=JSON.parse(body);}catch{return res.status(400).json({error:'INVALID_ACTION'});}}
  if(req.method==='POST'&&(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>k!=='action')||!['refresh','settle'].includes(body.action)))return res.status(400).json({error:'INVALID_ACTION'});
  let phase=req.method==='GET'?'status':'pending';const requestStarted=Date.now();
  try{
   if(req.method==='GET')return res.status(200).json(publicStatus(await database.status()));
   const pending=await database.pending();if(!Array.isArray(pending)||pending.length>100)throw Error('INVALID_PENDING');
   phase='sources';const controller=new AbortController();let timer;
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('COLLECTION_DEADLINE'),{name:'TimeoutError'}));},Math.max(1,Math.min(collectionTimeoutMs,WINNER_PHASE_BUDGET_MS.sources)));});
   let source;try{source=await Promise.race([load({action:body.action,pending,signal:controller.signal}),deadline]);}finally{clearTimeout(timer);}
   phase='inference';const issuedAt=stamp(now),manifests=[],forecasts=[],excluded=[];
   const receiptTimes=source.sources.map(s=>Date.parse(s.fetched_at)).filter(Number.isFinite);
   const observedAt=receiptTimes.length?new Date(Math.max(...receiptTimes)).toISOString():issuedAt;
   if(body.action==='refresh')for(const sport of ['NBA','NFL']){
    const manifest=createWinnerModelManifest(sport);manifests.push({model_hash:manifest.modelHash??manifest.manifestHash,sport,model_version:manifest.modelVersion,manifest});
    const result=buildWinnerCandidates({sport,...source.groups[sport],quotes:source.quotes,observedAt,issuedAt,modelManifest:manifest,lineupEvidence:source.lineupEvidence??[]});
    excluded.push(...result.excluded.map(row=>({sport,...row})));
    for(const candidate of result.candidates){const {inputEvidence,inputObservedAt,...row}=candidate;forecasts.push({...row,model_hash:row.forecast.manifestHash});source.sources.push({source_hash:row.input_hash,source_url:'urn:edge-lab:winner-inputs',fetched_at:inputObservedAt,body:inputEvidence});}
   }
   const settlements=winnerOutcomeRevisions(pending,source.finals,source.sources,issuedAt);
   const payload={p_manifests:manifests,p_sources:[...new Map(source.sources.map(s=>[s.source_hash,s])).values()],p_forecasts:forecasts,p_outcomes:settlements.rows,p_status:{status:'RESEARCH_ONLY',generatedAt:issuedAt,action:body.action,coverage:source.coverage,candidates:forecasts.length,excluded:excluded.length,excludedEvents:excluded.slice(0,200),outcomeConflicts:settlements.conflicts.length,scheduleSourceConflicts:source.coverage.scheduleSourceConflictCount??0,checkedEvents:pending.map(p=>({sport:p.sport,event_id:p.event_id})),productionEligible:false,productionWeight:0}};
   phase='append';const saved=await database.append(payload);
   return res.status(200).json({...publicStatus(saved),status:'COLLECTED',generatedAt:issuedAt,captured:saved?.captured??0,coverage:source.coverage,excluded:excluded.length,outcomeConflicts:settlements.conflicts.length});
  }catch(error){
   const category=['AbortError','TimeoutError'].includes(error?.name)?'TIMEOUT':error?.code==='DATABASE_HTTP_ERROR'?'DATABASE_HTTP_ERROR':'OPERATION_ERROR';
   const appendStatus=phase==='append'?'UNKNOWN':'NOT_ATTEMPTED';
   try{logger({event:'winner_collection_failure',phase,category,elapsedMs:Math.max(0,Date.now()-requestStarted),commitStatus:appendStatus});}catch{}
   // The append may have committed after the connection timed out. The DB's
   // immutable unique keys make a later action retry safe; do not spend another
   // append budget or claim that this request rolled back.
   if(phase==='append')res.setHeader('Retry-After','5');
   return res.status(503).json({error:phase==='append'?'WINNER_APPEND_UNCONFIRMED':'WINNER_COLLECTION_UNAVAILABLE',phase,appendStatus,retryable:true,...(req.method==='POST'?{retryAction:body.action}:{}),productionEligible:false,productionWeight:0});
  }
 };
}
export default createWinnerHandler();
