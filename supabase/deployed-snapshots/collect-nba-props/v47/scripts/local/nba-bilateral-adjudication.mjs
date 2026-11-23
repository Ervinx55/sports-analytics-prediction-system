import {createHash} from 'node:crypto';
import {sourceFingerprint} from './nba-verified-bdl.mjs';
import {reviewedWireShape} from './nba-reviewed-wire-shape.mjs';
import corrections from '../../docs/evaluations/nba-bilateral-2026-11-09/corrections.json' with {type:'json'};
export const bilateralContract=createHash('sha256').update(JSON.stringify(corrections)).digest('hex');
const check=(ok,why)=>{if(!ok)throw Error('BILATERAL_'+why);};
const norm=x=>String(x??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
const equal=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
/** Pinned official adjudications, applied to copies of both raw provider records.
 * Team aggregates use player sums (NBA team totals can include team rebounds).
 * A wrongly attributed native identity is excluded, never aliased to another person.
 */
export function applyBilateralAdjudication(source,backup){
 const matches=corrections.filter(c=>c.eventID===source.eventID);
 if(!matches.length)return {source,backup,evidence:null};
 check(matches.length===1,'EVENT_NOT_UNIQUE');const c=matches[0];
 const wire=reviewedWireShape(source,c.sourceFingerprint);source=wire.source;
 check(sourceFingerprint(source)===c.sourceFingerprint,'SOURCE_CHANGED');
 check(backup.id===c.bdlGameID&&source.status.startsAt===c.startsAt,'GAME_IDENTITY');
 const s=structuredClone(source),b=structuredClone(backup);
 const backupRows=(teamID)=>{
  const side=['home','away'].find(side=>s.teams[side].teamID===teamID);
  check(side&&c[side]===teamID,'TEAM_IDENTITY');
  const bt=b[side==='home'?'home_team':'visitor_team'];
  const team=x=>norm(x).replace(/^losangelesclippers$/,'laclippers');
  check(team(bt?.full_name)===team(s.teams[side].names.long),'TEAM_IDENTITY');
  check(Array.isArray(bt.players),'MISSING_ROSTER');return bt.players;
 };
 const player=(id,teamID,name)=>{
  const rows=backupRows(teamID).filter(r=>r.player?.id===id);
  check(rows.length===1&&norm(rows[0].player.first_name+' '+rows[0].player.last_name)===norm(name),'PLAYER_IDENTITY');return rows[0];
 };
 for(const i of c.identityCorrections){
  const p=s.players[i.playerID];check(p?.playerID===i.playerID,'NATIVE_IDENTITY');
  if(i.action==='correct_team'){
   check(p.teamID===i.before&&norm(p.name)===norm(i.name),'NATIVE_IDENTITY');
   player(i.bdlPlayerID,i.after,i.name);p.teamID=i.after;
  }else if(i.action==='exclude_misattributed_native_identity'){
   check(equal(p,i.originalPlayer)&&equal(s.results.game[i.playerID],i.originalStats),'NATIVE_IDENTITY');
   player(i.bdlPlayerID,i.teamID,i.name);
   delete s.players[i.playerID];delete s.results.game[i.playerID];
  }else check(false,'UNKNOWN_IDENTITY_ACTION');
 }
 for(const change of c.corrections){
  let row;
  if(change.provider==='BALLDONTLIE')row=player(change.playerID,change.teamID,change.name);
  else {
   check(change.provider==='SportsGameOdds','UNKNOWN_PROVIDER');
   backupRows(change.teamID);
   if(change.playerID){const p=s.players[change.playerID];check(p?.teamID===change.teamID&&norm(p.name)===norm(change.name),'NATIVE_IDENTITY');}
   else check(['home','away'].includes(change.side)&&s.teams[change.side].teamID===change.teamID,'TEAM_IDENTITY');
   row=s.results.game[change.playerID??change.side];
  }
  check(row,'MISSING_STATS');
  for(const [field,[before,after]] of Object.entries(change.fields)){
   check(row[field]===before,'STATS_CHANGED');
   check(typeof after==='number'?Number.isFinite(after):field==='min'&&/^\d+:[0-5]\d$/.test(after),'INVALID_CORRECTION');
   row[field]=after;
  }
 }
 return {source:s,backup:b,evidence:{...c,contract:bilateralContract,...(wire.evidence?{wireCompatibility:wire.evidence}:{}),teamAggregateBasis:'sum of official player statistics',originalProvidersPreserved:true}};
}
