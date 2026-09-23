import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async(req)=>{
  try{
    if(req.method!=="GET"){
      return new Response(JSON.stringify({error:"GET only"}),{status:405,headers:{"content-type":"application/json"}});
    }
    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [
      {data:registry,error:re},
      {data:latest,error:le}
    ]=await Promise.all([
      supabase.from("model_governance_registry").select("*").eq("active",true).order("model_family"),
      supabase.from("model_governance_latest").select("*").order("model_family").order("scope").order("category")
    ]);
    if(re) throw re;if(le) throw le;

    const overall=(latest??[]).filter((x:any)=>x.scope==="OVERALL");
    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"model-governance-v1",
      automaticPromotion:false,
      humanReviewRequired:true,
      summary:{
        registeredModels:registry?.length??0,
        references:(registry??[]).filter((x:any)=>x.role==="REFERENCE").length,
        challengers:(registry??[]).filter((x:any)=>x.role==="CHALLENGER").length,
        diagnostics:(registry??[]).filter((x:any)=>x.role==="DIAGNOSTIC").length,
        readyForHumanReview:overall.filter((x:any)=>x.governance_state==="READY_FOR_HUMAN_REVIEW").length
      },
      registry,
      overall,
      evaluations:latest??[],
      policy:{
        automaticPromotion:false,
        minimumGradedSampleDefault:100,
        minimumCloseSampleDefault:100,
        rule:"No model version can become production solely from win rate. Calibration, closing-market evidence, category stability, and explicit human review are required."
      }
    }),{
      headers:{"content-type":"application/json","cache-control":"public, max-age=60"}
    });
  }catch(error){
    return new Response(JSON.stringify({error:error instanceof Error?error.message:JSON.stringify(error)}),
      {status:500,headers:{"content-type":"application/json"}});
  }
});