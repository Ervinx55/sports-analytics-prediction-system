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
      .from("decision_timing_latest")
      .select("*")
      .eq("sport",sport)
      .order("starts_at",{ascending:true})
      .limit(5000);
    if(error) throw error;
    const rows=data??[];

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"decision-timing-v1",
      mode:"COLLECTING",
      shadowOnly:true,
      affectsDecision:false,
      recommendationEnabled:false,
      bucketDefinitions:{
        GT_180:">=180 minutes",
        "120_180":"120-179 minutes",
        "60_120":"60-119 minutes",
        "30_60":"30-59 minutes",
        "20_30":"20-29 minutes",
        LT_20:"0-19 minutes"
      },
      summary:{
        currentSnapshots:rows.length,
        byLegType:countBy(rows,"leg_type"),
        byBucket:countBy(rows,"timing_bucket"),
        byFusionState:countBy(rows,"fusion_state"),
        contextReady:rows.filter((r:any)=>r.context_ready).length
      },
      current:rows.slice(0,300)
    }),{
      headers:{"content-type":"application/json","cache-control":"public, max-age=20"}
    });
  }catch(error){
    return new Response(JSON.stringify({
      error:error instanceof Error?error.message:JSON.stringify(error)
    }),{status:500,headers:{"content-type":"application/json"}});
  }
});