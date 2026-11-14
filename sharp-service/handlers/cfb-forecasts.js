import {timingSafeEqual,randomUUID} from 'node:crypto';
import {protectedSportsGameOddsFetch,optimizeSportsGameOddsObjectLimit} from '../lib/provider-protection.js';
import {normalizeSgoGame,reconcileGames,assembleHistory,validateSchedule} from '../lib/cfb-sources.js';
import {forecastGames,prospectiveEligible,scoreForecasts} from '../lib/cfb-model.js';
import {contentHash,evaluateCandidates} from '../lib/cfb-evaluation.js';
const sameSecret=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length>0&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const safeReport=r=>r?{status:r.status,modelVersion:r.modelVersion,config:r.config,development:r.development&&{n:r.development.n,brier:r.development.brier,logLoss:r.development.logLoss},holdout:r.holdout&&{n:r.holdout.n,brier:r.holdout.brier,logLoss:r.holdout.logLoss,accuracy:r.holdout.accuracy},marketComparison:r.marketComparison,limitations:r.limitations,productionEligible:false}:null;
export function createCfbHandler({env=process.env,fetchImpl=fetch,providerFetch=protectedSportsGameOddsFetch,optimize=optimizeSportsGameOddsObjectLimit,now=Date.now}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');const key=env.EDGE_LAB_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY;
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or authenticated POST required'});
  if(req.method==='POST'&&!sameSecret(req.headers?.authorization,'Bearer '+key))return res.status(401).json({error:'UNAUTHORIZED'});
  if(!key)return res.status(503).json({error:'CFB service unavailable',forecasts:[]});
  const body=typeof req.body==='string'?(()=>{try{return JSON.parse(req.body);}catch{return {};}})():req.body||{};
  const action=body.action;
  if(req.method==='POST'&&(!['seed','history','refresh'].includes(action)||(action==='history'&&![2024,2025,2026].includes(body.season))))return res.status(400).json({error:'INVALID_CFB_ACTION'});
  const headers={'content-type':'application/json',apikey:key};if(key.startsWith('eyJ'))headers.authorization='Bearer '+key;
  const db=async(path,options={})=>{const r=await fetchImpl((env.SUPABASE_URL||'https://yeoxroijaptomomshdii.supabase.co').replace(/\/$/,'')+'/rest/v1/'+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('DATABASE_'+r.status);if(r.status===204)return null;if(typeof r.text==='function'){const text=await r.text();return text?JSON.parse(text):null;}return r.json();};
  const read=async name=>(await db('cfb_research_documents?doc_key=eq.'+encodeURIComponent(name)+'&select=body&limit=1'))?.[0]?.body??null;
  const save=async(name,value,immutable=false)=>db('cfb_research_documents?on_conflict=doc_key',{method:'POST',headers:{Prefer:immutable?'resolution=ignore-duplicates,return=minimal':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({doc_key:name,body:value,updated_at:new Date(now()).toISOString()})});
  let token;
  try{
   if(req.method==='GET'){
    const latest=await read('latest');if(!latest)return res.status(200).json({status:'AWAITING_COLLECTION',forecasts:[],productionEligible:false});
    const age=now()-Date.parse(latest.generatedAt),stale=!Number.isFinite(age)||age<0||age>30*60000;
    return res.status(200).json({...latest,forecasts:stale?[]:latest.forecasts.filter(f=>Date.parse(f.startsAt)>now()),status:stale?'COLLECTION_STALE':latest.status,productionEligible:false});
   }
   token=randomUUID();const locked=await db('rpc/claim_cfb_collection',{method:'POST',body:JSON.stringify({p_token:token})});
   if(locked!==true){token=null;return res.status(409).json({error:'COLLECTION_IN_PROGRESS'});}
   const stamp=new Date(now()).toISOString();
   if(action==='seed'){
    if(!body.source)body.source=await read('seed-source');
    if(!Array.isArray(body.source?.schedules)||body.source.schedules.length>500||![2024,2025,2026].every(s=>Array.isArray(body.source.membership?.[s])&&body.source.membership[s].every(id=>/^\d+$/.test(id))))return res.status(422).json({error:'SOURCE_EVIDENCE_REQUIRED'});
    const source={...body.source,...assembleHistory(body.source.schedules,body.source.membership),fetchedAt:stamp};
    if(!source.complete)return res.status(422).json({error:'SOURCE_COVERAGE_INCOMPLETE',missing:source.missing.length,conflicts:source.conflicts.length});
    const report=evaluateCandidates(source),existing=await read('frozen-model');
    if(report.status==='BLOCKED')return res.status(422).json({error:'EVALUATION_BLOCKED'});
    if(existing&&existing.modelVersion!==report.modelVersion)return res.status(409).json({error:'MODEL_ALREADY_FROZEN'});
    await save('source:'+contentHash(source),source,true);await save('source-current',source);await save('frozen-model',report,true);
    return res.status(200).json({status:'SEEDED',games:source.games.length,evaluation:safeReport(report)});
   }
   const apiKey=env.SPORTS_ODDS_API_KEY||env.SPORTSGAMEODDS_API_KEY;if(!apiKey)return res.status(503).json({error:'CFB_PROVIDER_UNAVAILABLE'});
   const policy=await optimize({apiKey,requestedLimit:100,priority:'background',fanout:1});
   if(policy.blocked){res.setHeader('Retry-After','60');return res.status(429).json({error:'PROVIDER_BUDGET_RESERVED'});}
   const params=new URLSearchParams({leagueID:'NCAAF',type:'match',limit:String(policy.effectiveLimit||100),oddIDs:'points-home-game-ml-home,points-away-game-ml-away',includeOpenCloseOdds:'true',includeAltLines:'false'});
   if(action==='history'){
    params.set('finalized','true');params.set('startsAfter',`${body.season}-08-01T00:00:00Z`);params.set('startsBefore',`${body.season+1}-02-01T00:00:00Z`);
    if(body.cursor){if(typeof body.cursor!=='string'||body.cursor.length>2000)return res.status(400).json({error:'INVALID_CURSOR'});params.set('cursor',body.cursor);}
   }else{params.set('finalized','false');params.set('oddsAvailable','true');params.set('startsAfter',stamp);params.set('startsBefore',new Date(now()+48*3600000).toISOString());}
   const sgo=await providerFetch({url:'https://api.sportsgameodds.com/v2/events?'+params,apiKey,freshMs:action==='history'?86400000:60000,staleMs:action==='history'?86400000:60000,timeoutMs:8000,consumer:'cfb-research',priority:'background',objectPolicy:policy});
   if(sgo.upstreamError||sgo.ageMs>60000&&action!=='history'||!Array.isArray(sgo.payload?.data))throw Error('PROVIDER_STALE_OR_INVALID');
   const raw=sgo.payload.data,games=raw.map(e=>normalizeSgoGame(e,new Date(sgo.fetchedAt).toISOString())).filter(g=>g.league==='NCAAF');
   await save('sgo:'+contentHash({params:String(params),data:raw}),{parameters:String(params),fetchedAt:new Date(sgo.fetchedAt).toISOString(),events:raw,nextCursor:sgo.payload.nextCursor||null},true);
   if(action==='history')return res.status(200).json({status:'COLLECTED',season:body.season,eventCount:games.length,nextCursor:sgo.payload.nextCursor||null,sample:games.slice(0,2)});
   const [source,model]=await Promise.all([read('source-current'),read('frozen-model')]);
   if(!source||!model)return res.status(409).json({error:'HISTORY_AND_FROZEN_MODEL_REQUIRED'});
   // Stage a whole rotation before replacing the coherent last-good history.
   const staging=await read('source-staging')||structuredClone(source);
   const season=2026,ids=source.membership[season],offset=Number(staging.refreshOffset||0)%ids.length;
   const selected=ids.slice(offset,offset+8);
   const updates=await Promise.allSettled(selected.map(async id=>{const r=await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${id}/schedule?season=${season}`,{signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error('SCHEDULE_UNAVAILABLE');return validateSchedule(await r.json(),id,season,stamp);}));
   for(const result of updates)if(result.status==='fulfilled'){const s=result.value;staging.schedules=staging.schedules.filter(old=>old.season!==s.season||old.teamID!==s.teamID);staging.schedules.push(s);}
   staging.refreshOffset=(offset+8)>=ids.length?0:offset+8;
   if(staging.refreshOffset===0){Object.assign(staging,assembleHistory(staging.schedules,staging.membership));if(staging.complete){Object.assign(source,staging);await save('source-current',source);}}
   await save('source-staging',staging);
   const paired=reconcileGames(games,source.games.filter(g=>g.season===season&&!g.completed&&!g.cancelled));
   const eligible=paired.matched.filter(g=>{
    const teamSources=source.schedules.filter(s=>s.season===season&&[g.homeID,g.awayID].includes(s.teamID));
    return teamSources.length===2&&teamSources.every(s=>now()-Date.parse(s.fetchedAt)<=12*3600000)&&!source.conflicts.some(k=>k.endsWith(':'+g.id));
   });
   const forecasts=source.complete?forecastGames(source.games,eligible,model.config,stamp):{forecasts:[],excluded:[{reasons:['SOURCE_RECONCILIATION_INCOMPLETE']}]};
   const payload={status:'RESEARCH_NOT_CLEARED',generatedAt:stamp,modelVersion:model.modelVersion,evaluation:safeReport(model),provider:'SportsGameOdds',providerFetchedAt:new Date(sgo.fetchedAt).toISOString(),coverage:{providerEvents:games.length,providerComplete:!sgo.payload.nextCursor,matched:paired.matched.length,forecasts:forecasts.forecasts.length,identityUnmatched:paired.unmatched.length,historyComplete:source.complete,historyConflicts:source.conflicts.length,scheduleRefreshFailures:updates.filter(r=>r.status==='rejected').length,excluded:forecasts.excluded.length},forecasts:forecasts.forecasts.map(f=>({...f,modelVersion:model.modelVersion,generatedAt:stamp})),productionEligible:false};
   payload.contract='cfb-research-v1';
   const inputHash=contentHash(source.games);await save('input:'+inputHash,{games:source.games,membership:source.membership,recordedAt:stamp},true);let captured=0;
   for(const f of payload.forecasts.filter(f=>prospectiveEligible(f,stamp))){
    const quote=raw.find(e=>e.eventID===f.eventID)?.odds||{};
    const rows=await db('cfb_prospective_forecasts?on_conflict=event_id,model_version',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({event_id:f.eventID,model_version:model.modelVersion,captured_at:stamp,starts_at:f.startsAt,forecast:{...f,entryQuotes:quote},input_hash:inputHash})});captured+=rows?.length||0;
   }
   const saved=await db('cfb_prospective_forecasts?select=event_id,model_version,starts_at,forecast&limit=1000');
   const scored=[];for(const prediction of saved){const final=source.games.find(g=>g.id===prediction.forecast.espnEventID);if(!final?.completed)continue;const rescheduled=Date.parse(final.startsAt)!==Date.parse(prediction.starts_at);const outcome={espnEventID:final.id,homeScore:final.homeScore,awayScore:final.awayScore,rescheduled,valid:!rescheduled&&!final.cancelled&&Number.isInteger(final.homeScore)&&Number.isInteger(final.awayScore)&&final.homeScore!==final.awayScore,source:'ESPN',fetchedAt:final.fetchedAt};
    await db('cfb_outcome_revisions?on_conflict=event_id,evidence_hash',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({event_id:prediction.event_id,evidence_hash:contentHash({...outcome,fetchedAt:undefined}),outcome})});
    if(outcome.valid)scored.push({probability:prediction.forecast.homeProbability,outcome:final.homeScore>final.awayScore?1:0});
   }
   payload.prospective={captured:saved.length,...scoreForecasts(scored)};await save('latest',payload);
   return res.status(200).json({...payload,captured});
  }catch(error){const limited=error?.status===429;if(limited)res.setHeader('Retry-After',String(Math.max(1,Number(error.retryAfter)||60)));return res.status(limited?429:503).json({error:limited?'PROVIDER_RATE_LIMIT':'CFB_COLLECTION_UNAVAILABLE',forecasts:[],productionEligible:false});}
  finally{if(token)try{await db('cfb_research_documents?doc_key=eq._collection_lease&body->>token=eq.'+token,{method:'DELETE'});}catch{}}
 };
}
export default createCfbHandler();
