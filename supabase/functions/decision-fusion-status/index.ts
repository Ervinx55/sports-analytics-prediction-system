import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function countBy(rows:any[],field:string){
  const out:Record<string,number>={};
  for(const r of rows){
    const k=String(r?.[field]??"UNKNOWN");
    out[k]=(out[k]||0)+1;
  }
  return out;
}
function avg(xs:number[]){
  return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
}

Deno.serve(async(req)=>{
  try{
    if(req.method!=="GET"){
      return new Response(JSON.stringify({error:"GET only"}),{
        status:405,headers:{"content-type":"application/json"}
      });
    }
    const u=new URL(req.url);
    const sport=(u.searchParams.get("sport")||"MLB").toUpperCase();
    const hours=Math.max(1,Math.min(72,Number(u.searchParams.get("hours")||36)));
    const since=new Date(Date.now()-hours*3600_000).toISOString();

    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {data,error}=await supabase
      .from("market_decision_fusion_latest")
      .select("*")
      .eq("sport",sport)
      .gte("source_captured_at",since)
      .order("starts_at",{ascending:true})
      .limit(1000);
    if(error) throw error;

    const rows=data??[];
    const scores=rows.map((r:any)=>Number(r.alignment_score)).filter(Number.isFinite);

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"decision-fusion-v1",
      sport,
      shadowOnly:true,
      affectsDecision:false,
      refreshCadenceMinutes:5,
      summary:{
        markets:rows.length,
        byState:countBy(rows,"fusion_state"),
        byConflictCode:countBy(rows,"conflict_code"),
        averageAlignmentScore:scores.length?Number(avg(scores)!.toFixed(1)):null,
        playCandidates:rows.filter((r:any)=>r.fusion_state==="PLAY_CANDIDATE").length,
        remodel:rows.filter((r:any)=>r.fusion_state==="REMODEL").length,
        priceGone:rows.filter((r:any)=>r.conflict_code==="MODEL_LIKES_IT_PRICE_GONE").length,
        marketMoving:rows.filter((r:any)=>r.conflict_code==="SHARP_PRICE_DISCOVERY").length,
        realSharpConflict:rows.filter((r:any)=>r.conflict_code==="REAL_SHARP_CONFLICT").length
      },
      markets:rows.slice(0,200)
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