// Source adapters retain uncertainty. Missing scores, venue and identities are never zero/defaults.
const score=v=>{v=v?.value??v;return (typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v))&&Number.isInteger(Number(v))&&Number(v)>=0&&Number(v)<=200?Number(v):null;};
const iso=v=>Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const name=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases=t=>[t?.displayName,t?.shortDisplayName,t?.location,t?.names?.long,t?.names?.medium,t?.names?.short].filter(Boolean);
export function normalizeEspnGame(event,fetchedAt){
 const c=event?.competitions?.[0],home=c?.competitors?.find(t=>t.homeAway==='home'),away=c?.competitors?.find(t=>t.homeAway==='away');
 const status=c?.status?.type??event?.status?.type??{};
 return {id:String(event?.id||''),source:'ESPN',season:Number(event?.season?.year)||null,startsAt:iso(c?.date||event?.date),homeID:String(home?.team?.id||''),awayID:String(away?.team?.id||''),homeName:home?.team?.displayName,awayName:away?.team?.displayName,homeAliases:aliases(home?.team),awayAliases:aliases(away?.team),homeScore:score(home?.score),awayScore:score(away?.score),completed:status.completed===true,cancelled:/cancel|postpon|suspend/i.test(status.name||''),neutralSite:typeof c?.neutralSite==='boolean'?c.neutralSite:null,fetchedAt:iso(fetchedAt)};
}
export function normalizeSgoGame(event,fetchedAt){
 const home=event?.teams?.home,away=event?.teams?.away,startsAt=iso(event?.status?.startsAt);
 return {id:String(event?.eventID||''),source:'SportsGameOdds',league:event?.leagueID,season:startsAt?Number(startsAt.slice(0,4))-(Number(startsAt.slice(5,7))<3?1:0):null,startsAt,homeID:String(home?.teamID||''),awayID:String(away?.teamID||''),homeName:home?.names?.long||home?.names?.medium,awayName:away?.names?.long||away?.names?.medium,homeAliases:aliases(home),awayAliases:aliases(away),homeScore:score(home?.score??event?.results?.game?.home?.points),awayScore:score(away?.score??event?.results?.game?.away?.points),completed:event?.status?.finalized===true,cancelled:event?.status?.cancelled===true,neutralSite:typeof event?.info?.neutralSite==='boolean'?event.info.neutralSite:null,fetchedAt:iso(fetchedAt)};
}
export function reconcileGames(sgo,espn){
 const matched=[],conflicts=[],unmatched=[],used=new Set();
 for(const a of sgo){
  const choices=espn.filter(b=>Math.abs(Date.parse(a.startsAt)-Date.parse(b.startsAt))<=15*60000&&['home','away'].every(side=>a[side+'Aliases']?.some(n=>b[side+'Aliases']?.some(m=>name(n)&&name(n)===name(m)))));
  if(choices.length!==1||used.has(choices[0]?.id)){unmatched.push({eventID:a.id,reason:choices.length?'AMBIGUOUS_IDENTITY':'IDENTITY_UNMATCHED'});continue;}
  const b=choices[0];used.add(b.id);
  if(a.completed&&b.completed&&(a.homeScore===null||a.awayScore===null||a.homeScore!==b.homeScore||a.awayScore!==b.awayScore)){conflicts.push({eventID:a.id,espnID:b.id,reason:'FINAL_SCORE_CONFLICT'});continue;}
  matched.push({...b,sgoID:a.id,sgoHomeID:a.homeID,sgoAwayID:a.awayID,sourcePair:[a.id,b.id],scoresReconciled:a.completed&&b.completed});
 }
 return {matched,conflicts,unmatched};
}
export function parseMembership(payload,season){
 if(!Array.isArray(payload?.items)||payload.pageCount!==1||payload.count!==payload.items.length||!payload.count)throw Error('FBS_INVENTORY_INCOMPLETE');
 const ids=payload.items.map(item=>{
  let u;try{u=new URL(item.$ref);}catch{throw Error('FBS_IDENTITY_INVALID');}
  const match=u.pathname.match(/^\/v2\/sports\/football\/leagues\/college-football\/seasons\/(\d{4})\/teams\/(\d+)\/?$/);
  if(u.hostname!=='sports.core.api.espn.com'||!match||Number(match[1])!==season)throw Error('FBS_SEASON_IDENTITY_MISMATCH');
  return match[2];
 });
 if(new Set(ids).size!==ids.length)throw Error('DUPLICATE_FBS_IDENTITY');return ids;
}
export function validateSchedule(payload,teamID,season,fetchedAt){
 if(String(payload?.team?.id)!==String(teamID)||!Array.isArray(payload?.events))throw Error('TEAM_SCHEDULE_INVALID');
 const games=payload.events.map(e=>normalizeEspnGame(e,fetchedAt));
 if(games.some(g=>g.season!==season||!g.id||!g.startsAt||![g.homeID,g.awayID].includes(String(teamID))||!g.homeID||!g.awayID||g.homeID===g.awayID))throw Error('SCHEDULE_SEASON_OR_IDENTITY_MISMATCH');
 if(new Set(games.map(g=>g.id)).size!==games.length)throw Error('DUPLICATE_EVENT');
 return {teamID:String(teamID),season,fetchedAt,games};
}
export function assembleHistory(schedules,membership){
 const events=new Map(),conflicts=new Set(),missing=[],observed=new Map();
 for(const [season,ids] of Object.entries(membership))for(const id of ids){if(!schedules.some(s=>s.season===Number(season)&&s.teamID===id))missing.push(`${season}:${id}`);}
 for(const schedule of schedules)for(const game of schedule.games){
  const eligible=membership[game.season]?.includes(game.homeID)&&membership[game.season]?.includes(game.awayID);
  if(!eligible)continue;
  const key=game.season+':'+game.id,old=events.get(key);
  if(!observed.has(key))observed.set(key,new Set());observed.get(key).add(schedule.teamID);
  if(old&&['startsAt','homeID','awayID','homeScore','awayScore','completed','neutralSite','cancelled'].some(k=>old[k]!==game[k]))conflicts.add(key);
  if(!old||Date.parse(game.fetchedAt)>Date.parse(old.fetchedAt))events.set(key,{...game,fbsVerified:true});
 }
 for(const [key,g] of events)if(!observed.get(key)?.has(g.homeID)||!observed.get(key)?.has(g.awayID))conflicts.add(key);
 return {games:[...events].filter(([k])=>!conflicts.has(k)).map(([,v])=>v),complete:!missing.length&&!conflicts.size,missing,conflicts:[...conflicts]};
}
