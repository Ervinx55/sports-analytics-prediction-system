// Research forecasts are insert-only. Live decisions still use every fresh forecast.
export async function persistenceDelta(rpc,delta){
 const ids=[...new Set(delta.forecasts.map(f=>f.identity))],saved=new Set();
 const key=f=>JSON.stringify([f.identity,f.modelHash]);
 try{
  for(let i=0;i<ids.length;i+=500){
   const chunk=ids.slice(i,i+500),rows=await rpc('load_nba_saved_forecasts_v1',{p_identities:chunk});
   if(!Array.isArray(rows)||rows.some(r=>!chunk.includes(r.identity)||typeof r.modelHash!=='string'))throw Error('Invalid saved forecast inventory');
   for(const r of rows)saved.add(key(r));
  }
  return {...delta,forecasts:delta.forecasts.filter(f=>!saved.has(key(f)))};
 }catch{return delta;} // Existing INSERT ON CONFLICT remains the safe fallback.
}

