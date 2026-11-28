import {verifiedArchivedPlayers} from './nba-verified-history.js';

const instant=value=>typeof value==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
const id=value=>typeof value==='string'&&value.length>0&&value.length<=180;
const safeTarget=t=>t&&[t.eventID,t.playerID,t.teamId,t.opponentTeamId].every(id)&&
  t.teamId!==t.opponentTeamId&&Number.isFinite(instant(t.startsAt));
const publicTarget=t=>({eventID:t.eventID,playerID:t.playerID,teamId:t.teamId,
  opponentTeamId:t.opponentTeamId,startsAt:new Date(instant(t.startsAt)).toISOString(),
  ...(typeof t.playerName==='string'&&t.playerName.length<=120?{playerName:t.playerName}:{})});
const signature=t=>JSON.stringify([t.eventID,t.playerID,t.teamId,t.opponentTeamId,instant(t.startsAt)]);

function eligibleSnapshot(snapshot,asOf){
  const now=instant(asOf),generated=instant(snapshot?.generatedAt);
  return Number.isFinite(now)&&Number.isFinite(generated)&&generated<=now&&now-generated<=600000&&
    snapshot?.contract==='nba-explanation-snapshot-v1'&&Array.isArray(snapshot.targets)&&
    snapshot.targets.length<=1000&&Array.isArray(snapshot.history)&&snapshot.history.length<=300;
}

// The target catalog is read from the accepted roster snapshot, not a name match.
export function nbaScenarioTargets(snapshot,asOf){
  if(!eligibleSnapshot(snapshot,asOf))return {status:'SOURCE_UNAVAILABLE',targets:[]};
  const groups=new Map();
  for(const t of snapshot.targets){
    if(!safeTarget(t)||instant(t.startsAt)<=instant(asOf))continue;
    const key=JSON.stringify([t.eventID,t.playerID]);
    if(!groups.has(key))groups.set(key,new Map());
    groups.get(key).set(signature(t),publicTarget(t));
  }
  const targets=[...groups.values()].filter(g=>g.size===1).map(g=>[...g.values()][0])
    .sort((a,b)=>instant(a.startsAt)-instant(b.startsAt)||a.playerID.localeCompare(b.playerID));
  return {status:targets.length?'AVAILABLE':'NO_UPCOMING_TARGETS',generatedAt:snapshot.generatedAt,targets};
}

export function nbaScenarioHistory(snapshot,{eventID,playerID,asOf}){
  const catalog=nbaScenarioTargets(snapshot,asOf);
  const targets=catalog.targets.filter(t=>t.eventID===eventID&&t.playerID===playerID);
  const excludedCounts={};
  const result={status:'SOURCE_UNAVAILABLE',target:null,rows:[],sourceValidation:{
    source:'Reconciled SportsGameOdds and archived BALLDONTLIE; recorded NBA corrections where present',
    snapshotGeneratedAt:snapshot?.generatedAt??null,inputGames:snapshot?.history?.length??0,
    acceptedRows:0,excludedCounts}};
  if(catalog.status==='SOURCE_UNAVAILABLE')return result;
  if(targets.length!==1)return {...result,status:'TARGET_UNAVAILABLE'};
  const target=targets[0],cutoff=instant(asOf);
  const exclude=reason=>{excludedCounts[reason]=(excludedCounts[reason]??0)+1;};
  for(const item of snapshot.history){
    const s=item?.summary;
    if(!s||!id(s.id)||!Number.isFinite(instant(s.startsAt))||
       !Number.isFinite(instant(s.observedAt))){exclude('INVALID_GAME_IDENTITY_OR_TIME');continue;}
    if(s.id===target.eventID||instant(s.startsAt)>=cutoff||instant(s.observedAt)>cutoff){
      exclude('NOT_AVAILABLE_BEFORE_FORECAST');continue;
    }
    if(!Array.isArray(s.teams)||s.teams.length!==2||s.teams.some(t=>!t||!id(t.id))||
       s.teams.filter(t=>t.id===target.teamId).length!==1||new Set(s.teams.map(t=>t.id)).size!==2){
      exclude('DIFFERENT_OR_UNVERIFIED_TEAM');continue;
    }
    const observed=instant(s.backupEvidence?.retrievedAt);
    if(!Number.isFinite(observed)||observed>cutoff||observed<instant(s.startsAt)){
      exclude('ARCHIVE_TIME_UNVERIFIED');continue;
    }
    const rawStart=instant(item.raw?.datetime);
    if(!Number.isFinite(rawStart)||Math.abs(rawStart-instant(s.startsAt))>15*60000||
       rawStart>=cutoff||observed<rawStart||item.raw?.status!=='Final'||
       item.raw?.postponed===true||item.raw?.cancelled===true){
      exclude('ARCHIVED_GAME_HEADER_UNVERIFIED');continue;
    }
    if(!Array.isArray(s.players)||s.players.some(p=>!p||typeof p!=='object')){
      exclude('INVALID_PLAYER_ROWS');continue;
    }
    const own=s.players.filter(p=>p.id===target.playerID&&p.teamId===target.teamId);
    if(own.length!==1){exclude(own.length?'CONFLICTING_PLAYER_IDENTITY':'PLAYER_NOT_IN_GAME');continue;}
    let verified;
    try{verified=verifiedArchivedPlayers(item,cutoff).filter(p=>p.id===target.playerID&&p.teamId===target.teamId);}
    catch{verified=[];}
    if(verified.length!==1){exclude('ARCHIVED_PLAYER_TOTALS_UNVERIFIED');continue;}
    const p=verified[0];
    result.rows.push({gameId:s.id,startsAt:s.startsAt,
      observedAt:new Date(Math.max(instant(s.observedAt),observed)).toISOString(),
      playerId:target.playerID,teamId:target.teamId,minutes:p.minutes,
      points:p.points,rebounds:p.rebounds,assists:p.assists});
  }
  result.sourceValidation.acceptedRows=result.rows.length;
  return {...result,status:'AVAILABLE',target};
}
