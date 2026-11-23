import {createHash} from 'node:crypto';
import {parseSgoNbaSummary} from './sgo-nba-history.mjs';
const name=v=>typeof v==='string'?v.normalize('NFKD').replace(/[\u0300-\u036f.]/g,'').replace(/’/g,"'").trim().toLowerCase().replace(/\s+/g,' '):'';
const integer=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const time=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
export function repairSgoWithArchive(e,archive,observedAt,year){
 try{parseSgoNbaSummary(e,observedAt,year);throw Error('BACKUP_NOT_NEEDED');}catch(err){if(!['SGO_INCOMPLETE_BOXSCORE','SGO_INCOMPLETE_PLAYER_STATS'].includes(err.message))throw err;}
 const now=time(observedAt),start=time(e.status.startsAt);
 if(archive?.version!=='nba-verified-backup-v1'||!Array.isArray(archive.games)||!Number.isFinite(time(archive.generatedAt))||time(archive.generatedAt)>now||!/^\w{64}$/.test(archive.sourceSha256??''))throw Error('BACKUP_PROVENANCE_INVALID');
 const teams=['home','away'].map(side=>({side,id:e.teams[side].teamID,name:name(e.teams[side].names?.long),stats:e.results.game[side]}));
 if(teams.some(t=>!t.name))throw Error('BACKUP_TEAM_NAME_MISSING');
 for(const [id,p] of Object.entries(e.players??{}))if(teams.some(t=>t.id===p.teamID)&&(p.playerID!==id||!id.endsWith('_NBA')))throw Error('BACKUP_SOURCE_IDENTITY_CONFLICT');
 for(const [id,r] of Object.entries(e.results.game)){
  if(['home','away','all'].includes(id))continue;
  if(!id.endsWith('_NBA')||!integer(r.secondsPlayed)||r.secondsPlayed>4200)throw Error('BACKUP_SOURCE_MINUTES_INVALID');
  if(r.secondsPlayed>0&&(!e.players?.[id]||e.players[id].playerID!==id||!teams.some(t=>t.id===e.players[id].teamID)))throw Error('BACKUP_SOURCE_IDENTITY_CONFLICT');
 }
 const candidates=archive.games.filter(g=>Number.isFinite(time(g.startsAt))&&Math.abs(time(g.startsAt)-start)<=7200000&&g.startsAt.slice(0,10)===e.status.startsAt.slice(0,10)&&Array.isArray(g.teams)&&g.teams.length===2&&teams.every(t=>g.teams.filter(b=>b.names?.some(n=>name(n)===t.name)&&b.points===t.stats.points).length===1));
 if(candidates.length!==1)throw Error('BACKUP_GAME_AMBIGUOUS_OR_MISSING');
 const g=candidates[0];if(!Number.isFinite(time(g.observedAt))||time(g.observedAt)>now||time(g.observedAt)<=time(g.startsAt)||!Array.isArray(g.players)||new Set(g.players.map(p=>p.id)).size!==g.players.length)throw Error('BACKUP_INVALID_GAME');
 const mappedTeams=teams.map(t=>({...t,backup:g.teams.find(b=>b.names.some(n=>name(n)===t.name))}));
 if(new Set(mappedTeams.map(t=>t.backup.id)).size!==2||g.players.some(p=>!mappedTeams.some(t=>t.backup.id===p.teamId)))throw Error('BACKUP_INVALID_TEAM_MAPPING');
 const players=[],seen=new Set();
 for(const t of mappedTeams){
  const rows=g.players.filter(p=>p.teamId===t.backup.id);
  if(rows.length<5||rows.some(p=>typeof p.minutes!=='number'||!Number.isFinite(p.minutes)||p.minutes<=0||p.minutes>70||['points','rebounds','assists'].some(k=>!integer(p[k]))))throw Error('BACKUP_INVALID_PLAYER_STATS');
  const minutes=rows.reduce((s,p)=>s+p.minutes,0),overtime=Math.round((minutes-240)/25);
  if(overtime<0||overtime>6||Math.abs(minutes-(240+overtime*25))>rows.length*.5+.5)throw Error('BACKUP_INCOMPLETE_MINUTES');
  for(const k of ['points','rebounds','assists'])if(!integer(t.stats[k])||rows.reduce((s,p)=>s+p[k],0)!==t.stats[k])throw Error('BACKUP_TEAM_TOTAL_CONFLICT');
  if(['fieldGoalsAttempted','freeThrowsAttempted','offensiveRebounds','turnovers'].some(k=>!integer(t.stats[k])))throw Error('BACKUP_TEAM_TOTAL_MISSING');
  const possessions=t.stats.fieldGoalsAttempted+.44*t.stats.freeThrowsAttempted-t.stats.offensiveRebounds+t.stats.turnovers;
  if(!Number.isFinite(t.backup.possessions)||Math.abs(t.backup.possessions-possessions)>1e-6)throw Error('BACKUP_POSSESSION_CONFLICT');
  const sourcePlayers=Object.entries(e.players).filter(([,p])=>p.teamID===t.id);let corroborated=0;
  for(const [id,p] of sourcePlayers){
   const matches=rows.filter(b=>b.names?.some(n=>name(n)===name(p.name))&&name(p.name));const r=e.results.game[id];
   if(r?.secondsPlayed===0){if(matches.length)throw Error('BACKUP_DNP_CONFLICT');continue;}
   if(matches.length!==1)throw Error('BACKUP_PLAYER_MAPPING_UNVERIFIED');
   const b=matches[0];if(r){if(['points','rebounds','assists'].some(k=>!integer(r[k])||r[k]!==b[k])||!Number.isFinite(r.secondsPlayed)||Math.abs(r.secondsPlayed/60-b.minutes)>1.01)throw Error('BACKUP_PLAYER_STATS_CONFLICT');corroborated++;}
  }
  if(corroborated<5)throw Error('BACKUP_INSUFFICIENT_CORROBORATION');
  for(const b of rows){
   const matches=sourcePlayers.filter(([,p])=>name(p.name)&&b.names?.some(n=>name(n)===name(p.name)));
   if(matches.length>1)throw Error('BACKUP_PLAYER_MAPPING_AMBIGUOUS');
   const id=matches.length?matches[0][0]:`backup:espn:${b.id}`;
   if(seen.has(id))throw Error('BACKUP_DUPLICATE_PLAYER');seen.add(id);
   players.push({id,teamId:t.id,minutes:b.minutes,points:b.points,rebounds:b.rebounds,assists:b.assists,starter:b.starter??null});
  }
 }
 return {id:`sgo:${e.eventID}`,startsAt:e.status.startsAt,observedAt,source:'SportsGameOdds corroborated ESPN archive',sourceContract:'sgo-nba-archived-backup-v1',teams:mappedTeams.map(t=>({id:t.id,points:t.stats.points,possessions:t.backup.possessions})),players,backupEvidence:{source:'Previously captured ESPN archive',gameID:g.id,sourceObservedAt:g.observedAt,sourceStartsAt:g.startsAt,archiveSha256:createHash('sha256').update(JSON.stringify(archive)).digest('hex'),matchedAt:observedAt}};
}
