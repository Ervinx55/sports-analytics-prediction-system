const stamp=v=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const name=v=>typeof v==='string'?v.trim().toLowerCase().replace(/\s+/g,' '):null;
const id=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
/** No fuzzy team matching; reversed teams, schedule drift or duplicate matches stay unresolved. */
export function matchNbaEvent(forecast,events){
 const start=stamp(forecast?.startsAt),home=name(forecast?.home),away=name(forecast?.away);
 if(start===null||!home||!away||home===away||!Array.isArray(events))return {ok:false,reason:'INVALID_FORECAST_IDENTITY'};
 const matches=events.filter(e=>{
  if(!id(e?.id)||e.uid!==`s:40~l:46~e:${e.id}`||e.competitions?.length!==1)return false;
  const c=e.competitions[0],t=stamp(c.date),teams=c.competitors;
  if(c.id!==e.id||t===null||Math.abs(t-start)>15*60000||!Array.isArray(teams)||teams.length!==2)return false;
  const h=teams.find(x=>x.homeAway==='home'),a=teams.find(x=>x.homeAway==='away');
  return id(h?.id)&&id(a?.id)&&h.id!==a.id&&h.team?.id===h.id&&a.team?.id===a.id&&name(h.team.displayName)===home&&name(a.team.displayName)===away;
 });
 if(matches.length!==1)return {ok:false,reason:matches.length?'AMBIGUOUS_EVENT_MATCH':'NO_EXACT_EVENT_MATCH'};
 const e=matches[0],c=e.competitions[0];return {ok:true,eventId:e.id,eventKey:`espn:nba:${e.id}`,startsAt:new Date(c.date).toISOString(),eligibilityStartsAt:new Date(Math.min(start,Date.parse(c.date))).toISOString(),homeTeamId:c.competitors.find(t=>t.homeAway==='home').id,awayTeamId:c.competitors.find(t=>t.homeAway==='away').id};
}
