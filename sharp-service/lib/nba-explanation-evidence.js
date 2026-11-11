// Presentation evidence only. Never imported by a forecast, collector or approval gate.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const sum=a=>a.reduce((s,x)=>s+x,0);
const minutes=x=>typeof x==='string'&&/^\d+:[0-5]\d$/.test(x)?Number(x.split(':')[0])+Number(x.split(':')[1])/60:NaN;
const before=(x,t)=>Number.isFinite(Date.parse(x))&&Date.parse(x)<=t;
const positions=new Set(['G','F','C','G-F','F-G','F-C','C-F','PG','SG','SF','PF']);
// One response can contain hundreds of markets from the same archive snapshot.
const preparedSnapshots=new WeakMap();
function officialRow(original,p,s){
 const a=s.backupEvidence?.officialBilateralAdjudication;
 if(!a)return original;
 let url;try{url=new URL(a.source);}catch{return original;}
 if(url.protocol!=='https:'||url.hostname!=='www.nba.com'||!/^\d{10}$/.test(a.officialGameID)||!url.pathname.includes('/'+a.officialGameID+'/')||![a.sourceSha256,a.sourceFingerprint,a.contract].every(x=>/^[a-f0-9]{64}$/.test(x))||a.originalProvidersPreserved!==true||'sgo:'+a.eventID!==s.id||a.bdlGameID!==s.backupEvidence.bdlGameID||Date.parse(a.startsAt)!==Date.parse(s.startsAt)||![a.home,a.away].includes(p.teamId))return original;
 const rows=(a.corrections||[]).filter(c=>c.provider==='BALLDONTLIE'&&c.playerID===original.player.id);
 const x={...original},seen=new Set();
 for(const c of rows){
  if(c.teamID!==p.teamId)return null;
  for(const [field,pair] of Object.entries(c.fields||{})){
   if(!['min','pts','reb','ast','fga','fta','turnover'].includes(field))continue;
   if(seen.has(field)||!Array.isArray(pair)||pair.length!==2||original[field]!==pair[0])return null;
   if(field==='min'?!finite(minutes(pair[1])):!Number.isInteger(pair[1])||pair[1]<0)return null;
   seen.add(field);x[field]=pair[1];
  }
 }
 return x;
}
function verifiedPlayers(item,cutoff){
 const s=item.summary,b=s.backupEvidence,r=item.raw;
 if(!b||!r||r.id!==b.bdlGameID||r.status!=='Final'||!b.sourceSha256||b.sourceSha256!==item.archiveSha256||!before(b.retrievedAt,cutoff))return [];
 const raw=[...(r.home_team?.players||[]).map(p=>({...p,archiveSide:'home_team'})),...(r.visitor_team?.players||[]).map(p=>({...p,archiveSide:'visitor_team'}))];
 return (s.players||[]).flatMap(p=>{
  let mappings=(b.playerCrosswalk||[]).filter(x=>x.sgoPlayerID===p.id&&x.teamId===p.teamId);
  // Accepted backup summaries preserve provider-native IDs for players absent
  // from SGO's roster. Their numeric identity is already exact, not a name alias.
  if(!mappings.length&&s.sourceContract==='sgo-nba-bdl-backup-v1'&&/^bdl:[1-9]\d*$/.test(p.id)){
   const id=Number(p.id.slice(4)),rows=raw.filter(x=>x.player?.id===id);
   if(!Number.isSafeInteger(id)||rows.length!==1)return [];
   const side=rows[0].archiveSide;
   const anchors=(b.playerCrosswalk||[]).filter(c=>raw.some(x=>x.archiveSide===side&&x.player?.id===c.bdlPlayerID)&&s.players.some(x=>x.id===c.sgoPlayerID&&x.teamId===c.teamId));
   if(!anchors.length||anchors.some(c=>c.teamId!==p.teamId)||s.players.some(x=>x.id!==p.id&&(b.playerCrosswalk||[]).some(c=>c.sgoPlayerID===x.id&&c.bdlPlayerID===id)))return [];
   mappings=[{bdlPlayerID:id}];
  }
  if(mappings.length!==1)return [];
  const rows=raw.filter(x=>x.player?.id===mappings[0].bdlPlayerID);
  if(rows.length!==1)return [];
  const x=officialRow(rows[0],p,s);if(!x)return [];
  const m=minutes(x.min);
  if(!finite(m)||!finite(p.minutes)||Math.abs(p.minutes*60-Math.round(p.minutes*60))>1e-6||Math.abs(Math.round(m*60)-Math.round(p.minutes*60))>1||x.pts!==p.points||x.reb!==p.rebounds||x.ast!==p.assists)return [];
  return [{...p,archiveSide:x.archiveSide,position:positions.has(x.player.position)?x.player.position:null,fga:x.fga,fta:x.fta,tov:x.turnover}];
 });
}
export function explanationContext(snapshot,target,market,cutoff=new Date().toISOString()){
 const time=Date.parse(cutoff),limit=Math.min(time,Date.parse(target.startsAt)||time);
 let prepared=preparedSnapshots.get(snapshot);
 if(!prepared||prepared.time!==time){
  const seen=new Set();
  const rows=(snapshot?.history||[]).filter(i=>{const s=i.summary;return before(s?.startsAt,time)&&before(s?.observedAt,time)&&Array.isArray(s.teams)&&s.teams.length===2;}).sort((a,b)=>Date.parse(b.summary.startsAt)-Date.parse(a.summary.startsAt)).filter(i=>{if(seen.has(i.summary.id))return false;seen.add(i.summary.id);return true;}).map(i=>({...i,verified:verifiedPlayers(i,time)}));
  prepared={time,rows};if(snapshot)preparedSnapshots.set(snapshot,prepared);
 }
 const history=prepared.rows.filter(i=>i.summary.id!==target.eventID&&before(i.summary.startsAt,limit-1));
 const source='Reconciled SportsGameOdds / archived BALLDONTLIE; recorded NBA official corrections where present';
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
