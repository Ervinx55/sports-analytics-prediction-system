// Exploratory, uncalibrated features. No rank boosts or production probability model.
export const NBA_PROP_CONTEXT_VERSION = 'nba-prop-context-v1';
const validNumber = x => typeof x==='number' && Number.isFinite(x) && x>=0;
const time = x => typeof x==='string' && /(?:Z|[+-]\d\d:\d\d)$/.test(x) ? Date.parse(x) : NaN;
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
export function buildNbaPropContext({observations=[],playerId,teamId,opponentTeamId,targetGameId,cutoff,season,market}={}) {
  const ids=new Set(), cutoffMs=time(cutoff), fingerprints=new Map(), conflicts=new Set();
  for(const g of Array.isArray(observations)?observations:[]){if(!g?.gameId)continue;const key=String(g.gameId),fingerprint=JSON.stringify(g);if(fingerprints.has(key)&&fingerprints.get(key)!==fingerprint)conflicts.add(key);else fingerprints.set(key,fingerprint);}
  const validRequest=Number.isFinite(cutoffMs) && ['points','rebounds','assists'].includes(market) && playerId && teamId && opponentTeamId && String(teamId)!==String(opponentTeamId) && Number.isInteger(season);
  const games=(validRequest && Array.isArray(observations) ? observations : []).filter(g=> {
    if (!g || !g.gameId || conflicts.has(String(g.gameId)) || ids.has(String(g.gameId)) || String(g.gameId)===String(targetGameId) || g.status!=='final' || g.seasonType!==2 || g.season!==season || !Number.isFinite(time(g.startsAt)) || time(g.startsAt)>=cutoffMs || !Number.isFinite(time(g.finalObservedAt)) || time(g.finalObservedAt)>cutoffMs || time(g.finalObservedAt)<=time(g.startsAt) || !Array.isArray(g.teams) || g.teams.length!==2 || g.teams[0].teamId===g.teams[1].teamId || !Array.isArray(g.players)) return false;
    // Conflicting/repeated player identities within a game are unusable.
    if (new Set(g.players.map(p=>String(p.playerId))).size!==g.players.length || g.players.some(p=>!g.teams.some(t=>String(t.teamId)===String(p.teamId)))) return false;
    ids.add(String(g.gameId));return true;
  }).sort((a,b)=>time(b.startsAt)-time(a.startsAt));
  const observedTimes=games.map(g=>time(g.observedAt)).filter(Number.isFinite);
  const observedAt=observedTimes.length?new Date(Math.max(...observedTimes)).toISOString():null;
  const feature=(value,sampleCount,missingReason=null,window='available regular-season sample')=>({value,source:'ESPN historical summary',observedAt,availableAt:null,cutoff,season,window,sampleCount,missingReason:value===null?(missingReason||'INSUFFICIENT_DATA'):null,status:'exploratory'});
  const playerRows=games.flatMap(g=>g.players.filter(p=>String(p.playerId)===String(playerId) && String(p.teamId)===String(teamId)).map(p=>({...p,game:g})));
  const complete=playerRows.filter(p=>validNumber(p.minutes) && p.minutes>0 && p.minutes<=70 && validNumber(p[market]));
  const recent=complete.slice(0,10), totalMinutes=recent.reduce((s,p)=>s+p.minutes,0);
  const expectedMinutes=mean(recent.map(p=>p.minutes));
  const rate=totalMinutes>0?recent.reduce((s,p)=>s+p[market],0)/totalMinutes:null;
  const teamGames=games.flatMap(g=>{const t=g.teams.find(t=>String(t.teamId)===String(teamId)),o=g.teams.find(t=>String(t.teamId)!==String(teamId));return t&&o&&validNumber(t.score)&&validNumber(o.score)?[{t,o,g}]:[];});
  const efficiency=teamGames.filter(({t,o})=>validNumber(t.possessions)&&t.possessions>0&&validNumber(o.possessions)&&o.possessions>0);
  const possessions=efficiency.reduce((s,{t,o})=>s+(t.possessions+o.possessions)/2,0);
  const offense=possessions>0?100*efficiency.reduce((s,{t})=>s+t.score,0)/possessions:null;
  const defense=possessions>0?100*efficiency.reduce((s,{o})=>s+o.score,0)/possessions:null;
  // Exact historical position, not today's roster. Raw per-player-game allowance only.
  const position=playerRows[0]?.position || null;
  const allowed=position?games.flatMap(g=>g.teams.some(t=>String(t.teamId)===String(opponentTeamId))?g.players.filter(p=>String(p.teamId)!==String(opponentTeamId)&&p.position===position&&validNumber(p.minutes)&&p.minutes>0&&validNumber(p[market])).map(p=>({...p,gameId:g.gameId})):[]):[];
  const allowance=new Set(allowed.map(p=>p.gameId)).size>=3?mean(allowed.map(p=>p[market])):null;
  const baseline=recent.length>=3 && rate!==null?expectedMinutes*rate:null;
  const features={
    expectedMinutes:feature(expectedMinutes,recent.length,null,'last 10 eligible player games'),
    perMinute:feature(rate,recent.length,null,'last 10 eligible player games'),
    recentPlayerAverage:feature(mean(recent.slice(0,5).map(p=>p[market])),Math.min(5,recent.length),null,'last 5 eligible player games'),
    sampledPlayerAverage:feature(mean(complete.map(p=>p[market])),complete.length),
    winRate:feature(mean(teamGames.map(({t,o})=>Number(t.score>o.score))),teamGames.length),
    recentWinRate:feature(mean(teamGames.slice(0,5).map(({t,o})=>Number(t.score>o.score))),Math.min(5,teamGames.length),null,'last 5 eligible team games'),
    offensiveRating:feature(offense,efficiency.length,'MISSING_POSSESSION_FIELDS'),
    defensiveRating:feature(defense,efficiency.length,'MISSING_POSSESSION_FIELDS'),
    netRating:feature(offense!==null&&defense!==null?offense-defense:null,efficiency.length,'MISSING_POSSESSION_FIELDS'),
    estimatedPossessionsPerGame:feature(mean(efficiency.map(({t,o})=>(t.possessions+o.possessions)/2)),efficiency.length,'MISSING_POSSESSION_FIELDS'),
    pace:feature(null,0,'GAME_DURATION_UNVERIFIED'),
    defenseVsPosition:feature(allowance,allowed.length,position?'INSUFFICIENT_POSITION_SAMPLE':'HISTORICAL_POSITION_UNKNOWN'),
    leagueRank:feature(null,0,'INCOMPLETE_LEAGUE_COMPARISON'),
    injuryStatus:feature(null,0,'PREGAME_INJURY_KNOWLEDGE_UNAVAILABLE'),
    restDays:feature(playerRows.length?(cutoffMs-time(playerRows[0].game.startsAt))/86400000:null,playerRows.length?1:0,'NO_PREVIOUS_PLAYER_GAME')
  };
  features.expectedMinutes.method='mean observed minutes; not confirmed projected minutes';
  features.defenseVsPosition.position=position;
  features.defenseVsPosition.gameCount=new Set(allowed.map(p=>p.gameId)).size;
  features.defenseVsPosition.method='unadjusted points/rebounds/assists per opposing player-game at exact historical position; no defender assignment or learned shrinkage';
  features.offensiveRating.method='100 * points / mean of both teams estimated possessions';
  features.estimatedPossessionsPerGame.method='FGA + 0.44 * FTA - OREB + TOV; includes overtime, not pace per 48';
  return {version:NBA_PROP_CONTEXT_VERSION,market,playerId:String(playerId??''),teamId:String(teamId??''),opponentTeamId:String(opponentTeamId??''),cutoff,baselineProjection:baseline,contextAdjustedProjection:null,modelProbability:null,productionWeight:0,eligible:false,historicalPointInTimeEligible:false,features,blockers:[...(!validRequest?['INVALID_REQUEST']:[]),...(baseline===null?['INSUFFICIENT_PLAYER_BASELINE']:[]),'CONTEXT_WEIGHTS_NOT_FITTED','PROBABILITY_DISTRIBUTION_NOT_VALIDATED','HISTORICAL_AVAILABILITY_UNKNOWN','PROJECTED_MINUTES_AND_INJURIES_UNVERIFIED']};
}

