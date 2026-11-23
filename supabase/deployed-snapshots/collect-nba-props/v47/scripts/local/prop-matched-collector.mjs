import {probabilityForecast} from './nba-probability.mjs';
import {matchOfficialInjury} from './official-injury.mjs';
import {createHash} from 'node:crypto';
import {normalizeResearch} from '../../sharp-service/research-data.js';
import {matchedFeatures,projectCandidate,injuryEvidence,parseMatchedSummary} from './nba-matched-context.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const time=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
export function createMatchedCollector(artifact,cache={},loadOfficialReport=async()=>null,options={}){
 if(artifact?.policy?.version!=='nba-defense-development-v1'||artifact.policy.productionWeight!==0)throw Error('Invalid pinned model');
 const modelHash=hash(options.probabilityArtifact?{context:artifact,probability:options.probabilityArtifact}:artifact);cache.summaries??={};
 return async(body,db,{get,clock})=>{
  const officialReport=await loadOfficialReport();
  const started=clock(),seasonEnd=new Date(started).getUTCMonth()>=8?new Date(started).getUTCFullYear()+1:new Date(started).getUTCFullYear();
  const rows=normalizeResearch(body,'NBA',Date.parse(started)).filter(r=>['points','rebounds','assists'].includes(r.marketType)&&r.identityStatus==='ROSTER_MATCHED'&&/^\d+$/.test(r.espnPlayerID)&&r.context?.teamId&&r.context?.opponentTeamId&&r.freshness==='CURRENT'&&r.market!==null);
  const pairKey=r=>[String(r.context.teamId),String(r.context.opponentTeamId)].sort().join(':');
  const pairs=[...new Set(rows.map(pairKey))].sort();
  const cursor=Number.isSafeInteger(cache.teamPairCursor)&&cache.teamPairCursor>=0?cache.teamPairCursor:0;
  const selected=new Set(),teams=[];
  let visited=0;
  for(;visited<pairs.length;visited++){
   const pair=pairs[(cursor+visited)%pairs.length],extra=pair.split(':').filter(id=>!teams.includes(id));
   if(teams.length+extra.length>(options.teamLimit??16))break;
   teams.push(...extra);selected.add(pair);
  }
  cache.teamPairCursor=pairs.length?(cursor+visited)%pairs.length:0;
  const selectedRows=rows.filter(r=>selected.has(pairKey(r)));
  const schedules=new Map(),rosters=new Map(),stats={inserted:0,baselineOnly:0,blocked:0,summaryRequests:0,officialReportAvailable:Boolean(officialReport),officialMatches:0,reasons:[]};
  stats.deferred=rows.length-selectedRows.length;
  if(stats.deferred)stats.reasons.push('TEAM_BATCH_DEFERRED');
  for(const id of teams){
   if(!/^\d+$/.test(id))continue;
   const r=await get(`${BASE}/teams/${id}/schedule?season=${seasonEnd}&seasontype=2`,'espn');
   if(!r.ok){stats.reasons.push('SCHEDULE_UNAVAILABLE');continue;}
   const b=r.body;if(String(b.team?.id)!==id||Number(b.season?.year)!==seasonEnd||Number(b.season?.type)!==2||!Array.isArray(b.events)||b.events.length<1||b.events.length>100){stats.reasons.push('INVALID_SEASON_SCHEDULE');continue;}
   const seen=new Set(),ids=[];let invalid=false;
   for(const e of b.events){const c=e.competitions?.[0];
    if(e.competitions?.length!==1||!/^\d+$/.test(String(e.id))||seen.has(String(e.id))||String(c?.id)!==String(e.id)||!Number.isFinite(time(c.date))||!c.competitors?.some(t=>String(t.id)===id)){invalid=true;break;}seen.add(String(e.id));
    if(time(c.date)>Date.parse(started))continue;
    if(c.status?.type?.completed!==true){if(c.status?.type?.name!=='STATUS_POSTPONED')invalid=true;continue;}
    if(c.status.type.name!=='STATUS_FINAL'||Number(e.seasonType?.type)!==2){invalid=true;continue;}ids.push(String(e.id));
   }
   if(!invalid)schedules.set(id,ids);else stats.reasons.push('INCOMPLETE_SEASON_SCHEDULE');
   const roster=await get(`${BASE}/teams/${id}/roster`,'espn');if(roster.ok&&Number(roster.body.season?.year)===seasonEnd)rosters.set(id,{body:roster.body,observedAt:clock()});
  }
  if(options.loadSummaries)Object.assign(cache.summaries,await options.loadSummaries([...new Set([...schedules.values()].flat())]));
  for(const id of new Set([...schedules.values()].flat())){
   if(cache.summaries[id])continue;
   if(stats.summaryRequests>=(options.summaryLimit??24)){stats.reasons.push('SUMMARY_WARMUP_REQUIRED');break;}
   stats.summaryRequests++;const r=await get(`${BASE}/summary?event=${id}`,'espn');if(!r.ok)continue;
   try{cache.summaries[id]=parseMatchedSummary(r.body,id,clock(),seasonEnd);}catch{stats.reasons.push('INCOMPLETE_PLAYER_BOXSCORE');}
  }
  for(const r of selectedRows){try{
   const issuedAt=clock(),issued=Date.parse(issuedAt);
   if([r.generatedAt,r.updatedAt,r.oppositeUpdatedAt].some(v=>!Number.isFinite(time(v))||time(v)>issued||issued-time(v)>600000)||time(r.startsAt)<=issued)throw Error('QUOTE_EXPIRED_DURING_COLLECTION');
   const teamId=String(r.context.teamId),opponentTeamId=String(r.context.opponentTeamId);
   if(!schedules.has(teamId)||!schedules.has(opponentTeamId))throw Error('SCHEDULE_COVERAGE_UNAVAILABLE');
   const ids=[...new Set([...schedules.get(teamId),...schedules.get(opponentTeamId)])];if(ids.some(id=>!cache.summaries[id]))throw Error('HISTORY_WARMUP_REQUIRED');
   const q={teamId,opponentTeamId,playerId:r.espnPlayerID,market:r.marketType,startsAt:r.startsAt,cutoff:issuedAt};
   const roster=rosters.get(teamId),injury=injuryEvidence(roster?.body,q,roster?.observedAt??issuedAt);
   if(!injury.playerMatched)throw Error('CURRENT_ROSTER_UNVERIFIED');
   const x=matchedFeatures(ids.map(id=>cache.summaries[id]),q),projection=projectCandidate(x,artifact.models[r.marketType]?.combined,r.marketType);
   x.historyDigest=hash(ids.map(id=>cache.summaries[id]));x.featureContract='nba-defense-live-v1';
   const athlete=roster.body.athletes.find(p=>String(p.id)===q.playerId),own=roster.body.team,other=rosters.get(opponentTeamId)?.body?.team;
   const normalize=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'').replace('losangelesclippers','laclippers');
   const home=normalize(r.home)===normalize(own.displayName),away=normalize(r.away)===normalize(own.displayName);
   const matchup=own.abbreviation&&other?.abbreviation&&(home!==away)?(home?`${other.abbreviation}@${own.abbreviation}`:`${own.abbreviation}@${other.abbreviation}`):null;
   const officialInjury=matchOfficialInjury(officialReport,{startsAt:r.startsAt,issuedAt,teamName:own.displayName,matchup,firstName:athlete.firstName,lastName:athlete.lastName});
   if(officialInjury.status!=='UNKNOWN')stats.officialMatches++;
   const identity=hash([r.eventID,r.espnPlayerID,r.marketType,r.side,r.line,r.book]);
   const probability=options.probabilityArtifact?probabilityForecast(options.probabilityArtifact,r.marketType,x.baseline,r.line,r.side,issuedAt):null;
   const record={identity,modelHash,issuedAt,startsAt:r.startsAt,eventID:r.eventID,playerID:r.espnPlayerID,market:r.marketType,side:r.side,line:r.line,book:r.book,odds:r.odds,quoteAt:r.updatedAt,oppositeQuoteAt:r.oppositeUpdatedAt,marketProbability:r.market,baselineProjection:x.baseline,candidateProjection:r.marketType==='assists'?null:projection,mode:r.marketType==='assists'?'BASELINE_ONLY':'DEVELOPMENT_OBSERVATION',features:x,injury,officialInjury,productionWeight:0,productionEligible:false,probability,modelProbability:probability?.modelProbability??null,blockers:['PROJECTED_MINUTES_UNVERIFIED','PARTICIPATION_UNVERIFIED','BOOK_SETTLEMENT_UNVERIFIED','UNTOUCHED_PROTOCOL_NOT_FROZEN','NO_VALIDATED_PROBABILITY']};
   if(['Out','Doubtful','Questionable'].includes(officialInjury.status))record.blockers.push('OFFICIAL_STATUS_'+officialInjury.status.toUpperCase());
   const inserted=db.appendForecast(record);stats.inserted+=inserted;if(r.marketType==='assists')stats.baselineOnly+=inserted;
  }catch(e){stats.blocked++;stats.reasons.push(e.message);}}
  stats.reasons=[...new Set(stats.reasons)];return stats;
 };
}
