import {createHash} from 'node:crypto';
import {applyReviewedHistoryEvidence,verifyFreshOfficialFinal} from './nba-reviewed-history-evidence.mjs';
import {sourceFingerprint} from './nba-verified-bdl.mjs';
import {applyGamebookRevision} from './nba-gamebook-revision.mjs';
import {applyBilateralAdjudication,bilateralContract} from './nba-bilateral-adjudication.mjs';
import adjudicatedCorrections from '../../docs/evaluations/nba-official-adjudication-2026-11-09/corrections.json' with {type:'json'};
// Explicit documented aliases only. No fuzzy matching or inference from stat lines.
export const aliases={
 J_SMALL_1_NBA:{names:['J. Small','Javon Small'],teamID:'MEMPHIS_GRIZZLIES_NBA',eventIDs:['Gq5hByHX86Hl7YCF4bAo'],source:'https://www.nba.com/game/0022600029/box-score'},
 K_LOPEZ_1_NBA:{names:['K. Lopez','Karim López'],teamID:'MEMPHIS_GRIZZLIES_NBA',eventIDs:['Gq5hByHX86Hl7YCF4bAo'],source:'https://www.nba.com/game/0022600029/box-score'},
 D_POWELL_1_NBA:{names:['D. Powell','Drake Powell'],teamID:'BROOKLYN_NETS_NBA',eventIDs:['IYH1YQbHPZeuz923w6GO'],source:'https://www.nba.com/mavs/game/0022600199-nets-vs-mavericks-dallas-tx-11-08-2026/box-score',profileSource:'https://www.nba.com/nets/player/1642962/drake_powell'},
 RON_HOLLAND_1_NBA:{names:['Ron Holland','Ronald Holland II'],source:'https://gleague.nba.com/player/1641842/ronald-holland-ii%26quot'},
 HANSEN_YANG_1_NBA:{names:['Yang Hansen','Hansen Yang'],source:'https://api-hub.nba.com/news/nba-players-fiba-world-cup-qualifiers-august-2026'},
 BUB_CARRINGTON_1_NBA:{names:['Bub Carrington','Carlton Carrington'],source:'https://www.nba.com/wizards/news/wizards-complete-trade-with-trail-blazers'},
 BONES_HYLAND_1_NBA:{names:['Bones Hyland',"Nah’Shon Hyland"],source:'https://www.nba.com/nuggets/news/nuggets-no-26-2021'},
 AIRIOUS_BAILEY_1_NBA:{names:['Ace Bailey','Airious Bailey'],source:'https://www.nba.com/news/2025-nba-draft-takeaways'}
};
export const officialCorrections=[
 {eventID:'Gq5hByHX86Hl7YCF4bAo',playerID:'J_SMALL_1_NBA',teamID:'MEMPHIS_GRIZZLIES_NBA',name:'Javon Small',source:'https://www.nba.com/game/0022600029/box-score',fields:{secondsPlayed:[1260,1267],twoPointersMade:[0,2],twoPointersAttempted:[0,5]}},
 {eventID:'Gq5hByHX86Hl7YCF4bAo',playerID:'K_LOPEZ_1_NBA',teamID:'MEMPHIS_GRIZZLIES_NBA',name:'Karim López',source:'https://www.nba.com/game/0022600029/box-score',fields:{secondsPlayed:[240,226]}},
 {eventID:'IYH1YQbHPZeuz923w6GO',playerID:'D_POWELL_1_NBA',teamID:'BROOKLYN_NETS_NBA',name:'Drake Powell',source:'https://www.nba.com/mavs/game/0022600199-nets-vs-mavericks-dallas-tx-11-08-2026/box-score',fields:{secondsPlayed:[540,565],twoPointersMade:[0,1],twoPointersAttempted:[0,1]}}
];
officialCorrections.push(...adjudicatedCorrections);
export const liveBdlContract='nba-bdl-live-v4:'+createHash('sha256').update(JSON.stringify({aliases,officialCorrections,bilateralContract})).digest('hex');
const norm=x=>String(x??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const name=x=>norm(String(x??'').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i,''));
const team=x=>norm(x).replace(/^losangelesclippers$/,'laclippers');
const integer=x=>Number.isInteger(x)&&x>=0;
const require=(ok,reason)=>{if(!ok)throw Error(reason);};
const time=x=>typeof x==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(x)?Date.parse(x):NaN;
const FIELDS={pts:'points',reb:'rebounds',ast:'assists',fga:'fieldGoalsAttempted',fta:'freeThrowsAttempted',oreb:'offensiveRebounds',turnover:'turnovers'};
const EXTRA={blk:'blocks',stl:'steals',pf:'fouls',fgm:'fieldGoalsMade',fg3m:'threePointersMade',fg3a:'threePointersAttempted',ftm:'freeThrowsMade',dreb:'defensiveRebounds',plus_minus:'plusMinus'};
function names(pid,p,eventID){
 const values=[p.name];if(p.firstName&&p.lastName)values.push(p.firstName+' '+p.lastName);
 const alias=aliases[pid];if(alias&&(!alias.teamID||alias.teamID===p.teamID)&&(!alias.eventIDs||alias.eventIDs.includes(eventID))&&alias.names.some(n=>name(n)===name(p.name)))values.push(...alias.names);
 return new Set(values.map(name).filter(Boolean));
}
/** Immutable, field-specific adjudication; no generic rounding or stat tolerances. */
export function applyOfficialCorrections(source,b){
 const event=structuredClone(source),corrections=[];
 for(const c of officialCorrections){
  if(c.eventID!==event.eventID)continue;
  if(c.playerID&&!event.players?.[c.playerID])continue;
  const side=['home','away'].find(s=>event.teams?.[s]?.teamID===c.teamID);
  require(side&&(!c.playerID||event.players?.[c.playerID]?.teamID===c.teamID)&&(!c.side||c.side===side),'OFFICIAL_CORRECTION_IDENTITY_UNVERIFIED');
  const backupTeam=b[side==='home'?'home_team':'visitor_team'];
  require(team(event.teams[side].names.long)===team(backupTeam?.full_name),'OFFICIAL_CORRECTION_TEAM_UNVERIFIED');
  const matches=c.playerID?backupTeam.players.filter(r=>name(r.player?.first_name+' '+r.player?.last_name)===name(c.name)):backupTeam.players;
  require(matches.length>0&&(!c.playerID||matches.length===1),'OFFICIAL_CORRECTION_IDENTITY_UNVERIFIED');
  const mapped=matches.map(br=>{
   const m=/^(\d+):([0-5]\d)$/.exec(br.min??'');
   const values={...Object.fromEntries(Object.entries({...FIELDS,...EXTRA}).map(([bk,sk])=>[sk,br[bk]])),secondsPlayed:m?60*Number(m[1])+Number(m[2]):NaN,twoPointersMade:br.fgm-br.fg3m,twoPointersAttempted:br.fga-br.fg3a};
   for(const f of Object.keys(c.fields))if(f.includes('+'))values[f]=f.split('+').reduce((sum,k)=>sum+values[k],0);
   return values;
  });
  for(const [field,[before,after]] of Object.entries(c.fields)){
   const row=event.results?.game?.[c.playerID??side];
   require(row&&(row[field]===before||row[field]===after),'OFFICIAL_CORRECTION_SOURCE_CHANGED');
   require(mapped.every(v=>Number.isFinite(v[field]))&&mapped.reduce((sum,v)=>sum+v[field],0)===after,'OFFICIAL_CORRECTION_CONFLICT');
   if(row[field]!==after){corrections.push({...c,field,before:row[field],after});row[field]=after;}
  }
 }
 return {event,corrections};
}
/** Strict counterpart of the offline reconciler, with documented/profile aliases. */
export function reconcileBdl(s,b,observed){
 const bilateral=applyBilateralAdjudication(s,b);s=bilateral.source;b=bilateral.backup;
 const adjudicated=applyOfficialCorrections(s,b);s=adjudicated.event;
 const start=time(s.status?.startsAt),retrieved=time(observed);
 require(s.leagueID==='NBA'&&s.status?.finalized===true&&s.status?.completed===true&&!s.status.cancelled,'SOURCE_NOT_FINAL');
 require(b.status==='Final'&&!b.postponed&&b.season===2026&&integer(b.period)&&b.period>=4&&b.period<=10&&Math.abs(time(b.datetime)-start)<=900000&&start<retrieved,'BACKUP_GAME_UNVERIFIED');
 const players=[],teams=[],identities=new Set(),bdlIDs=new Set(),crosswalk=[],teamSeconds=[];
 for(const [pid,r] of Object.entries(s.results.game)){
  if(['home','away','all'].includes(pid))continue;
  require(pid.endsWith('_NBA')&&integer(r.secondsPlayed)&&r.secondsPlayed<=4200,'INVALID_SOURCE_MINUTES');
  if(r.secondsPlayed>0)require(s.players?.[pid]?.playerID===pid&&['home','away'].some(side=>s.teams[side].teamID===s.players[pid].teamID),'SOURCE_IDENTITY_CONFLICT');
 }
 for(const [side,bs] of [['home','home'],['away','visitor']]){
  const st=s.teams[side],bt=b[bs+'_team'],total=s.results.game[side];
  require(team(st.names.long)===team(bt.full_name)&&b[bs+'_team_score']===total.points,'GAME_TEAM_OR_SCORE_CONFLICT');
  const rows=[];let seconds=0;
  for(const r of bt.players){
   const p=r.player;require(integer(p.id)&&!bdlIDs.has(p.id),'DUPLICATE_BACKUP_ID');bdlIDs.add(p.id);
   require(Object.keys(FIELDS).every(k=>integer(r[k])),'INVALID_BACKUP_STATS');
   require(['fgm','fg3m','ftm','dreb'].every(k=>integer(r[k]))&&r.pts===2*r.fgm+r.fg3m+r.ftm&&r.reb===r.oreb+r.dreb&&r.fg3m<=r.fgm&&r.fgm<=r.fga&&r.ftm<=r.fta,'INTERNAL_STATS_CONFLICT');
   const m=r.min;require(typeof m==='string'&&/^\d+(?::[0-5]\d)?$/.test(m),'INVALID_MINUTES');
   if(['0','0:00','00:00'].includes(m)){require(Object.keys(FIELDS).every(k=>r[k]===0),'ZERO_MINUTE_STATS_CONFLICT');continue;}
   require(m.includes(':'),'SECONDS_PRECISION_UNAVAILABLE');const [mm,ss]=m.split(':').map(Number),sec=60*mm+ss;
   require(sec>0&&sec<=4200,'INVALID_MINUTES');seconds+=sec;rows.push({r,sec,n:name(p.first_name+' '+p.last_name)});
  }
  require(rows.length>=5&&Math.abs(seconds-(14400+1500*(b.period-4)))<=5,'INCOMPLETE_TEAM_MINUTES');teamSeconds.push(seconds);
  for(const [bk,sk] of Object.entries(FIELDS))require(integer(total[sk])&&rows.reduce((a,{r})=>a+r[bk],0)===total[sk],'TEAM_TOTAL_CONFLICT_'+sk);
  for(const [bk,sk] of Object.entries(EXTRA))if(sk!=='plusMinus'&&sk in total)require(integer(total[sk])&&rows.every(({r})=>integer(r[bk]))&&rows.reduce((a,{r})=>a+r[bk],0)===total[sk],'TEAM_TOTAL_CONFLICT_'+sk);
  const roster=Object.entries(s.players??{}).filter(([,p])=>p.teamID===st.teamID);
  for(const [pid,p] of roster)require(p.playerID===pid&&pid.endsWith('_NBA'),'SOURCE_IDENTITY_CONFLICT');
  let corroborated=0;
  for(const [pid,p] of roster){
   const r=s.results.game[pid],matches=rows.filter(x=>names(pid,p,s.eventID).has(x.n));if(!r)continue;
   if(r.secondsPlayed===0){require(!matches.length,'DNP_CONFLICT');continue;}
   require(integer(r.secondsPlayed)&&matches.length===1,'PLAYER_MAPPING_UNVERIFIED');const {r:br,sec}=matches[0];
   require(Object.entries(FIELDS).every(([bk,sk])=>integer(r[sk])&&r[sk]===br[bk])&&Math.abs(r.secondsPlayed-sec)<=1,'PLAYER_STATS_CONFLICT');
   for(const [bk,sk] of Object.entries(EXTRA))if(sk in r)require(Number.isInteger(r[sk])&&Number.isInteger(br[bk])&&r[sk]===br[bk],'PLAYER_STATS_CONFLICT_'+sk);
   const derived={twoPointersMade:br.fgm-br.fg3m,twoPointersAttempted:br.fga-(br.fg3a??0),'points+assists':br.pts+br.ast,'points+rebounds':br.pts+br.reb,'points+rebounds+assists':br.pts+br.reb+br.ast,'rebounds+assists':br.reb+br.ast};
   if('blk' in br&&'stl' in br)derived['blocks+steals']=br.blk+br.stl;
   for(const [sk,v] of Object.entries(derived))if(sk in r)require(r[sk]===v,'PLAYER_DERIVED_STATS_CONFLICT_'+sk);
   corroborated++;
  }
  require(corroborated>=5,'INSUFFICIENT_CORROBORATION');
  for(const {r,sec,n} of rows){
   const matches=roster.filter(([pid,p])=>n&&names(pid,p,s.eventID).has(n));require(matches.length<=1,'AMBIGUOUS_PLAYER_NAME');
   const pid=matches[0]?.[0]??'bdl:'+r.player.id;require(!identities.has(pid),'DUPLICATE_NATIVE_ID');identities.add(pid);
   if(matches.length)crosswalk.push({sgoPlayerID:pid,bdlPlayerID:r.player.id,name:r.player.first_name+' '+r.player.last_name,teamId:st.teamID,evidence:'unique full/profile/documented name; same game/team; shared results reconciled',...(aliases[pid]?{aliasSource:aliases[pid].source}:{})});
   players.push({id:pid,teamId:st.teamID,minutes:sec/60,points:r.pts,rebounds:r.reb,assists:r.ast,starter:null});
  }
  teams.push({id:st.teamID,points:total.points,possessions:rows.reduce((a,{r})=>a+r.fga+.44*r.fta-r.oreb+r.turnover,0)});
 }
 require(new Set(teams.map(t=>t.id)).size===2&&Math.abs(teamSeconds[0]-teamSeconds[1])<=5,'TEAM_MINUTES_CONFLICT');
 for(const [pid,r] of Object.entries(s.results.game))if(!['home','away','all'].includes(pid)&&r.secondsPlayed>0)require(identities.has(pid),'UNMATCHED_SOURCE_PARTICIPANT');
 return {id:'sgo:'+s.eventID,startsAt:s.status.startsAt,observedAt:observed,source:'SportsGameOdds corroborated BALLDONTLIE',sourceContract:'sgo-nba-bdl-backup-v1',teams,players,backupEvidence:{bdlGameID:b.id,playerCrosswalk:crosswalk,...(adjudicated.corrections.length?{officialCorrections:adjudicated.corrections}:{}),...(bilateral.evidence?{officialBilateralAdjudication:bilateral.evidence}:{})}};
}
/** One request/run under the caller's shared DB lease. Cache and cooldown persist. */
export function createBdlBackup({key,state,summaries,loadSummaries,fetchImpl=fetch,clock=()=>new Date().toISOString()}){
 const cache=state.bdl??={dates:{}};cache.dates??={};let requested=false;
 const fallbackAudit=cache.staleFallback={at:clock(),attempts:0,accepted:0,rejected:0,events:{}};
 return async(e,observed)=>{
  require(e.leagueID==='NBA'&&e.status?.finalized===true&&e.status?.completed===true&&!e.status.cancelled,'SOURCE_NOT_FINAL');
  const now=time(clock()),start=time(e.status?.startsAt);
  require(Number.isFinite(now)&&Number.isFinite(start)&&start>=Date.parse('2026-10-20T00:00:00Z')&&start<Date.parse('2026-12-01T00:00:00Z'),'BDL_SEASON_OUTSIDE_CONTRACT');
  require(time(observed)<=now&&start<now,'BDL_INVALID_OBSERVATION_TIME');
  require(key&&!/redact/i.test(key),'BDL_KEY_NOT_CONFIGURED');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start));
  let pointer=cache.dates[date],packet,staleReason=null,officialAttestation=null;
  // Recent date packets can contain live games, even when another game is final.
  // Refresh through the existing shared request budget and rate-limit cooldown.
  const cacheTTL=now-start<48*3600000?15*60000:6*3600000;
  if(pointer&&now-time(pointer.retrievedAt)>=0&&now-time(pointer.retrievedAt)<cacheTTL){
   packet=summaries[pointer.key];if(!packet){Object.assign(summaries,await loadSummaries([pointer.key]));packet=summaries[pointer.key];}
  }
  if(!packet){
   try{
   require((cache.nextRequestAt??0)<=now,'BDL_COOLDOWN');require(!requested,'BDL_RUN_BUDGET');requested=true;cache.nextRequestAt=now+15000;cache.lastAcquisitionAttemptAt=clock();
   const url='https://api.balldontlie.io/v1/box_scores?date='+date;
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
   try{
    const r=await fetchImpl(url,{headers:{Authorization:key,accept:'application/json'},redirect:'error',signal:controller.signal});
    if(!r.ok){const retry=r.headers.get('retry-after'),seconds=/^\d+$/.test(retry??'')?Number(retry):Math.max(0,(Date.parse(retry)-now)/1000)||0;cache.nextRequestAt=now+1000*Math.min(86400,Math.max(seconds,r.status===429?60:[401,403].includes(r.status)?3600:30));throw Error('BDL_HTTP_'+r.status);}
    let bytes=0,text='';const reader=r.body?.getReader(),decoder=new TextDecoder();require(reader,'BDL_EMPTY_BODY');
    try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4*1024*1024){await reader.cancel();throw Error('BDL_RESPONSE_TOO_LARGE');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
    let body;try{body=JSON.parse(text);}catch{throw Error('BDL_INVALID_RESPONSE');}require(Array.isArray(body?.data)&&body.data.length<=30,'BDL_INVALID_RESPONSE');
    packet={body,url,retrievedAt:clock(),sha256:createHash('sha256').update(text).digest('hex')};cache.lastAcquisitionError=null;cache.lastSuccessfulFetchAt=packet.retrievedAt;
    const cacheKey='bdl-date:'+date+':'+packet.sha256+':'+packet.retrievedAt;
    summaries[cacheKey]=packet;cache.dates[date]={key:cacheKey,retrievedAt:packet.retrievedAt};
    for(const old of Object.keys(cache.dates).sort().slice(0,-90))delete cache.dates[old];
   }catch(err){cache.lastError=/^BDL_/.test(err.message)?err.message:'BDL_FETCH_FAILED';cache.lastAcquisitionError=cache.lastError;throw Error(cache.lastError);}finally{clearTimeout(timer);}
   }catch(error){
    // Keep the existing 48-hour recent-game boundary: incomplete/live results and
    // recent settlements still require the normal fresh-source policy.
    if(!pointer||!/^BDL_(?:HTTP_\d{3}|COOLDOWN|RUN_BUDGET|FETCH_FAILED)$/.test(error.message))throw error;
    packet=summaries[pointer.key];if(!packet){Object.assign(summaries,await loadSummaries([pointer.key]));packet=summaries[pointer.key];}
    require(packet&&packet.url==='https://api.balldontlie.io/v1/box_scores?date='+date&&/^[a-f0-9]{64}$/.test(packet.sha256??'')&&pointer.key==='bdl-date:'+date+':'+packet.sha256+':'+packet.retrievedAt&&pointer.retrievedAt===packet.retrievedAt&&time(packet.retrievedAt)>start&&time(packet.retrievedAt)<=now&&Array.isArray(packet.body?.data)&&packet.body.data.length<=30,'BDL_STALE_CACHE_PROVENANCE');
    if(now-start<48*3600000){officialAttestation=verifyFreshOfficialFinal(e,packet,now);if(!officialAttestation)throw error;}
    staleReason=error.message;fallbackAudit.attempts++;
   }
  }
  try{
  const candidates=packet.body.data.filter(b=>Math.abs(time(b.datetime)-start)<=900000&&team(b.home_team?.full_name)===team(e.teams?.home?.names?.long)&&team(b.visitor_team?.full_name)===team(e.teams?.away?.names?.long));
  require(candidates.length===1,'BACKUP_GAME_NOT_UNIQUE');
  const reviewed=applyReviewedHistoryEvidence(e,candidates[0],now);
  const revision=applyGamebookRevision(reviewed.source,reviewed.backup);
  const reviewedAt=revision.evidence?time(revision.evidence.gamebook.retrievedAt):0;
  require(Number.isFinite(reviewedAt)&&reviewedAt<=now,'GAMEBOOK_EVIDENCE_FROM_FUTURE');
  const g=reconcileBdl(revision.source,revision.backup,new Date(Math.max(time(observed),time(packet.retrievedAt),reviewedAt,reviewed.evidence?time(reviewed.evidence.evidenceObservedAt):0,officialAttestation?time(officialAttestation.evidenceObservedAt):0)).toISOString());
  if(revision.evidence)g.backupEvidence.officialGamebookRevision=revision.evidence;
  if(reviewed.evidence)g.backupEvidence.reviewedHistoryRevision=reviewed.evidence;
  if(officialAttestation)g.backupEvidence.officialFinalAttestation=officialAttestation;
  Object.assign(g.backupEvidence,{sourceUrl:packet.url,sourceSha256:packet.sha256,retrievedAt:packet.retrievedAt,sourceFingerprint:sourceFingerprint(e),profileSha256:createHash('sha256').update(JSON.stringify(e.players)).digest('hex'),liveContract:liveBdlContract});
  if(staleReason){
   g.backupEvidence.staleCacheFallback={reason:staleReason,verifiedAt:clock(),retrievedAt:packet.retrievedAt,cacheKey:pointer.key,...(officialAttestation?{acceptedVia:'FRESH_NBA_OFFICIAL_ATTESTATION',maximumOfficialAgeHours:6}:{minimumGameAgeHours:48})};
   fallbackAudit.events[e.eventID]={status:'ACCEPTED',reason:staleReason,retrievedAt:packet.retrievedAt};
   fallbackAudit.accepted=Object.values(fallbackAudit.events).filter(r=>r.status==='ACCEPTED').length;
   fallbackAudit.rejected=Object.values(fallbackAudit.events).filter(r=>r.status==='REJECTED').length;
  }
  // Verification time describes reconciliation; retrieval time remains original.
  // A cached success must not erase the live provider's authorization failure.
  cache.lastVerifiedAt=clock();if(!staleReason&&!cache.lastAcquisitionError)cache.lastError=null;return g;
  }catch(error){
   if(staleReason){fallbackAudit.events[e.eventID]={status:'REJECTED',reason:error.message,retrievedAt:packet.retrievedAt};fallbackAudit.rejected=Object.values(fallbackAudit.events).filter(r=>r.status==='REJECTED').length;fallbackAudit.accepted=Object.values(fallbackAudit.events).filter(r=>r.status==='ACCEPTED').length;}
   throw error;
  }
 };
}
