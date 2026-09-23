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
    const days=Math.max(1,Math.min(90,Number(u.searchParams.get("days")||30)));
    const since=new Date(Date.now()-days*86400_000).toISOString();
    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {data,error}=await supabase
      .from("decision_outcome_attribution")
      .select("*")
      .gte("evaluated_at",since)
      .order("evaluated_at",{ascending:false})
      .limit(10000);
    if(error) throw error;
    const rows=data??[];

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"outcome-attribution-v1",
      summary:{
        decisions:rows.length,
        byLegType:countBy(rows,"leg_type"),
        byPrimaryAttribution:countBy(rows,"primary_attribution"),
        byProcessGrade:countBy(rows,"process_grade"),
        byClvSignal:countBy(rows,"clv_signal"),
        contextInvalidated:rows.filter((x:any)=>x.context_changed).length,
        dataQualityProblems:rows.filter((x:any)=>x.data_quality_problem).length,
        sharpWarnings:rows.filter((x:any)=>x.sharp_warning).length
      },
      recent:rows.slice(0,200),
      interpretation:{
        goodProcessBadOutcome:"A loss with positive closing-market evidence is not automatically a model failure.",
        winWithNegativeProcess:"A win with negative closing-market evidence does not validate the decision process.",
        unresolved:"Without adequate CLV/context evidence, the engine refuses to separate model error from ordinary variance."
      }
    }),{
      headers:{"content-type":"application/json","cache-control":"public, max-age=30"}
    });
  }catch(error){
    return new Response(JSON.stringify({error:error instanceof Error?error.message:JSON.stringify(error)}),
      {status:500,headers:{"content-type":"application/json"}});
  }
});