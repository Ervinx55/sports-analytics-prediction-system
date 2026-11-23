// Diagnostic endpoint: gateway JWT verification remains enabled.
// Authorize using the existing service-role-only RPC before reporting metadata.
Deno.serve(async (req) => {
 const url=Deno.env.get("SUPABASE_URL");
 const incoming=(req.headers.get("authorization")||"").replace(/^Bearer /i,"");
 const probe=async(key)=>fetch(url+"/rest/v1/rpc/load_nba_saved_forecasts_v1",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({p_identities:[]})});
 const auth=await probe(incoming);
 if(!auth.ok) return Response.json({error:"Service authentication required"},{status:403});
 const key=Deno.env.get("EDGE_LAB_SERVICE_ROLE_KEY")?.trim()||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 let claims={};
 try {const raw=JSON.parse(atob(key.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))); claims={role:raw.role,iat:raw.iat,exp:raw.exp};}catch{}
 const check=await probe(key);
 const error=check.ok?null:await check.json();
 const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
 const probes=[];
 for(const [name,k] of Object.entries(keys)){const r=await fetch(url+"/rest/v1/rpc/load_nba_saved_forecasts_v1",{method:"POST",headers:{apikey:String(k),"Content-Type":"application/json"},body:JSON.stringify({p_identities:[]})});probes.push({name,status:r.status,error:r.ok?null:await r.json()});}
 return Response.json({checkedAt:new Date().toISOString(),builtIn:claims,builtInKind:key.startsWith("sb_secret_")?"secret":key.split(".").length===3?"jwt":"other",probes,builtInStatus:check.status,error,secretKeysPresent:!!Deno.env.get("SUPABASE_SECRET_KEYS")},{headers:{"Cache-Control":"no-store"}});
});
