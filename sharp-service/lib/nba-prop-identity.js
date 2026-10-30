const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams';
const cache=new Map();
const name=v=>typeof v==='string'?v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[.]/g,'').replace(/’/g,"'").trim().toLowerCase().replace(/\s+/g,' '):'';
async function read(url,fetchImpl) {
 const useCache=fetchImpl===globalThis.fetch,old=cache.get(url);
 if(useCache&&old&&Date.now()-old.at<300000)return old.data;
 const response=await fetchImpl(url,{signal:AbortSignal.timeout(4000),headers:{accept:'application/json'}});
 if(!response.ok)throw Error('Roster source unavailable');
 const data=await response.json();
 if(useCache){cache.set(url,{at:Date.now(),data});if(cache.size>40)cache.delete(cache.keys().next().value);}
 return data;
}
export async function verifyNbaPropRosters(events,{fetchImpl=globalThis.fetch}={}) {
 const rosters=new Map(),teams=[...new Set(events.flatMap(e=>[name(e.matchup?.home?.name),name(e.matchup?.away?.name)]).filter(Boolean))];
 try {
  const directory=await read(BASE+'?limit=40',fetchImpl);
  const list=directory?.sports?.[0]?.leagues?.[0]?.teams;
  if(!Array.isArray(list))throw Error('Invalid roster directory');
  await Promise.all(teams.slice(0,30).map(async team=>{
   const matches=list.filter(r=>name(r.team?.displayName)===team&&/^[1-9]\d*$/.test(String(r.team?.id)));
   if(matches.length!==1)return;
   const id=String(matches[0].team.id);
   try {
    const roster=await read(BASE+'/'+id+'/roster',fetchImpl);
    if(String(roster.team?.id)!==id||name(roster.team?.displayName)!==team||!Array.isArray(roster.athletes)||!roster.athletes.length)return;
    const athletes=roster.athletes.filter(a=>/^[1-9]\d*$/.test(String(a.id))&&name(a.displayName));
    if(athletes.length!==roster.athletes.length)return;
    rosters.set(team,athletes);
   }catch{/* Keep observations explicitly unverified when ESPN is unavailable. */}
  }));
 }catch{/* Do not substitute provider names for independent roster verification. */}
 const health={status:'UNAVAILABLE',source:'ESPN current team rosters',matched:0,excluded:0,unverified:0,checkedAt:new Date().toISOString(),availabilityVerified:false};
 const checked=events.map(event=>{
  const home=name(event.matchup?.home?.name),away=name(event.matchup?.away?.name);
  const complete=home!==away&&rosters.has(home)&&rosters.has(away);
  const players=(event.players||[]).flatMap(player=>{
   const prop={...player.prop,identityStatus:'UNVERIFIED',espnPlayerID:null};
   if(!complete){health.unverified++;return [{...player,prop}];}
   const target=name(prop.playerName),matches=new Map();
   for(const team of [home,away])for(const a of rosters.get(team)){
    if(target&&(name(a.displayName)===target||name(a.fullName)===target))matches.set(String(a.id)+'|'+team,{id:String(a.id),team});
   }
   if(matches.size!==1){health.excluded++;return [];}
   const match=[...matches.values()][0];health.matched++;
   return [{...player,prop:{...prop,identityStatus:'ROSTER_MATCHED',espnPlayerID:match.id,verifiedTeam:match.team,identitySource:'ESPN current team rosters',identityCheckedAt:health.checkedAt}}];
  });
  return {...event,players};
 }).filter(e=>e.players.length);
 health.status=health.matched?(health.excluded||health.unverified?'PARTIAL':'ROSTER_MATCHED'):health.excluded?'MISMATCH':'UNAVAILABLE';
 return {events:checked,health};
}
