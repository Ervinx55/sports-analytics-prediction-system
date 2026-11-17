/** Exact reviewed source repairs and an independently timestamped NBA final attestation. */
import {createHash} from 'node:crypto';
import records from '../../docs/evaluations/nba-reviewed-history-2026-11-17/evidence.json' with {type:'json'};
const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
export const evidenceHash=x=>createHash('sha256').update(JSON.stringify(ordered(x))).digest('hex');
export const reviewedHistoryContract=evidenceHash(records);
const sourceFields=['eventID','status','teams','players','results','info','type','leagueID'];
export const reviewedSourceFingerprint=e=>evidenceHash(Object.fromEntries(sourceFields.filter(k=>Object.hasOwn(e,k)).map(k=>[k,e[k]])));
const check=(ok,code)=>{if(!ok)throw Error('NBA_REVIEW_'+code);};
const time=x=>typeof x==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(x)?Date.parse(x):NaN;
const norm=x=>String(x??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const seconds=m=>{check(typeof m==='string'&&/^\d+(?::[0-5]\d)?$/.test(m),'INVALID_MINUTES');const [a,b=0]=m.split(':').map(Number);return 60*a+b;};
const officialSeconds=p=>{if(p.statistics.minutes===''){check(/^DNP\b/.test(p.comment)&&Object.entries(p.statistics).every(([k,v])=>k==='minutes'||v===0),'UNVERIFIED_OFFICIAL_DNP');return 0;}return seconds(p.statistics.minutes);};
const fields={pts:['points','points'],reb:['rebounds','reboundsTotal'],ast:['assists','assists'],fga:['fieldGoalsAttempted','fieldGoalsAttempted'],fta:['freeThrowsAttempted','freeThrowsAttempted'],oreb:['offensiveRebounds','reboundsOffensive'],turnover:['turnovers','turnovers'],blk:['blocks','blocks'],stl:['steals','steals'],pf:['fouls','foulsPersonal'],fgm:['fieldGoalsMade','fieldGoalsMade'],fg3m:['threePointersMade','threePointersMade'],fg3a:['threePointersAttempted','threePointersAttempted'],ftm:['freeThrowsMade','freeThrowsMade'],dreb:['defensiveRebounds','reboundsDefensive'],plus_minus:['plusMinus','plusMinusPoints']};
const find=e=>{const found=records.filter(r=>r.eventID===e.eventID);check(found.length<=1,'DUPLICATE_REVIEW');return found[0];};
function receivedAt(value,now,start){const t=time(value);check(Number.isFinite(t)&&t>start&&t<=now,'EVIDENCE_FROM_FUTURE');return t;}
function receipt(r,now,start,fresh=false){check(r&&(/^https:\/\/www\.nba\.com\/game\/\d{10}\/box-score$/.test(r.url)||/^https:\/\/statsdmz\.nba\.com\/pdfs\/\d{8}\/\d{8}_[A-Z]{6}_book\.pdf$/.test(r.url))&&/^[a-f0-9]{64}$/.test(r.sha256),'OFFICIAL_PROVENANCE');const t=receivedAt(r.retrievedAt,now,start);if(fresh)check(now-t<=6*3600000,'OFFICIAL_EXPIRED');return t;}
function evidenceObservedAt(r,now){
 const start=time(r.startsAt),s=r.sourceReceipt;
 check(s?.provider==='SportsGameOdds'&&typeof s.url==='string'&&s.url.startsWith('https://api.sportsgameodds.com/v2/events?')&&new URL(s.url).searchParams.get('eventIDs')===r.eventID&&/^[a-f0-9]{64}$/.test(s.rawSha256)&&s.eventCount===1&&s.requestedEventIDs?.length===1&&s.requestedEventIDs[0]===r.eventID&&s.missingEventIDs?.length===0,'SOURCE_PROVENANCE');
 const times=[receivedAt(s.receivedAt,now,start)];
 const official=o=>{check(o.html.url==='https://www.nba.com/game/'+o.game.gameId+'/box-score','OFFICIAL_GAME_URL');times.push(receipt(o.html,now,time(o.game.gameTimeUTC)),receipt(o.gamebook,now,time(o.game.gameTimeUTC)));};
 official(r.official);
 for(const p of r.identityRepairs)for(const q of p.identityEvidence){
  // An earlier reviewed alias URL is provenance, not a newly retrieved document.
  if(q.retrievedAt===undefined&&q.sha256===undefined){check(q.url==='https://www.nba.com/game/0022600199/box-score'&&p.playerID==='D_POWELL_1_NBA'&&typeof q.reason==='string','IDENTITY_PROVENANCE');continue;}
  const profile=new RegExp('^https://www\\.nba\\.com/player/'+p.officialPlayerID+'/[a-z0-9-]+$'),unlv=p.officialPlayerID===1641989&&['https://unlvrebels.com/sports/mens-basketball/roster/ej-harkless/15148','https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/unlvrebels.com/documents/2022/10/12/EJ_Harkless.pdf'].includes(q.url);
  check((profile.test(q.url)||unlv)&&/^[a-f0-9]{64}$/.test(q.sha256),'IDENTITY_PROVENANCE');times.push(receivedAt(q.retrievedAt,now,start));
 }
 for(const p of r.participantQuarantines)official(p.positiveOtherGame);
 return new Date(Math.max(...times)).toISOString();
}
function inputs(e,b,r,now){
 check(Number.isFinite(now),'INVALID_CLOCK');check(reviewedSourceFingerprint(e)===r.sourceFingerprint,'SOURCE_CHANGED');check(evidenceHash(b)===r.backupFingerprint,'BACKUP_CHANGED');
 check(e.leagueID==='NBA'&&e.status.finalized===true&&e.status.completed===true&&!e.status.cancelled&&!e.status.live,'SOURCE_NOT_FINAL');
 const g=r.official.game,start=time(e.status.startsAt);check(Number.isFinite(start)&&start<now&&e.status.startsAt===r.startsAt&&b.id===r.bdlGameID,'GAME_IDENTITY');
 check(evidenceHash(g)===r.official.gameFingerprint&&g.gameStatus===3&&g.gameStatusText==='Final'&&b.status==='Final'&&!b.postponed&&g.period===b.period,'OFFICIAL_NOT_FINAL');
 check(Number.isFinite(time(g.gameTimeUTC))&&Math.abs(time(g.gameTimeUTC)-start)<=900000&&Math.abs(time(b.datetime)-start)<=900000,'GAME_START_CHANGED');
 evidenceObservedAt(r,now);return g;
}
function verifyComplete(e,b,r,now){
 const g=inputs(e,b,r,now),coverage={officialPlayers:0,primaryPlayers:0,backupStatComparisons:0,primaryStatComparisons:0,missingPrimaryPlayers:[],teamMinutes:[]},sourceIDs=new Set(),officialIDs=new Set(),backupIDs=new Set();
 const expectedSeconds=14400+1500*(g.period-4);check(Number.isInteger(g.period)&&g.period>=4&&g.period<=10,'INVALID_PERIOD');
 for(const [side,bs]of [['home','home'],['away','visitor']]){
  const ot=g[side+'Team'],bt=b[bs+'_team'],st=e.teams[side],total=e.results.game[side];
  check(norm(ot.teamCity+' '+ot.teamName)===norm(bt.full_name)&&norm(bt.full_name)===norm(st.names.long)&&ot.score===b[bs+'_team_score']&&ot.score===total.points,'TEAM_OR_SCORE_CONFLICT');
  const os=ot.players.filter(p=>officialSeconds(p)>0),bsRows=bt.players.filter(p=>seconds(p.min)>0),cw=r.crosswalk.filter(p=>p.side===side);
  check(os.length>=5&&os.length===bsRows.length&&cw.length===os.length,'INCOMPLETE_ROSTER');
  const officialSecondsTotal=os.reduce((a,p)=>a+seconds(p.statistics.minutes),0),backupSecondsTotal=bsRows.reduce((a,p)=>a+seconds(p.min),0);
  // Preserve the existing reconciler's five-second aggregate rounding bound;
  // every individual player must still agree to the exact second across feeds.
  check(officialSecondsTotal===backupSecondsTotal&&Math.abs(officialSecondsTotal-expectedSeconds)<=5,'INCOMPLETE_TEAM_MINUTES');
  coverage.teamMinutes.push({side,officialSeconds:officialSecondsTotal,backupSeconds:backupSecondsTotal,expectedSeconds,roundingSeconds:officialSecondsTotal-expectedSeconds});
  for(const [bk,[sk,ok]]of Object.entries(fields))if(sk!=='plusMinus'){const v=os.reduce((a,p)=>a+p.statistics[ok],0);check(Number.isInteger(v)&&v===bsRows.reduce((a,p)=>a+p[bk],0)&&total[sk]===v,'TEAM_STAT_CONFLICT_'+sk);}
  for(const p of cw){
   const om=os.filter(o=>o.personId===p.officialPlayerID),bm=bsRows.filter(o=>o.player.id===p.bdlPlayerID);check(om.length===1&&bm.length===1&&!officialIDs.has(p.officialPlayerID)&&!backupIDs.has(p.bdlPlayerID),'AMBIGUOUS_IDENTITY');officialIDs.add(p.officialPlayerID);backupIDs.add(p.bdlPlayerID);
   const o=om[0],br=bm[0];check(norm(o.firstName+' '+o.familyName)===norm(br.player.first_name+' '+br.player.last_name)&&norm(p.officialName)===norm(o.firstName+' '+o.familyName),'NAME_CONFLICT');
   const sr=p.sgoPlayerID?e.results.game[p.sgoPlayerID]:null,profile=p.sgoPlayerID?e.players[p.sgoPlayerID]:null;
   if(p.sgoPlayerID){check(profile?.playerID===p.sgoPlayerID&&profile.teamID===st.teamID&&sr?.secondsPlayed>0&&!sourceIDs.has(p.sgoPlayerID),'SOURCE_IDENTITY');sourceIDs.add(p.sgoPlayerID);coverage.primaryPlayers++;}else coverage.missingPrimaryPlayers.push({officialPlayerID:p.officialPlayerID,bdlPlayerID:p.bdlPlayerID,name:p.officialName});
   for(const [bk,[sk,ok]]of Object.entries(fields)){const value=o.statistics[ok];check(Number.isInteger(value)&&br[bk]===value,'BACKUP_STAT_CONFLICT_'+bk);coverage.backupStatComparisons++;if(sr){check(sr[sk]===value,'PRIMARY_STAT_CONFLICT_'+sk);coverage.primaryStatComparisons++;}}
   check(seconds(br.min)===seconds(o.statistics.minutes),'BACKUP_SECONDS_CONFLICT');coverage.backupStatComparisons++;if(sr){check(sr.secondsPlayed===seconds(o.statistics.minutes),'PRIMARY_SECONDS_CONFLICT');coverage.primaryStatComparisons++;}coverage.officialPlayers++;
  }
 }
 for(const [pid,s]of Object.entries(e.results.game))if(!['home','away','all'].includes(pid)&&s.secondsPlayed>0)check(sourceIDs.has(pid),'UNMATCHED_SOURCE_PARTICIPANT');
 return coverage;
}
function repairedInput(e,b,r,now){
 const g=inputs(e,b,r,now),source=structuredClone(e),quarantinedParticipants=[];
 for(const p of r.identityRepairs){
  check(evidenceHash(source.players[p.playerID])===p.beforeFingerprint&&evidenceHash(p.before)===p.beforeFingerprint,'IDENTITY_BEFORE_CHANGED');
  check(p.before.playerID===p.after.playerID&&p.before.teamID===p.after.teamID&&p.before.playerID===p.playerID&&p.before.teamID===source.teams[p.side].teamID,'IDENTITY_REASSIGNMENT');
  const keys=new Set([...Object.keys(p.before),...Object.keys(p.after)]);for(const k of keys)if(!['name','firstName'].includes(k))check(p.before[k]===p.after[k],'UNREVIEWED_IDENTITY_FIELD');
  const op=g[p.side+'Team'].players.filter(o=>o.personId===p.officialPlayerID);check(op.length===1&&norm(p.after.name)===norm(op[0].firstName+' '+op[0].familyName),'OFFICIAL_IDENTITY_CONFLICT');source.players[p.playerID]=structuredClone(p.after);
 }
 for(const p of r.participantQuarantines){
  check(evidenceHash(source.players[p.playerID])===p.profileFingerprint&&evidenceHash(source.results.game[p.playerID])===p.statsFingerprint&&evidenceHash(p.profile)===p.profileFingerprint&&evidenceHash(p.stats)===p.statsFingerprint,'QUARANTINE_BEFORE_CHANGED');
  check(p.profile.playerID===p.playerID&&p.profile.teamID===source.teams[p.side].teamID&&p.stats.secondsPlayed>0,'QUARANTINE_IDENTITY');
  const other=p.positiveOtherGame,og=other.game;check(evidenceHash(og)===other.gameFingerprint&&og.gameId!==g.gameId&&og.gameStatus===3&&Math.abs(time(og.gameTimeUTC)-time(g.gameTimeUTC))<=3*3600000,'OTHER_GAME_UNVERIFIED');receipt(other.html,now,time(og.gameTimeUTC));receipt(other.gamebook,now,time(og.gameTimeUTC));
  const positive=['home','away'].flatMap(side=>og[side+'Team'].players).filter(o=>o.personId===p.officialPlayerID&&seconds(o.statistics.minutes)>0&&norm(o.firstName+' '+o.familyName)===norm(p.profile.name));check(positive.length===1,'OTHER_GAME_PARTICIPATION_UNVERIFIED');
  check(!['home','away'].some(side=>g[side+'Team'].players.some(o=>o.personId===p.officialPlayerID||norm(o.firstName+' '+o.familyName)===norm(p.profile.name))),'OFFICIAL_PARTICIPANT_CANNOT_QUARANTINE');
  check(!['home','visitor'].some(side=>b[side+'_team'].players.some(o=>norm(o.player.first_name+' '+o.player.last_name)===norm(p.profile.name))),'BACKUP_PARTICIPANT_CANNOT_QUARANTINE');
  quarantinedParticipants.push(structuredClone({...p,positiveOtherGame:{gameID:og.gameId,gameFingerprint:other.gameFingerprint,html:other.html,gamebook:other.gamebook}}));delete source.players[p.playerID];delete source.results.game[p.playerID];
 }
 return {source,backup:b,quarantinedParticipants};
}
export function applyReviewedHistoryEvidence(e,b,now){
 const r=find(e);if(!r||r.kind!=='identityRepair')return {source:e,backup:b,evidence:null};
 const repaired=repairedInput(e,b,r,now),coverage=verifyComplete(repaired.source,b,{...r,sourceFingerprint:reviewedSourceFingerprint(repaired.source)},now);
 return {...repaired,evidence:{contract:reviewedHistoryContract,eventID:r.eventID,evidenceObservedAt:evidenceObservedAt(r,now),sourceReceipt:r.sourceReceipt,sourceFingerprint:r.sourceFingerprint,backupFingerprint:r.backupFingerprint,officialGameFingerprint:r.official.gameFingerprint,html:r.official.html,gamebook:r.official.gamebook,identityRepairs:r.identityRepairs,quarantinedParticipants:repaired.quarantinedParticipants,coverage,validationReviewRequired:true}};
}
export function verifyFreshOfficialFinal(e,packet,now){
 const r=find(e);if(!r||r.kind!=='freshOfficialFinal')return null;
 check(packet.sha256===r.backupReceipt.sha256&&packet.retrievedAt===r.backupReceipt.retrievedAt&&packet.url===r.backupReceipt.url,'BACKUP_RECEIPT_CHANGED');
 const matches=packet.body.data.filter(b=>b.id===r.bdlGameID);check(matches.length===1,'BACKUP_GAME_NOT_UNIQUE');
 receipt(r.official.html,now,time(e.status.startsAt),true);receipt(r.official.gamebook,now,time(e.status.startsAt),true);const coverage=verifyComplete(e,matches[0],r,now);
 return {provider:'NBA official',contract:reviewedHistoryContract,eventID:r.eventID,evidenceObservedAt:evidenceObservedAt(r,now),sourceReceipt:r.sourceReceipt,sourceFingerprint:r.sourceFingerprint,backupFingerprint:r.backupFingerprint,officialGameFingerprint:r.official.gameFingerprint,html:r.official.html,gamebook:r.official.gamebook,originalBackupReceipt:r.backupReceipt,maximumAgeHours:6,coverage,validationReviewRequired:true};
}
