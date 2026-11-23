// Bounded quote collection. Exhaust the event cursor instead of dropping game nine.
export const NBA_PROP_PAGE_SIZE=16;
const MAX_PAGES=2;
const sourceName=value=>typeof value==='string'&&value.trim()?value.trim():null;
const teamName=team=>sourceName(team?.names?.long)||sourceName(team?.names?.medium);
const sourceNumber=value=>{
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value!=='string'||!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))return null;
 const result=Number(value);return Number.isFinite(result)?result:null;
};
export async function directSgoProps({page,clock}){
 const now=clock(),patterns=['points','rebounds','assists'].flatMap(m=>['over','under'].map(s=>`${m}-PLAYER_ID-game-ou-${s}`));
 const params={leagueID:'NBA',type:'match',oddIDs:patterns.join(','),bookmakerID:'draftkings',oddsAvailable:'true',finalized:'false',startsAfter:now,startsBefore:new Date(Date.parse(now)+48*3600000).toISOString(),limit:String(NBA_PROP_PAGE_SIZE)};
 const rawEvents=new Map(),timestamps=[],reasons=[],seenCursors=new Set();
 let cursor=null,pagesFetched=0,eventsComplete=false;
 for(let i=0;i<MAX_PAGES;i++){
  let result;
  try{result=await page({...params,...(cursor?{cursor}:{})});}
  catch(error){if(!pagesFetched)throw error;reasons.push('PAGE_UNAVAILABLE');break;}
  pagesFetched++;timestamps.push(result.observedAt);
  for(const e of result.events)if(e?.eventID&&!rawEvents.has(e.eventID))rawEvents.set(e.eventID,e);
  if(result.nextCursor===null||result.nextCursor===undefined||result.nextCursor===''){eventsComplete=true;break;}
  if(typeof result.nextCursor!=='string'||result.nextCursor.length>2048||seenCursors.has(result.nextCursor)){reasons.push('INVALID_CURSOR');break;}
  cursor=result.nextCursor;seenCursors.add(cursor);
  if(i===MAX_PAGES-1)reasons.push('PAGE_LIMIT_REACHED');
 }
 const events=[];
 for(const e of rawEvents.values()){
  if(e.leagueID!=='NBA'||e.type!=='match'||!e.eventID||e.status?.started||e.status?.live||e.status?.completed||e.status?.finalized||e.status?.cancelled||!(Date.parse(e.status?.startsAt)>Date.parse(now)))continue;
  const props=new Map();
  for(const o of Object.values(e.odds??{})){
   const playerID=o.playerID||o.statEntityID,side=o.sideID,market=o.statID;
   if(!['points','rebounds','assists'].includes(market)||!['over','under'].includes(side)||o.periodID!=='game'||o.betTypeID!=='ou'||o.oddID!==`${market}-${playerID}-game-ou-${side}`||e.players?.[playerID]?.playerID!==playerID)continue;
   const b=o.byBookmaker?.draftkings;
   if(!b)continue;
   const line=sourceNumber(b.overUnder),odds=sourceNumber(b.odds);
   if(line===null||line<0||odds===null||Math.abs(odds)<100)continue;
   const key=JSON.stringify([playerID,market,line]);
   if(!props.has(key))props.set(key,{playerID,playerName:sourceName(e.players[playerID].name),statID:market});
   // Keep suspended or unconfirmed sides for diagnostics. Missing availability
   // is not affirmative evidence that the book is offering this price.
   props.get(key)[side]={books:{draftkings:{line,odds,available:b.available===true,updatedAt:b.lastUpdatedAt??null}}};
  }
  events.push({eventID:'sgo:'+e.eventID,provider:'SportsGameOdds',startsAt:e.status.startsAt,matchup:{home:{name:teamName(e.teams?.home)},away:{name:teamName(e.teams?.away)}},players:[...props.values()].map(prop=>{
   const teamId=e.players[prop.playerID].teamID,teams=[e.teams?.home?.teamID,e.teams?.away?.teamID];
   const valid=teams.every(t=>typeof t==='string'&&t.endsWith('_NBA'))&&teams[0]!==teams[1]&&teams.includes(teamId);
   return {prop:{...prop,identityStatus:valid?'PROVIDER_ROSTER_MATCHED':'UNVERIFIED'},...(valid?{explanationBinding:{contract:'sgo-event-roster-v1',eventID:'sgo:'+e.eventID,playerID:prop.playerID,startsAt:e.status.startsAt,teamId,opponentTeamId:teams.find(t=>t!==teamId)}}:{})};
  })});
 }
 const generatedAt=timestamps.sort((a,b)=>Date.parse(a)-Date.parse(b))[0];
 return {generatedAt,events,partialCoverage:true,coverage:{pagesFetched,eventsComplete,reasons,returnedEvents:events.length,bookmakers:['draftkings'],markets:['points','rebounds','assists']},source:'DIRECT_SGO_BOUNDED_FALLBACK'};
}
