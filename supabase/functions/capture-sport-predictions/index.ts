// Authenticated, fail-closed capture service. Scheduled capture requires a trusted source adapter.
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
function authorized(req){const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");if(!token)return false;try{const segment=token.split(".")[1];if(!segment)return false;const claims=JSON.parse(atob(segment.replace(/-/g,"+").replace(/_/g,"/")));return claims.role==="service_role"&&Number(claims.exp)*1000>Date.now()}catch{return false}}
function supabase(){const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)throw Error("SERVICE_CONFIG_UNAVAILABLE");return {url,key}}
async function rpc(name,args){const {url,key}=supabase();const res=await fetch(url+"/rest/v1/rpc/"+name,{method:"POST",headers:{"content-type":"application/json","apikey":key,"authorization":"Bearer "+key},body:JSON.stringify(args)});const payload=await res.json().catch(()=>null);if(!res.ok)throw Error("RPC_FAILED:"+res.status);return payload}

Deno.serve(async(req)=>{
 if(!authorized(req))return reply({error:"UNAUTHORIZED"},401);
 if(req.method==="GET")return reply({service:"capture-sport-predictions",ready:true,scheduledAdapter:"NOT_CONFIGURED",writes:"validated_direct_only"});
 if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405);
 let body;try{body=await req.json()}catch{return reply({error:"INVALID_JSON"},400)}
 if(body?.scheduled===true)return reply({error:"TRUSTED_SOURCE_ADAPTER_UNAVAILABLE",message:"Scheduled capture disabled until original odds/model adapter is restored."},503);
 if(body?.mode!=="verified-direct"||!Array.isArray(body?.predictions)||body.predictions.length<1||body.predictions.length>25)return reply({error:"VERIFIED_DIRECT_BATCH_REQUIRED"},422);
 const allowed=["NFL","NBA","MLB","CFB","NHL","SOCCER","TENNIS"];const ids=[];
 for(const candidate of body.predictions){
  if(!candidate||!allowed.includes(candidate.sport)||candidate.modelMode!=="LIVE"||candidate.modelAvailable!==true||!candidate.sourceKey||!candidate.sourceIds?.event||!candidate.settlementRule?.version||!candidate.probabilityBasis||!candidate.provenance?.modelEvidenceId||!candidate.provenance?.sourceSnapshotId)return reply({error:"INCOMPLETE_PROVENANCE_OR_CONTRACT",accepted:ids.length},422);
 }
 try{for(const candidate of body.predictions){const id=await rpc("ingest_prediction_v1",{payload:candidate});ids.push(id)}return reply({accepted:ids.length,predictionIds:ids,message:"Database eligibility and validity must be independently checked. No decisions were created."},202)}
 catch{return reply({error:"CAPTURE_VALIDATION_FAILED",accepted:ids.length},422)}
});
