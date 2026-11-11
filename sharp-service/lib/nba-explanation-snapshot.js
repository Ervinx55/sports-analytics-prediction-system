import {explanationContext} from './nba-explanation-evidence.js';
let cached=null,expires=0,pending=null;
export async function explanationSnapshot(){
 if(Date.now()<expires)return cached;
 if(pending)return pending;
 pending=(async()=>{
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  try{
   if(!key)throw Error('Missing service configuration');
   const headers={'Content-Type':'application/json',apikey:key};if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;
   const r=await fetch((process.env.SUPABASE_URL||'https://yeoxroijaptomomshdii.supabase.co').replace(/\/$/,'')+'/rest/v1/rpc/read_nba_explanation_snapshot_v1',{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(6000)});
   if(!r.ok)throw Error('Unavailable');const s=await r.json();
   if(s.contract!=='nba-explanation-snapshot-v1'||!Array.isArray(s.history)||s.history.length>300||!Array.isArray(s.targets)||s.targets.length>1000)throw Error('Invalid snapshot');
   cached=s;expires=Date.now()+300000;return s;
  }catch{cached=null;expires=Date.now()+30000;return null;}
  finally{pending=null;}
 })();return pending;
}
export function contextForSelection(snapshot,eventID,playerID,market,now=new Date().toISOString()){
 try{
 const matches=(snapshot?.targets||[]).filter(t=>t.eventID===eventID&&t.playerID===playerID&&t.teamId&&t.opponentTeamId&&t.teamId!==t.opponentTeamId);
 const unique=[...new Map(matches.map(t=>[JSON.stringify(t),t])).values()];
 if(unique.length!==1)return null;
 return explanationContext(snapshot,unique[0],market,now);
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
 return {...body,events:(body.events||[]).map(e=>({...e,players:(e.players||[]).map(p=>({...p,context:contextForSelection(s,e.eventID,p.prop?.playerID,p.prop?.statID,now)}))}))};
}
