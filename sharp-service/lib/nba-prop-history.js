// ESPN summaries are observations of final state, never proof of historical availability.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';
const caches = new WeakMap();
const id = x => /^[1-9]\d*$/.test(String(x ?? '')) ? String(x) : null;
const timestamp = x => typeof x === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(x) ? Date.parse(x) : NaN;
const number = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : typeof x === 'string' && /^\d+(?:\.\d+)?$/.test(x) ? Number(x) : null;
function minutes(x) {
  if (typeof x === 'string' && /^\d+:\d{2}$/.test(x)) { const [m,s]=x.split(':').map(Number); return s<60 && m+s/60<=70 ? m+s/60 : null; }
  const n=number(x); return n!==null && n<=70 ? n : null;
}
function possessions(stats) {
  const map=new Map((stats||[]).map(s=>[s.name,s.displayValue]));
  const attempts=name=> {const s=map.get(name);return typeof s==='string' && /^\d+-\d+$/.test(s) ? number(s.split('-')[1]) : null;};
  const fga=attempts('fieldGoalsMade-fieldGoalsAttempted'),fta=attempts('freeThrowsMade-freeThrowsAttempted'),orb=number(map.get('offensiveRebounds'));
  // ESPN totalTurnovers includes player and team turnovers. Never assume missing team turnovers are zero.
  const individual=number(map.get('turnovers')),team=number(map.get('teamTurnovers'));
  const tov=number(map.get('totalTurnovers')) ?? (individual!==null&&team!==null?individual+team:null);
  // Standard estimated team possessions. No pace claim without game duration.
  if ([fga,fta,orb,tov].includes(null)) return null;
  const result=fga+0.44*fta-orb+tov;return result>0 ? result : null;
}
export function parseNbaPropSummary(body, game, observedAt) {
  const header=body?.header, c=header?.competitions?.[0], status=c?.status?.type;
  const observed=timestamp(observedAt), starts=timestamp(game?.datetime);
  if (!id(game?.id) || id(header?.id)!==id(game.id) || header?.competitions?.length!==1 || id(c?.id)!==id(game.id) ||
      Number(header?.season?.type)!==2 || status?.name!=='STATUS_FINAL' || status?.completed!==true || status?.state!=='post' ||
      !Number.isFinite(observed) || !Number.isFinite(starts) || starts>=observed || timestamp(c.date)!==starts || game.status_state!=='final') return null;
  const expected=[id(game.home_team?.id),id(game.visitor_team?.id)];
  if (expected.includes(null) || expected[0]===expected[1] || c.competitors?.length!==2 || new Set(c.competitors.map(r=>id(r.id))).size!==2 || c.competitors.some(r=>!expected.includes(id(r.id)))) return null;
  const boxes=body?.boxscore?.teams;
  if (!Array.isArray(boxes) || boxes.length!==2 || new Set(boxes.map(r=>id(r.team?.id))).size!==2 || boxes.some(r=>!expected.includes(id(r.team?.id)))) return null;
  const teams=boxes.map(row=>({teamId:id(row.team.id),score:number(c.competitors.find(r=>id(r.id)===id(row.team.id))?.score),possessions:possessions(row.statistics)}));
  if (teams.some(t=>t.score===null) || teams.find(t=>t.teamId===expected[0]).score!==game.home_team_score || teams.find(t=>t.teamId===expected[1]).score!==game.visitor_team_score) return null;
  const players=[],seen=new Set();
  for (const group of body.boxscore.players || []) {
    const teamId=id(group.team?.id);if (!expected.includes(teamId)) return null;
    for (const block of group.statistics || []) {
      const labels=block.labels;if (!Array.isArray(labels)) continue;
      for (const row of block.athletes || []) {
        if (row.didNotPlay===true) continue;
        const playerId=id(row.athlete?.id);if (!playerId || seen.has(playerId)) return null;seen.add(playerId);
        const get=label=> row.stats?.[labels.indexOf(label)];
        const position=row.athlete?.position?.abbreviation;
        players.push({playerId,teamId,position:['PG','SG','SF','PF','C','G','F'].includes(position)?position:null,minutes:minutes(get('MIN')),points:number(get('PTS')),rebounds:number(get('REB')),assists:number(get('AST'))});
      }
    }
  }
  return {gameId:id(game.id),season:game.season,seasonType:2,status:'final',startsAt:game.datetime,finalObservedAt:observedAt,observedAt,availableAt:null,completedAt:null,source:'ESPN',sourceUrl:`${BASE}?event=${game.id}`,teams,players};
}
export async function loadNbaPropHistory({games=[],teamIds=[],cutoff,fetchImpl=fetch,clock=()=>new Date().toISOString(),timeoutMs=2500,maxGames=12}={}) {
  const failure=reason=>({ok:false,observations:[],reasons:[reason],source:'ESPN'});
  if (!Number.isFinite(timestamp(cutoff)) || !Array.isArray(games) || !Array.isArray(teamIds) || !Number.isInteger(maxGames) || maxGames<1 || maxGames>24 || !Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>5000) return failure('INVALID_REQUEST');
  let cache=caches.get(fetchImpl);if (!cache) {cache=new Map();caches.set(fetchImpl,cache);}
  const unique=new Map(), fingerprints=new Map(), conflicts=new Set();
  for(const g of games){if(!id(g?.id))continue;const key=String(g.id),fingerprint=JSON.stringify(g);if(fingerprints.has(key)&&fingerprints.get(key)!==fingerprint)conflicts.add(key);else fingerprints.set(key,fingerprint);}
  for (const g of games) if (id(g?.id) && !conflicts.has(String(g.id)) && g.status_state==='final' && timestamp(g.datetime)<timestamp(cutoff) && (!teamIds.length || [g.home_team?.id,g.visitor_team?.id].some(t=>teamIds.map(String).includes(String(t))))) unique.set(String(g.id),g);
  const selected=[...unique.values()].sort((a,b)=>timestamp(b.datetime)-timestamp(a.datetime)).slice(0,maxGames);
  const results=new Array(selected.length);let next=0;
  await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{while(next<selected.length){const index=next++,game=selected[index];try {
    const now=timestamp(clock()),hit=cache.get(String(game.id));
    if (hit && now>=hit.at && now-hit.at<300000) {results[index]={observation:parseNbaPropSummary(hit.body,game,hit.observedAt)};continue;}
    const response=await fetchImpl(`${BASE}?event=${game.id}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(timeoutMs),cache:'no-store'});
    if (!response.ok) {results[index]={reason:`ESPN_HTTP_${response.status}`};continue;}
    const raw=await response.text();if(raw.length>2000000){results[index]={reason:'ESPN_PAGE_TOO_LARGE'};continue;}
    const body=JSON.parse(raw),observedAt=clock(),observation=parseNbaPropSummary(body,game,observedAt);
    results[index]=observation?{observation}:{reason:'INVALID_SUMMARY'};
    if(observation){cache.set(String(game.id),{body,observedAt,at:timestamp(observedAt)});if(cache.size>100)cache.delete(cache.keys().next().value);}
  } catch(e){results[index]={reason:['TimeoutError','AbortError'].includes(e?.name)?'ESPN_TIMEOUT':'ESPN_FETCH_FAILED'};}}}));
  const observations=results.map(r=>r.observation).filter(Boolean), reasons=[...new Set(results.filter(r=>!r.observation).map(r=>r.reason||'INVALID_SUMMARY'))];
  if(conflicts.size)reasons.push('CONFLICTING_GAME_RECORDS');
  if(!selected.length)reasons.push('NO_ELIGIBLE_GAMES');
  return {ok:observations.length>0,observations,reasons,source:'ESPN',requestedGames:selected.length,truncated:unique.size>maxGames};
}
