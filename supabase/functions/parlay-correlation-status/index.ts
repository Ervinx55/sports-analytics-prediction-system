import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function countBy(rows:any[],field:string){
  const out:Record<string,number>={};
  for(const r of rows){
    const k=String(r?.[field]??"UNKNOWN");
    out[k]=(out[k]||0)+1;
  }
  return out;
}

Deno.serve(async(req)=>{
  try{
    if(req.method!=="GET"){
      return new Response(JSON.stringify({error:"GET only"}),{status:405,headers:{"content-type":"application/json"}});
    }
    const u=new URL(req.url);
    const sport=(u.searchParams.get("sport")||"MLB").toUpperCase();

    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {data,error}=await supabase
      .from("parlay_correlation_latest")
      .select("*")
      .eq("sport",sport)
      .order("independent_ev_pct",{ascending:false,nullsFirst:false})
      .limit(2000);
    if(error) throw error;

    const rows=data??[];
    const recommended=rows.filter((r:any)=>
      r.action==="ALLOW_INDEPENDENCE_ESTIMATE" &&
      !r.shadow_conflict &&
      Number(r.independent_ev_pct)>0
    );
    const audit=rows.filter((r:any)=>r.action==="AUDIT_ONLY");
    const blocked=rows.filter((r:any)=>r.action==="BLOCK");

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"parlay-correlation-v1",
      shadowOnly:true,
      affectsDecision:false,
      summary:{
        pairs:rows.length,
        byPairType:countBy(rows,"pair_type"),
        byRelation:countBy(rows,"relation_class"),
        byAction:countBy(rows,"action"),
        recommendedIndependentPairs:recommended.length,
        sameGameAuditPairs:audit.length,
        blockedPairs:blocked.length,
        shadowConflictPairs:rows.filter((r:any)=>r.shadow_conflict).length
      },
      recommended:recommended.slice(0,50),
      sameGameAudit:audit.slice(0,100),
      blocked:blocked.slice(0,100)
    }),{
      headers:{
        "content-type":"application/json",
        "cache-control":"public, max-age=20"
      }
    });
  }catch(error){
    return new Response(JSON.stringify({
      error:error instanceof Error?error.message:JSON.stringify(error)
    }),{status:500,headers:{"content-type":"application/json"}});
  }
});