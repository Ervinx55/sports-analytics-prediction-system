// Result facts only. These namespaces are provider identities, never a name crosswalk.
const id = v => (typeof v==='string' && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v)>0 || Number.isSafeInteger(v) && v>0) ? String(v) : null;
export const resultNumber = v => typeof v==='number' && Number.isFinite(v) ? v : typeof v==='string' && /^-?\d+(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v)) ? Number(v) : null;
const score = v => {const n=resultNumber(v);return Number.isSafeInteger(n)&&n>=0?n:null;};
const iso = v => typeof v==='string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const stable = v => JSON.stringify(sort(v));
function sort(v) {return Array.isArray(v)?v.map(sort):v && typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
const footballStats=['passing_yards','passing_touchdowns','rushing_yards','rushing_touchdowns','receiving_yards','receiving_receptions','receiving_touchdowns'];
export const RESULT_STATS = Object.freeze({
 NFL:footballStats,CFB:footballStats,
 NBA:['points','rebounds','assists','steals','blocks','turnovers','three_pointers','points_rebounds_assists','points_rebounds','points_assists','rebounds_assists'],
 MLB:['batting_hits','batting_totalBases','batting_homeRuns','batting_runs','batting_rbi','pitching_strikeOuts','pitching_strikeouts']
});
const nflFields={passing:{passing_yards:'passingYards',passing_touchdowns:'passingTouchdowns'},rushing:{rushing_yards:'rushingYards',rushing_touchdowns:'rushingTouchdowns'},receiving:{receiving_yards:'receivingYards',receiving_receptions:'receptions',receiving_touchdowns:'receivingTouchdowns'}};
const nbaFields={points:'points',rebounds:'rebounds',assists:'assists',steals:'steals',blocks:'blocks',turnovers:'turnovers',three_pointers:'threePointFieldGoalsMade-threePointFieldGoalsAttempted'};
function blankPlayer(sport,playerId,teamId) {return {playerKey:sport==='MLB'?`mlb:${playerId}`:`espn:${sport.toLowerCase()}:${playerId}`,sourcePlayerId:playerId,teamId,participated:null,ambiguous:false,stats:Object.fromEntries(RESULT_STATS[sport].map(k=>[k,null]))};}
function rawStatAt(group,row,key) {
 if(!Array.isArray(group.keys)||!Array.isArray(row.stats)||group.keys.length!==row.stats.length||group.keys.filter(k=>k===key).length!==1)return null;
 return row.stats[group.keys.indexOf(key)];
}
const statAt=(group,row,key)=>resultNumber(rawStatAt(group,row,key));
function normalizeEspn(p,r) {
 r.sourceEventId=id(p?.header?.id);
 r.eventKey=r.sourceEventId?`espn:${r.sport.toLowerCase()}:${r.sourceEventId}`:null;
 const leagueUid={NFL:'s:20~l:28',NBA:'s:40~l:46',CFB:'s:20~l:23'}[r.sport];
 if(p.header?.league?.uid!==leagueUid||id(p.header?.league?.id)!==leagueUid.split(':').at(-1)||p.header?.uid!==`${leagueUid}~e:${r.sourceEventId}`){r.identityAmbiguous=true;return;}
 const comps=p?.header?.competitions;
 if(!Array.isArray(comps)||comps.length!==1)return;
 const c=comps[0];if(!c||typeof c!=='object')return;
 const teams=c.competitors;
 if(id(c.id)!==r.sourceEventId){r.identityAmbiguous=true;return;}
 if(!Array.isArray(teams)||teams.length!==2||teams.filter(t=>t?.homeAway==='home').length!==1||teams.filter(t=>t?.homeAway==='away').length!==1||!teams.every(t=>id(t?.id))||id(teams[0].id)===id(teams[1].id)){r.identityAmbiguous=true;return;}
 const st=c.status?.type;
 r.status=st?.name==='STATUS_FINAL'&&st.completed===true&&st.state==='post'?'FINAL':st?.name==='STATUS_CANCELED'&&st.completed===false?'CANCELLED':st?.name==='STATUS_POSTPONED'?'POSTPONED':st?.state==='in'?'LIVE':'UNKNOWN';
 const home=teams.find(t=>t.homeAway==='home'),away=teams.find(t=>t.homeAway==='away');
 r.homeScore=score(home.score);r.awayScore=score(away.score);r.homeTeamId=id(home.id);r.awayTeamId=id(away.id);
 const periods=[home.linescores,away.linescores];
 if(periods.every(a=>Array.isArray(a)&&a.length>=4&&a.every(v=>score(v?.displayValue)!==null)) && periods[0].length===periods[1].length){
   r.completedPeriods=periods[0].length;r.overtime=r.completedPeriods>4;r.shortened=false;
   r.regulationScores={home:periods[0].slice(0,4).reduce((n,v)=>n+score(v.displayValue),0),away:periods[1].slice(0,4).reduce((n,v)=>n+score(v.displayValue),0)};
 }
 const seen=new Set();
 for(const team of Array.isArray(p.boxscore?.players)?p.boxscore.players:[]) {
   const teamId=id(team?.team?.id);if(![r.homeTeamId,r.awayTeamId].includes(teamId)){r.identityAmbiguous=true;continue;}
   for(const group of Array.isArray(team.statistics)?team.statistics:[])for(const row of Array.isArray(group?.athletes)?group.athletes:[]) {
     // ESPN also returns negative synthetic Team rows. They are not athlete identities.
     const playerId=id(row?.athlete?.id);if(!playerId)continue;
     const key=`espn:${r.sport.toLowerCase()}:${playerId}`,entry=r.players[key]??blankPlayer(r.sport,playerId,teamId);
     r.players[key]=entry;if(entry.teamId!==teamId)entry.ambiguous=true;
     const groupKey=stable([playerId,group.name??null]);if(seen.has(groupKey))entry.ambiguous=true;seen.add(groupKey);
     if(r.sport==='NBA') {
       if(row.didNotPlay===true)entry.participated=false;
       else if(row.didNotPlay===false&&statAt(group,row,'minutes')>0)entry.participated=true;
       for(const [stat,field] of Object.entries(nbaFields)) {
         if(stat==='three_pointers') {const v=rawStatAt(group,row,field);entry.stats[stat]=typeof v==='string'&&/^\d+-\d+$/.test(v)&&Number(v.split('-')[0])<=Number(v.split('-')[1])?score(v.split('-')[0]):null;}
         else entry.stats[stat]=score(statAt(group,row,field));
       }
       for(const [stat,fields] of Object.entries({points_rebounds_assists:['points','rebounds','assists'],points_rebounds:['points','rebounds'],points_assists:['points','assists'],rebounds_assists:['rebounds','assists']}))entry.stats[stat]=fields.every(k=>entry.stats[k]!==null)?fields.reduce((n,k)=>n+entry.stats[k],0):null;
     } else if(nflFields[group.name]) {
       for(const [stat,field] of Object.entries(nflFields[group.name])){const value=statAt(group,row,field);entry.stats[stat]=Number.isSafeInteger(value)&&(stat.endsWith('_yards')||value>=0)?value:null;}
       // A positive recorded opportunity proves appearance; absent categories do not prove DNP.
       const attempts=rawStatAt(group,row,'completions/passingAttempts');
       const opportunity=group.name==='passing'?typeof attempts==='string'&&/^\d+\/\d+$/.test(attempts)?attempts.split('/')[1]:null:statAt(group,row,group.name==='rushing'?'rushingAttempts':'receivingTargets');
       if(resultNumber(opportunity)>0 || group.name==='receiving'&&entry.stats.receiving_receptions>0)entry.participated=true;
     }
   }
 }
}
function normalizeMlb(p,r) {
 r.sourceEventId=id(p?.gamePk);r.eventKey=r.sourceEventId?`mlb:${r.sourceEventId}`:null;
 if(id(p?.gameData?.game?.pk)!==r.sourceEventId){r.identityAmbiguous=true;return;}
 if(!['home','away'].every(side=>id(p.gameData?.teams?.[side]?.sport?.id)==='1')){r.identityAmbiguous=true;return;}
 const status=p.gameData?.status;
 r.status=status?.abstractGameState==='Final'&&status.codedGameState==='F'&&status.detailedState==='Final'?'FINAL':status?.detailedState==='Cancelled'?'CANCELLED':status?.detailedState==='Postponed'?'POSTPONED':status?.abstractGameState==='Live'?'LIVE':'UNKNOWN';
 const timestamp=p.metaData?.timeStamp;
 if(typeof timestamp==='string'&&/^\d{8}_\d{6}$/.test(timestamp))r.sourceUpdatedAt=iso(`${timestamp.slice(0,4)}-${timestamp.slice(4,6)}-${timestamp.slice(6,8)}T${timestamp.slice(9,11)}:${timestamp.slice(11,13)}:${timestamp.slice(13,15)}Z`);
 r.providerRevision=typeof timestamp==='string'?timestamp:null;
 const lines=p.liveData?.linescore;r.homeScore=score(lines?.teams?.home?.runs);r.awayScore=score(lines?.teams?.away?.runs);
 const inning=score(lines?.currentInning),outs=score(lines?.outs);
 const scheduled=score(lines?.scheduledInnings);
 const state=lines?.inningState;
 const validDuration=inning>0&&scheduled>0&&outs!==null&&outs<=3&&['Top','Bottom','Middle','End'].includes(state)&&(!['Middle','End'].includes(state)||outs===3);
 if(validDuration) {
   // Top of inning N finishes only N-1 whole innings. Do not round a 4.5-inning final to five.
   r.completedPeriods=inning-1+(outs===3&&['Bottom','End'].includes(state)?1:0);
   r.overtime=inning>scheduled;
   if(inning<scheduled)r.shortened=true;
   else if(inning>scheduled || outs===3&&['Bottom','End'].includes(state))r.shortened=false;
   else if(state==='Top'&&outs<3)r.shortened=true;
   else if(r.homeScore!==null&&r.awayScore!==null) {
     // A home lead after the final top half needs no bottom half; a final home lead
     // during the bottom half proves an allowable walkoff ending. An away lead or
     // tie still needs the bottom's third out. Unknown scores cannot prove either.
     r.shortened=!(r.homeScore>r.awayScore && (state==='Bottom'||outs===3&&['Top','Middle'].includes(state)));
   }
 }
 for(const side of ['home','away']) {
   const team=p.liveData?.boxscore?.teams?.[side],teamId=id(team?.team?.id);r[`${side}TeamId`]=teamId;
   if(teamId!==id(p.gameData?.teams?.[side]?.id))r.identityAmbiguous=true;
   for(const [rawKey,row] of Object.entries(team?.players??{})) {
     const playerId=id(row?.person?.id);if(!playerId||rawKey!==`ID${playerId}`){r.identityAmbiguous=true;continue;}
     const entry=blankPlayer('MLB',playerId,teamId);if(r.players[entry.playerKey])entry.ambiguous=true;r.players[entry.playerKey]=entry;
     for(const stat of RESULT_STATS.MLB){const [group,field]=stat.split('_');entry.stats[stat]=score(row.stats?.[group]?.[field==='strikeouts'?'strikeOuts':field]);}
     if(['batting','pitching','fielding'].some(k=>resultNumber(row.stats?.[k]?.gamesPlayed)>0))entry.participated=true;
   }
 }
 if(!r.homeTeamId||!r.awayTeamId||r.homeTeamId===r.awayTeamId)r.identityAmbiguous=true;
}
/** No names, local clocks, team guesses or prediction creation. Unverified adapters return UNKNOWN. */
export function normalizeFinalResult(payload,{sport,source,retrievedAt=null}={}) {
 const r={sport: sport??null,source:source??null,sourceEventId:null,eventKey:null,status:'UNKNOWN',homeScore:null,awayScore:null,homeTeamId:null,awayTeamId:null,regulationScores:null,completedPeriods:null,overtime:null,shortened:null,players:{},identityAmbiguous:false,sourceUpdatedAt:null,providerRevision:null};
 if(payload && typeof payload==='object'&&!Array.isArray(payload)) {
   if(source==='espn'&&['NFL','NBA','CFB'].includes(sport))normalizeEspn(payload,r);
   else if(source==='mlb-statsapi'&&sport==='MLB')normalizeMlb(payload,r);
 }
 // Exact canonical content identity avoids hash collisions and survives provider timestamps omitted on corrections.
 r.sourceRevision=stable(r);r.retrievedAt=iso(retrievedAt);return r;
}
