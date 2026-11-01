// Only verified final-result providers may settle. Never infer results from odds or shadow forecasts.
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
function authorized(req){const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");if(!token)return false;try{const segment=token.split(".")[1];if(!segment)return false;const claims=JSON.parse(atob(segment.replace(/-/g,"+").replace(/_/g,"/")));return claims.role==="service_role"&&Number(claims.exp)*1000>Date.now()}catch{return false}}
function supabase(){const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw Error("SERVICE_CONFIG_UNAVAILABLE");return {url,key}}
async function rpc(name,args){const {url,key}=supabase();const res=await fetch(url+"/rest/v1/rpc/"+name,{method:"POST",headers:{"content-type":"application/json","apikey":key,"authorization":"Bearer "+key},body:JSON.stringify(args)});const payload=await res.json().catch(()=>null);if(!res.ok)throw Error("RPC_FAILED:"+res.status);return payload}

Deno.serve(async(req)=>{
 if(!authorized(req))return reply({error:"UNAUTHORIZED"},401);
 if(req.method==="GET")return reply({service:"settle-sport-predictions",ready:true,finalResultAdapter:"NOT_CONFIGURED",writes:"DISABLED"});
 if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405);
 return reply({error:"VERIFIED_FINAL_RESULT_ADAPTER_UNAVAILABLE",message:"Settlement is disabled until authenticated final results, exact event/player mappings, and source revision checks are configured. No records changed."},503);
});
