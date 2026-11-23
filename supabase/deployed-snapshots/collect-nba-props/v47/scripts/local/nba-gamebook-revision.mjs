import {createHash} from 'node:crypto';
import {sourceFingerprint} from './nba-verified-bdl.mjs';
import manifest from '../../docs/evaluations/nba-gamebooks-2026-11-12/corrections.json' with {type:'json'};
const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
const hash=x=>createHash('sha256').update(JSON.stringify(ordered(x))).digest('hex');
export const gamebookRevisionDigest=hash(manifest);
const check=(ok,why)=>{if(!ok)throw Error('GAMEBOOK_'+why);};
/** Independent, versioned source-data repair; never changes frozen model artifacts.
 * Entire reviewed provider inputs must match. New upstream changes require review.
 */
export function applyGamebookRevision(source,backup){
 const entries=manifest.filter(c=>c.eventID===source.eventID);
 if(!entries.length)return {source,backup,evidence:null};
 check(entries.length===1,'DUPLICATE_EVENT');const c=entries[0];
 check(sourceFingerprint(source)===c.sourceFingerprint,'SOURCE_CHANGED');
 check(hash(backup)===c.backupFingerprint,'BACKUP_CHANGED');
 check(backup.id===c.bdlGameID&&source.status.startsAt===c.startsAt,'GAME_IDENTITY');
 const s=structuredClone(source),b=structuredClone(backup);
 for(const change of c.corrections){
  check(s.teams[change.side]?.teamID===change.teamID,'TEAM_IDENTITY');let row;
  if(change.provider==='BALLDONTLIE'){
   const rows=b[change.side==='home'?'home_team':'visitor_team'].players.filter(r=>r.player.id===change.playerID);
   check(rows.length===1,'PLAYER_IDENTITY');row=rows[0];
  }else if(change.provider==='SportsGameOddsIdentity')row=s.players[change.playerID];
  else {check(change.provider==='SportsGameOdds','PROVIDER');row=s.results.game[change.playerID??change.side];}
  check(row,'MISSING_ROW');
  for(const[field,[before,after]]of Object.entries(change.fields)){check(row[field]===before,'FIELD_CHANGED');row[field]=after;}
 }
 return {source:s,backup:b,evidence:{...c,contract:gamebookRevisionDigest,validationReviewRequired:true}};
}
export function historyInputRevisions(history){
 return [...new Set(history.map(g=>g?.backupEvidence?.officialGamebookRevision?.contract).filter(Boolean))].sort();
}
