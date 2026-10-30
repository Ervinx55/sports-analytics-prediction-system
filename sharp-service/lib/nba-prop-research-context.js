import { loadNbaEspnHistory } from './nba-espn-history.js';
import { loadNbaPropHistory } from './nba-prop-history.js';
import { buildNbaPropContext, NBA_PROP_CONTEXT_VERSION } from './nba-prop-context.js';
import { seasonForDate } from './nba-model.js';

const name = v => typeof v==='string' ? v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[.]/g,'').replace(/’/g,"'").trim().toLowerCase().replace(/\s+/g,' ') : '';
const supported = new Set(['points','rebounds','assists']);
const unavailable = (reason, cutoff, market) => ({version:NBA_PROP_CONTEXT_VERSION,market,cutoff,baselineProjection:null,contextAdjustedProjection:null,modelProbability:null,productionWeight:0,eligible:false,historicalPointInTimeEligible:false,features:{},blockers:[reason]});
const gate = (event, player, cutoff) => !supported.has(player.prop?.statID) ? 'UNSUPPORTED_MARKET' : player.prop?.identityStatus!=='ROSTER_MATCHED' || !/^[1-9]\d*$/.test(String(player.prop?.espnPlayerID)) ? 'PLAYER_IDENTITY_UNVERIFIED' : !Number.isFinite(Date.parse(event.startsAt)) || Date.parse(event.startsAt)<=Date.parse(cutoff) ? 'EVENT_ALREADY_STARTED' : null;

// Allocate the global summary budget round-robin across requested teams.
function balancedGames(games, teamIds, limit) {
  const sorted=[...games].sort((a,b)=>Date.parse(b.datetime)-Date.parse(a.datetime));
  const selected=new Map(), queues=teamIds.map(id=>sorted.filter(g=>[g.home_team?.id,g.visitor_team?.id].map(String).includes(id)));
  while(selected.size<limit) {
    let added=false;
    for(const queue of queues) {
      while(queue.length && selected.has(String(queue[0].id)))queue.shift();
      if(queue.length && selected.size<limit){const g=queue.shift();selected.set(String(g.id),g);added=true;}
    }
    if(!added)break;
  }
  return [...selected.values()];
}

/** Enrichment must never suppress a provider quote, including on a source outage. */
export async function enrichNbaPropResearchContext(events, {clock=()=>new Date().toISOString(),loadHistory=loadNbaEspnHistory,loadPropHistory=loadNbaPropHistory}={}) {
  const initial=clock(), season=seasonForDate(new Date(initial));
  const health={status:'UNAVAILABLE',source:'ESPN historical summaries',version:NBA_PROP_CONTEXT_VERSION,productionWeight:0,requestedGames:0,loadedGames:0,baselineCount:0,contextCount:0,cutoff:initial,reasons:[],samplePolicy:{maxSummaryGames:12,lookbackDays:12,currentSeasonOnly:true,selection:'round-robin across relevant teams',minimumPlayerGames:3}};
  let games=[], observations=[], teamNames=new Map(),teamIds=[], sourceReason=null;
  const eligible=events.flatMap(event=>(event.players||[]).filter(player=>!gate(event,player,initial)).map(player=>({event,player})));
  if(eligible.length) {
    try {
      const history=await loadHistory({targetAt:initial,teams:[],clock});
      if(!history?.ok) throw Error(history?.reason||'HISTORY_UNAVAILABLE');
      // Discard conflicting duplicate IDs before mapping or sampling.
      const byId=new Map(), conflicts=new Set();
      for(const g of history.games||[]){const id=String(g.id);if(byId.has(id)&&JSON.stringify(byId.get(id))!==JSON.stringify(g))conflicts.add(id);else byId.set(id,g);}
      games=[...byId.values()].filter(g=>!conflicts.has(String(g.id))&&g.season===season);
      if(conflicts.size)health.reasons.push('CONFLICTING_GAME_RECORDS');
      const byName=new Map(),byTeam=new Map();
      for(const g of games)for(const t of [g.home_team,g.visitor_team]){const n=name(t?.full_name),id=String(t?.id||'');if(!n||!/^[1-9]\d*$/.test(id))continue;if(!byName.has(n))byName.set(n,new Set());byName.get(n).add(id);if(!byTeam.has(id))byTeam.set(id,new Set());byTeam.get(id).add(n);}
      teamNames=new Map([...byName].filter(([,ids])=>ids.size===1&&byTeam.get([...ids][0]).size===1).map(([n,ids])=>[n,[...ids][0]]));
      teamIds=[...new Set(eligible.flatMap(({event})=>[teamNames.get(name(event.matchup?.home?.name)),teamNames.get(name(event.matchup?.away?.name))]).filter(Boolean))].sort();
      const selected=balancedGames(games,teamIds,12);
      health.requestedGames=selected.length;
      health.availableGames=games.filter(g=>[g.home_team?.id,g.visitor_team?.id].map(String).some(id=>teamIds.includes(id))).length;
      health.sampleLimited=health.availableGames>selected.length;
      if(selected.length){const result=await loadPropHistory({games:selected,teamIds,cutoff:initial,clock,maxGames:12});observations=result?.observations||[];health.reasons.push(...(result?.reasons||[]));if(!result?.ok)sourceReason='SUMMARY_UNAVAILABLE';}
      else sourceReason='NO_ELIGIBLE_TEAM_HISTORY';
    }catch(error){sourceReason='CONTEXT_SOURCE_UNAVAILABLE';health.reasons.push(error?.message||sourceReason);}
  }
  const cutoff=clock(),cache=new Map();health.cutoff=cutoff;health.loadedGames=observations.length;
  const checked=events.map(event=>({...event,players:(event.players||[]).map(player=>{
    let reason=gate(event,player,cutoff);
    const home=name(event.matchup?.home?.name),away=name(event.matchup?.away?.name),verified=name(player.prop?.verifiedTeam);
    const own=verified===home?home:verified===away?away:null,other=own===home?away:home;
    const teamId=own&&teamNames.get(own),opponentTeamId=teamNames.get(other);
    if(!reason&&(!own||home===away||!teamId||!opponentTeamId||teamId===opponentTeamId))reason='TEAM_HISTORY_IDENTITY_UNVERIFIED';
    if(!reason&&sourceReason)reason=sourceReason;
    let context;
    if(reason)context=unavailable(reason,cutoff,player.prop?.statID);
    else {
      const key=[player.prop.espnPlayerID,teamId,opponentTeamId,player.prop.statID].join('|');
      if(!cache.has(key))cache.set(key,buildNbaPropContext({observations,playerId:player.prop.espnPlayerID,teamId,opponentTeamId,targetGameId:event.espnEventID||null,cutoff,season,market:player.prop.statID}));
      context=cache.get(key);health.contextCount++;if(context.baselineProjection!==null)health.baselineCount++;
    }
    return {...player,context};
  })}));
  health.reasons=[...new Set([...health.reasons,...(sourceReason?[sourceReason]:[])])];
  health.status=health.baselineCount?(health.reasons.length||health.sampleLimited?'PARTIAL':'AVAILABLE'):health.contextCount?'PARTIAL':'UNAVAILABLE';
  return {events:checked,health};
}
