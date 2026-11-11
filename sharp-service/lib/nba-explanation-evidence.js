// Presentation evidence only. Never imported by a forecast, collector or approval gate.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const sum=a=>a.reduce((s,x)=>s+x,0);
const minutes=x=>typeof x==='string'&&/^\d+:\d{2}$/.test(x)?Number(x.split(':')[0])+Number(x.split(':')[1])/60:NaN;
const before=(x,t)=>Number.isFinite(Date.parse(x))&&Date.parse(x)<=t;
const positions=new Set(['G','F','C','G-F','F-G','F-C','C-F']);
function verifiedPlayers(item,cutoff){
 const s=item.summary,b=s.backupEvidence,r=item.raw;
 if(!b||!r||r.id!==b.bdlGameID||r.status!=='Final'||!b.sourceSha256||b.sourceSha256!==item.archiveSha256||!before(b.retrievedAt,cutoff))return [];
 const raw=[...(r.home_team?.players||[]).map(p=>({...p,archiveSide:'home_team'})),...(r.visitor_team?.players||[]).map(p=>({...p,archiveSide:'visitor_team'}))];
 return (s.players||[]).flatMap(p=>{
  const mappings=(b.playerCrosswalk||[]).filter(x=>x.sgoPlayerID===p.id&&x.teamId===p.teamId);
  if(mappings.length!==1)return [];
  const rows=raw.filter(x=>x.player?.id===mappings[0].bdlPlayerID);
  if(rows.length!==1)return [];
  const x=rows[0],m=minutes(x.min);
  if(!finite(m)||!finite(p.minutes)||Math.abs(m-p.minutes)>1/60||x.pts!==p.points||x.reb!==p.rebounds||x.ast!==p.assists)return [];
  return [{...p,archiveSide:x.archiveSide,position:positions.has(x.player.position)?x.player.position:null,fga:x.fga,fta:x.fta,tov:x.turnover}];
 });
}
export function explanationContext(snapshot,target,market,cutoff=new Date().toISOString()){
 const time=Date.parse(cutoff),limit=Math.min(time,Date.parse(target.startsAt)||time);
 const seen=new Set();
 const history=(snapshot?.history||[]).filter(i=>{const s=i.summary;return s?.id!==target.eventID&&before(s?.startsAt,limit-1)&&before(s?.observedAt,time)&&Array.isArray(s.teams)&&s.teams.length===2;}).sort((a,b)=>Date.parse(b.summary.startsAt)-Date.parse(a.summary.startsAt)).filter(i=>{if(seen.has(i.summary.id))return false;seen.add(i.summary.id);return true;}).map(i=>({...i,verified:verifiedPlayers(i,time)}));
 const source='Reconciled SportsGameOdds / archived BALLDONTLIE';
 function fact(value,games,samples,method){return {value:games.length>=3&&finite(value)?Math.round(value*100)/100:null,source,cutoff,observedAt:games.length?new Date(Math.max(...games.map(g=>Date.parse(g.summary.observedAt)),...games.map(g=>Date.parse(g.summary.backupEvidence?.retrievedAt)||0))).toISOString():null,gameCount:games.length,sampleCount:samples,method,missingReason:'At least three eligible games with matching archived evidence are required.'};}
 const opponents=history.filter(h=>h.summary.teams.some(t=>t.id===target.opponentTeamId)).slice(0,10);
 const defenseGames=opponents.filter(h=>h.summary.teams.every(t=>finite(t.points)&&t.points>=0&&finite(t.possessions)&&t.possessions>0));
 const defense=100*sum(defenseGames.map(h=>h.summary.teams.find(t=>t.id!==target.opponentTeamId).points))/sum(defenseGames.map(h=>sum(h.summary.teams.map(t=>t.possessions))/2));
 const own=history.filter(h=>h.summary.players?.some(p=>p.id===target.playerID&&p.teamId===target.teamId&&p.minutes>0)).slice(0,10);
 const position=own.flatMap(h=>h.verified.filter(p=>p.id===target.playerID&&p.teamId===target.teamId&&p.position))[0]?.position;
 const dvpGames=position&&['points','rebounds','assists'].includes(market)?opponents.filter(h=>{
  const team=h.verified.filter(p=>p.teamId!==target.opponentTeamId&&p.minutes>0),all=h.summary.players.filter(p=>p.teamId!==target.opponentTeamId&&p.minutes>0);
  const side=team[0]?.archiveSide,raw=h.raw?.[side]?.players;
  return team.length===all.length&&team.every(p=>p.position&&p.archiveSide===side)&&Array.isArray(raw)&&raw.filter(p=>minutes(p.min)>0).length===team.length&&team.some(p=>p.position===position);
 }):[];
 const appearances=dvpGames.flatMap(h=>h.verified.filter(p=>p.teamId!==target.opponentTeamId&&p.position===position&&p.minutes>0));
 const usage=own.flatMap(h=>{
  const team=h.verified.filter(p=>p.teamId===target.teamId),all=h.summary.players.filter(p=>p.teamId===target.teamId),p=team.find(p=>p.id===target.playerID);
  if(!p||team.length!==all.length||!team.every(p=>[p.fga,p.fta,p.tov,p.minutes].every(x=>finite(x)&&x>=0))||p.minutes<=0)return [];
  const rawTeam=h.raw?.[p.archiveSide]?.players;
  if(!Array.isArray(rawTeam)||team.some(x=>x.archiveSide!==p.archiveSide)||rawTeam.filter(x=>minutes(x.min)>0).length!==team.filter(x=>x.minutes>0).length||rawTeam.some(x=>!finite(minutes(x.min))&&[x.pts,x.fga,x.fta,x.turnover].some(v=>finite(v)&&v>0))||sum(team.map(x=>x.minutes))<239.5)return [];
  const denom=sum(team.map(p=>p.fga+.44*p.fta+p.tov));
  if(denom<=0)return [];
  return [{h,value:100*(p.fga+.44*p.fta+p.tov)*(sum(team.map(p=>p.minutes))/5)/(p.minutes*denom)}];
 });
 return {contract:'nba-explanation-only-v1',productionEligible:false,productionWeight:0,position:position||null,features:{
  opponentDefensiveRating:fact(defense,defenseGames,defenseGames.length,'Last up to 10 accepted opponent games; points conceded / mean of both teams’ estimated possessions × 100. No league rank.'),
  defenseVsPosition:fact(sum(appearances.map(p=>p[market]))/appearances.length,dvpGames,appearances.length,`Last up to 10 opponent games; ${market} per positive-minute opposing player appearance with exact archived listed position ${position||'unknown'}. Broad roster label, not assigned defender; not minutes-adjusted.`),
  historicalUsage:fact(sum(usage.map(x=>x.value))/usage.length,usage.map(x=>x.h),usage.length,'Historical box-score usage estimate; mean of up to 10 same-team games. 100 × (FGA + 0.44 FTA + TOV) × (team minutes / 5) / (player minutes × team (FGA + 0.44 FTA + TOV)). Not projected usage.'),
  expectedMinutes:fact(sum(own.map(h=>h.summary.players.find(p=>p.id===target.playerID&&p.teamId===target.teamId).minutes))/own.length,own,own.length,'Mean of last up to 10 positive-minute same-team games; not a confirmed rotation or projection.')
 }};
}
