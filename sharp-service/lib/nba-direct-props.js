// Bounded fallback for the existing NBA quote contract when the web API is down.
export async function directSgoProps({page,clock}){
 const now=clock(),patterns=['points','rebounds','assists'].flatMap(m=>['over','under'].map(s=>`${m}-PLAYER_ID-game-ou-${s}`));
 const result=await page({leagueID:'NBA',type:'match',oddIDs:patterns.join(','),bookmakerID:'draftkings',oddsAvailable:'true',finalized:'false',startsAfter:now,startsBefore:new Date(Date.parse(now)+48*3600000).toISOString(),limit:'8'});
 const events=[];
 for(const e of result.events){
  if(e.leagueID!=='NBA'||e.type!=='match'||!e.eventID||e.status?.started||e.status?.live||e.status?.completed||e.status?.finalized||e.status?.cancelled||!(Date.parse(e.status?.startsAt)>Date.parse(now)))continue;
  const props=new Map();
  for(const o of Object.values(e.odds??{})){
   const playerID=o.playerID||o.statEntityID,side=o.sideID,market=o.statID;
   if(!['points','rebounds','assists'].includes(market)||!['over','under'].includes(side)||o.periodID!=='game'||o.betTypeID!=='ou'||o.oddID!==`${market}-${playerID}-game-ou-${side}`||e.players?.[playerID]?.playerID!==playerID)continue;
   const b=o.byBookmaker?.draftkings;
   if(!b||b.available===false||b.overUnder==null||b.overUnder===''||b.odds==null||b.odds==='')continue;
   const line=Number(b.overUnder),odds=Number(b.odds);
   if(!Number.isFinite(line)||line<0||!Number.isFinite(odds)||Math.abs(odds)<100)continue;
   const key=JSON.stringify([playerID,market,line]);
   if(!props.has(key))props.set(key,{playerID,playerName:e.players[playerID].name||playerID,statID:market});
   props.get(key)[side]={books:{draftkings:{line,odds,available:true,updatedAt:b.lastUpdatedAt??null}}};
  }
  events.push({eventID:'sgo:'+e.eventID,provider:'SportsGameOdds',startsAt:e.status.startsAt,players:[...props.values()].map(prop=>{
   const teamId=e.players[prop.playerID].teamID,teams=[e.teams?.home?.teamID,e.teams?.away?.teamID];
   const valid=teams.every(t=>typeof t==='string'&&t.endsWith('_NBA'))&&teams[0]!==teams[1]&&teams.includes(teamId);
   return {prop,...(valid?{explanationBinding:{contract:'sgo-event-roster-v1',eventID:'sgo:'+e.eventID,playerID:prop.playerID,startsAt:e.status.startsAt,teamId,opponentTeamId:teams.find(t=>t!==teamId)}}:{})};
  })});
 }
 return {generatedAt:result.observedAt,events,partialCoverage:true,source:'DIRECT_SGO_BOUNDED_FALLBACK'};
}
