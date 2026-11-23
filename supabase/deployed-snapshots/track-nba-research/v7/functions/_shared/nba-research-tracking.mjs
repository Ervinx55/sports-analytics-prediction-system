import {adaptNbaTeamResponse} from './performance-nba-adapter.mjs';
import {fetchResultResponse} from './performance-worker.mjs';
import {matchNbaEvent} from './nba-event-match.mjs';
import {gradeMarket} from './team-market-grading.mjs';
const time=v=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
export function researchOutcome(p,events,retrievedAt=new Date().toISOString()){
 if(p?.sport!=='NBA'||p.modelMode!=='SHADOW'||p.provenance?.productionWeight!==0)return null;
 if(!(['moneyline','spread'].includes(p.marketType)?['home','away']:p.marketType==='total'?['over','under']:[]).includes(p.side))return null;
 const match=matchNbaEvent({startsAt:p.startsAt,...p.provenance?.raw},events);
 if(!match.ok||!Number.isFinite(time(p.capturedAt))||!Number.isFinite(time(p.provenance?.receivedAt))||Math.max(time(p.capturedAt),time(p.provenance.receivedAt))>=time(match.eligibilityStartsAt))return null;
 const c=events.find(e=>e.id===match.eventId).competitions[0],s=c.status;
 if(s?.type?.completed!==true||s.type.state!=='post'||s.type.name!=='STATUS_FINAL'||!Number.isInteger(s.period)||s.period<4)return null;
 const score=side=>{const v=c.competitors.find(t=>t.homeAway===side)?.score;return typeof v==='string'&&/^\d+$/.test(v)?Number(v):NaN;};
 const home=score('home'),away=score('away');
 if(!Number.isSafeInteger(home)||!Number.isSafeInteger(away)||home===away||home<=0||away<=0)return null;
 const grade=gradeMarket({market_type:p.marketType,market_side:p.side,line:p.line},away,home);
 if(!grade)return null;
 return {predictionId:p.id,outcome:{W:'WIN',L:'LOSS',PUSH:'PUSH'}[grade.outcome],actualValue:grade.actualValue,homeScore:home,awayScore:away,source:'espn',sourceUpdatedAt:null,retrievedAt,ruleVersion:'nba-full-game-research-v1',reason:'RESEARCH_DIRECTION_ONLY',researchOnly:true,officialEventId:match.eventId,identityObservedAt:retrievedAt,period:'INCLUDING_OVERTIME',settledAt:retrievedAt};
}
export function nbaResearchRepository(sql){
 const run=(mode,fn)=>sql.begin(mode,async tx=>{await tx.unsafe("set local statement_timeout='8s'");await tx.unsafe('set local role service_role');return fn(tx);});
 return {
 async authorized(header){if(typeof header!=='string'||!header.startsWith('Bearer ')||header.length<8)return false;
 const r=await sql.begin('read only',async tx=>{await tx.unsafe("set local statement_timeout='3s'");return tx.unsafe("select exists(select 1 from vault.decrypted_secrets where name='performance_service_role_key' and decrypted_secret=$1) as allowed",[header.slice(7)]);});return r[0]?.allowed===true;},
 async enabled(){const r=await run('read only',tx=>tx.unsafe("select enabled from public.pipeline_component_registry where component_key='performance_nba_capture_team'"));return r[0]?.enabled===true;},
 async cooldown(provider){const r=await run('read only',tx=>tx.unsafe("select exists(select 1 from public.performance_provider_cooldowns where sport='NBA' and provider=$1 and cooldown_until>now()) as blocked",[provider]));return r[0]?.blocked===true;},
 async cool(provider,seconds){await run('read write',tx=>tx.unsafe("insert into public.performance_provider_cooldowns(sport,provider,cooldown_until,reason) values('NBA',$1,now()+make_interval(secs=>$2),'PROVIDER_COOLDOWN') on conflict(sport,provider) do update set cooldown_until=greatest(performance_provider_cooldowns.cooldown_until,excluded.cooldown_until),reason=excluded.reason",[provider,Math.min(2592000,Math.max(300,seconds))]));},
 async scoreboard(date){
 if(typeof date!=='string'||!/^\d{8}$/.test(date))throw Error('Invalid scoreboard date');
 // Never await a nested pg_net HTTP call: it is consumed on the next invocation.
 return sql.begin('read write',async tx=>{
  await tx.unsafe("set local statement_timeout='5s'");
  await tx.unsafe('insert into public.nba_research_scoreboards(scoreboard_date) values($1) on conflict do nothing',[date]);
  const row=(await tx.unsafe('select * from public.nba_research_scoreboards where scoreboard_date=$1 for update',[date]))[0];
  if(row.request_id){
   const responses=await tx.unsafe("select status_code,timed_out,error_msg,created,headers,case when octet_length(content)<=4194304 then content else null end as content from net._http_response where id=$1",[row.request_id]);
   if(responses.length){const r=responses[0];row.request_id=null;
    await tx.unsafe('update public.nba_research_scoreboards set request_id=null where scoreboard_date=$1',[date]);
    if(r.status_code!==200||r.timed_out||r.error_msg)return {ok:false,error:'PROVIDER_HTTP_'+(r.status_code??'ERROR'),cooldownSeconds:r.status_code===429?Math.max(300,Number(r.headers?.['retry-after'])||300):0};
    let body;try{body=JSON.parse(r.content);}catch{return {ok:false,error:'MALFORMED_JSON'};}
    if(!Array.isArray(body?.events)||body.events.length>100)return {ok:false,error:'INVALID_SCOREBOARD'};
    row.body=body;row.received_at=r.created;
    await tx.unsafe('update public.nba_research_scoreboards set body=$2::jsonb,received_at=$3 where scoreboard_date=$1',[date,JSON.stringify(body),r.created]);
   }
  }
  if(!row.requested_at||Date.now()-new Date(row.requested_at).getTime()>300000){
   const url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates='+date;
   const requested=(await tx.unsafe('select net.http_get(url:=$1,timeout_milliseconds:=12000) as id',[url]))[0];
   await tx.unsafe('update public.nba_research_scoreboards set request_id=$2,requested_at=clock_timestamp() where scoreboard_date=$1',[date,requested.id]);
  }
  return row.body&&Date.now()-new Date(row.received_at).getTime()<900000?{ok:true,body:row.body}:{ok:false,error:'SCOREBOARD_PENDING'};
 });
 },
 async pending(){return (await run('read only',tx=>tx.unsafe("select p.payload || jsonb_build_object('id',p.id) as prediction from public.performance_predictions p where p.payload->>'sport'='NBA' and p.payload->>'modelMode'='SHADOW' and p.valid=false and p.captured_at>now()-interval '30 days' and p.starts_at<now() and not exists(select 1 from public.performance_settlements s where s.prediction_id=p.id) order by p.starts_at,p.id limit 250"))).map(r=>r.prediction);},
 async capture(p){const key='nba:research:first:'+JSON.stringify([p.sourceIds.event,p.marketType,p.side,p.line,p.book,p.modelVersion]);return run('read write',async tx=>{
 await tx.unsafe("select pg_advisory_xact_lock(hashtextextended($1,0))",['prediction:'+key]);
 const old=await tx.unsafe('select id from public.performance_predictions where source_key=$1',[key]);if(old.length)return false;
 // Fresh database receipt is independent of the model forecast time.
 const stamp=(await tx.unsafe('select clock_timestamp() as at'))[0].at;const receivedAt=new Date(stamp).toISOString();
 if(Date.parse(receivedAt)>=Date.parse(p.eligibilityStartsAt))return false;
 await tx.unsafe('select public.ingest_prediction_v1($1::jsonb)',[JSON.stringify({...p,sourceKey:key,provenance:{...p.provenance,receivedAt}})]);return true;
 });},
 async settle(s){return run('read write',async tx=>{
 await tx.unsafe("select pg_advisory_xact_lock(hashtextextended($1,0))",['settlement:'+s.predictionId]);
 const old=await tx.unsafe('select id from public.performance_settlements where prediction_id=$1',[s.predictionId]);if(old.length)return false;
 await tx.unsafe('select public.append_settlement_v1($1::jsonb)',[JSON.stringify({...s,revision:1,supersedesRevision:null})]);return true;
 });}
 };
}

export async function runNbaResearch(repo,{fetchImpl=fetch,clock=()=>new Date().toISOString(),modelUrl='https://sports-analytics-prediction-system-6ihx-oygsu1hca.vercel.app/api/nbamodel'}={}){
 const faults=[],stats={captured:0,settled:0,unresolved:0,skipped:0,waitingForScoreboards:0};
 const fetchSafe=async(url,provider)=>{
  if(await repo.cooldown(provider))return {ok:false,error:'PROVIDER_COOLDOWN'};
  const r=await fetchResultResponse(url,{fetchImpl});
  if(r.cooldownSeconds>0)await repo.cool(provider,r.cooldownSeconds);
  return r;
 };
 const pending=await repo.pending();
 const model=await fetchSafe(modelUrl,'nba-model-board');
 const adapted=model.ok?adaptNbaTeamResponse(model.body,{capturedAt:clock()}):null;
 if(!model.ok)faults.push(model.error);
 else for(const d of adapted.diagnostics)faults.push(d.reason);
 const now=Date.parse(clock());
 const forecasts=(adapted?.predictions??[]).filter(p=>Date.parse(p.startsAt)>now&&Date.parse(p.startsAt)<=now+6*3600000);
 const dates=new Set();for(const p of [...pending,...forecasts]){const t=Date.parse(p.startsAt);if(!Number.isFinite(t))continue;for(const offset of [0,-86400000])dates.add(new Date(t+offset).toISOString().slice(0,10).replaceAll('-',''));}
 const events=new Map();
 if(dates.size>12)faults.push('SCOREBOARD_DATE_LIMIT');
 // Serial bounded requests allow a provider cooldown to prevent subsequent calls immediately.
 for(const date of [...dates].slice(0,12)){
  const r=repo.scoreboard?(await repo.cooldown('espn')?{ok:false,error:'PROVIDER_COOLDOWN'}:await repo.scoreboard(date)):await fetchSafe('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates='+date,'espn');
  if(repo.scoreboard&&r.cooldownSeconds>0)await repo.cool('espn',r.cooldownSeconds);
  if(!r.ok){if(r.error==='SCOREBOARD_PENDING')stats.waitingForScoreboards++;else faults.push(r.error);continue;}
  if(!Array.isArray(r.body.events)||r.body.events.length>100){faults.push('INVALID_SCOREBOARD');continue;}
  for(const e of r.body.events){
   // The same ESPN event can appear on adjacent date queries. Conflicting copies are excluded.
   if(events.has(e.id)&&JSON.stringify(events.get(e.id))!==JSON.stringify(e)){events.set(e.id,null);}else if(!events.has(e.id))events.set(e.id,e);
  }
 }
 const official=[...events.values()].filter(Boolean);
 for(const p of forecasts){
  const match=matchNbaEvent({startsAt:p.startsAt,...p.provenance.raw},official);
  if(!match.ok||Date.parse(clock())>=Date.parse(match.eligibilityStartsAt)){stats.skipped++;continue;}
  const clean={...p,eligibilityStartsAt:match.eligibilityStartsAt,provenance:{...p.provenance,researchMapping:{...match,observedAt:clock()},raw:{home:p.provenance.raw.home,away:p.provenance.raw.away,shadowStatus:p.provenance.raw.shadowStatus}}};
  try{if(await repo.capture(clean))stats.captured++;else stats.skipped++;}catch{faults.push('CAPTURE_WRITE_FAILED');}
 }
 for(const p of pending){
  const result=researchOutcome(p,official,clock());if(!result){stats.unresolved++;continue;}
  try{if(await repo.settle(result))stats.settled++;}catch{faults.push('RESEARCH_RESULT_WRITE_FAILED');}
 }
 return {ok:faults.length===0,...stats,faults:[...new Set(faults)],tracking:{enabled:true},coverage:{sport:'NBA',state:'RESEARCH_ONLY',complete:false},productionWeight:0};
}
