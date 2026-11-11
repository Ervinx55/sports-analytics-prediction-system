import {explanationContext} from './nba-explanation-evidence.js';
const FRESH_MS=300000,MAX_AGE_MS=600000,FAILURE_MS=30000;
let cached=null,fetchedAt=0,expires=0,pending=null,degraded=false;
const usable=()=>cached&&Date.now()>=fetchedAt&&Date.now()-fetchedAt<=MAX_AGE_MS&&Date.now()-Date.parse(cached.generatedAt)<=MAX_AGE_MS;
const result=()=>usable()?{...cached,evidenceRead:{status:degraded?'cached_after_error':'fresh',fetchedAt:new Date(fetchedAt).toISOString(),generatedAt:cached.generatedAt}}:null;
export async function explanationSnapshot(){
 if(Date.now()<expires)return result();
 if(pending)return pending;
 pending=(async()=>{
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  let reason='configuration',transient=false,cooldown=FAILURE_MS;
  if(key)for(let attempt=0;attempt<(usable()?1:2);attempt++){
   try{
    const headers={'Content-Type':'application/json',apikey:key};if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;
    let r;
    try{r=await fetch((process.env.SUPABASE_URL||'https://yeoxroijaptomomshdii.supabase.co').replace(/\/$/,'')+'/rest/v1/rpc/read_nba_explanation_snapshot_v1',{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(6000)});}
    catch{reason='transport_or_timeout';transient=true;continue;}
    if(!r.ok){if(r.status===429){const raw=r.headers?.get?.('retry-after'),ms=/^\d+$/.test(raw||'')?Number(raw)*1000:Date.parse(raw)-Date.now();if(Number.isFinite(ms)&&ms>0)cooldown=Math.max(FAILURE_MS,ms);}reason='http_'+r.status;transient=r.status>=500&&r.status<=599;if(transient)continue;break;}
    let snapshot;try{snapshot=await r.json();}catch{reason='invalid_json';transient=false;break;}
    const age=Date.now()-Date.parse(snapshot.generatedAt);
    if(snapshot.contract!=='nba-explanation-snapshot-v1'||!Array.isArray(snapshot.history)||snapshot.history.length>300||!Array.isArray(snapshot.targets)||snapshot.targets.length>1000||!Number.isFinite(age)||age< -5000||age>FRESH_MS){reason='invalid_snapshot';transient=false;break;}
    cached=snapshot;fetchedAt=Date.now();expires=fetchedAt+FRESH_MS;degraded=false;return result();
   }catch{reason='invalid_response';transient=false;break;}
  }
  console.warn('NBA_EXPLANATION_READ_FAILED',{reason});
  if(!transient||!usable()){cached=null;fetchedAt=0;}
  degraded=true;expires=Date.now()+cooldown;return result();
 })().finally(()=>{pending=null;});return pending;
}
export function contextForSelection(snapshot,eventID,playerID,market,now=new Date().toISOString(),binding=null){
 try{
 const matches=(snapshot?.targets||[]).filter(t=>t.eventID===eventID&&t.playerID===playerID&&t.teamId&&t.opponentTeamId&&t.teamId!==t.opponentTeamId);
 const unique=[...new Map(matches.map(t=>[JSON.stringify(t),t])).values()];
 const validBinding=binding?.contract==='sgo-event-roster-v1'&&binding.eventID===eventID&&binding.playerID===playerID&&[binding.teamId,binding.opponentTeamId].every(t=>typeof t==='string'&&t.endsWith('_NBA'))&&binding.teamId!==binding.opponentTeamId&&Number.isFinite(Date.parse(binding.startsAt));
 if(unique.length>1||(!unique.length&&!validBinding)||!snapshot)return null;
 if(unique.length&&validBinding&&(unique[0].teamId!==binding.teamId||unique[0].opponentTeamId!==binding.opponentTeamId||Date.parse(unique[0].startsAt)!==Date.parse(binding.startsAt)))return null;
 const context=explanationContext(snapshot,unique[0]||binding,market,now);
 return snapshot.evidenceRead?{...context,evidenceRead:snapshot.evidenceRead}:context;
 }catch{return null;}
}
export async function enrichLiveExplanations(body,snapshot){
 const s=await (snapshot===undefined?explanationSnapshot():snapshot);
 const now=new Date().toISOString();
 return {...body,decisions:body.decisions.map(r=>({...r,context:contextForSelection(s,r.eventID,r.playerID,r.marketType??r.market,now)}))};
}
export async function enrichQuoteExplanations(body,snapshot){
 const s=await (snapshot===undefined?explanationSnapshot():snapshot);
 const now=new Date().toISOString();
 return {...body,events:(body.events||[]).map(e=>({...e,players:(e.players||[]).map(p=>({...p,context:contextForSelection(s,e.eventID,p.prop?.playerID,p.prop?.statID,now,p.explanationBinding)}))}))};
}
