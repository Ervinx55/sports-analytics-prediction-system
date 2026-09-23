import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function num(v:unknown):number|null{
  if(v===null||v===undefined||v==="") return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function avg(xs:number[]){
  return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
}
function summarize(rows:any[]){
  const graded=rows.filter((r:any)=>["W","L","PUSH"].includes(String(r.outcome)));
  const wins=graded.filter((r:any)=>r.outcome==="W").length;
  const losses=graded.filter((r:any)=>r.outcome==="L").length;
  const pushes=graded.filter((r:any)=>r.outcome==="PUSH").length;
  const clv=rows.map((r:any)=>num(r.marketToCloseClvPp)).filter((x):x is number=>x!==null);
  return {
    rows:rows.length,
    graded:graded.length,
    wins,losses,pushes,
    winRate:wins+losses?Number((wins/(wins+losses)).toFixed(4)):null,
    averageMarketToCloseClvPp:clv.length?Number(avg(clv)!.toFixed(3)):null,
    positiveClvRate:clv.length?Number((clv.filter(x=>x>0).length/clv.length).toFixed(4)):null,
    sampleStatus:rows.length>=100?"EVALUABLE":rows.length>=30?"EARLY":"INSUFFICIENT_SAMPLE"
  };
}
function group(rows:any[],field:string){
  const map:Record<string,any[]>={};
  for(const r of rows){
    const k=String(r?.[field]??"UNKNOWN");
    (map[k]??=[]).push(r);
  }
  return Object.fromEntries(
    Object.entries(map).map(([k,v])=>[k,summarize(v)])
  );
}

Deno.serve(async(req)=>{
  try{
    if(req.method!=="GET"){
      return new Response(JSON.stringify({error:"GET only"}),{
        status:405,headers:{"content-type":"application/json"}
      });
    }
    const u=new URL(req.url);
    const days=Math.max(1,Math.min(365,Number(u.searchParams.get("days")||90)));
    const since=new Date(Date.now()-days*86400_000).toISOString();

    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [
      {data:fusion,error:fe},
      {data:results,error:re},
      {data:clv,error:ce}
    ]=await Promise.all([
      supabase.from("market_decision_fusion_shadow").select("*")
        .gte("source_captured_at",since).limit(10000),
      supabase.from("team_market_results").select("observation_id,outcome,graded_at")
        .gte("graded_at",since).limit(10000),
      supabase.from("sharp_market_clv").select("observation_id,market_to_close_clv_pp,tracked_sharp_move_pp,model_vs_close_pp")
        .gte("captured_at",since).limit(10000)
    ]);
    if(fe) throw fe;if(re) throw re;if(ce) throw ce;

    const resultMap=new Map((results??[]).map((r:any)=>[Number(r.observation_id),r]));
    const clvMap=new Map((clv??[]).map((r:any)=>[Number(r.observation_id),r]));

    const rows=(fusion??[]).map((f:any)=>{
      const result=resultMap.get(Number(f.observation_id));
      const c=clvMap.get(Number(f.observation_id));
      return {
        state:f.fusion_state,
        conflictCode:f.conflict_code,
        alignmentScore:num(f.alignment_score),
        uncertaintyClass:f.uncertainty_class,
        priceState:f.price_state,
        verificationState:f.verification_state,
        weatherState:f.weather_state,
        sharpClassification:f.sharp_classification,
        productionNonSharpStatus:f.production_non_sharp_status,
        productionSharpStatus:f.production_sharp_status,
        outcome:result?.outcome??null,
        marketToCloseClvPp:c?.market_to_close_clv_pp??null,
        trackedSharpMovePp:c?.tracked_sharp_move_pp??null,
        modelVsClosePp:c?.model_vs_close_pp??null
      };
    });

    const scores=rows.map((r:any)=>num(r.alignmentScore)).filter((x):x is number=>x!==null);

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"decision-fusion-v1",
      days,
      shadowOnly:true,
      affectsDecision:false,
      overall:{
        ...summarize(rows),
        averageAlignmentScore:scores.length?Number(avg(scores)!.toFixed(1)):null
      },
      byState:group(rows,"state"),
      byConflictCode:group(rows,"conflictCode"),
      componentBreakdown:{
        uncertainty:group(rows,"uncertaintyClass"),
        price:group(rows,"priceState"),
        verification:group(rows,"verificationState"),
        weather:group(rows,"weatherState"),
        sharp:group(rows,"sharpClassification")
      },
      promotionPolicy:{
        automaticPromotion:false,
        minimumGradedSamplePerConflictCode:100,
        requireStableClv:true,
        note:"Decision fusion remains explanatory and shadow-only until conflict-level outcome and closing-line behavior are sufficiently sampled."
      }
    }),{
      headers:{
        "content-type":"application/json",
        "cache-control":"public, max-age=60"
      }
    });
  }catch(error){
    return new Response(JSON.stringify({
      error:error instanceof Error?error.message:JSON.stringify(error)
    }),{status:500,headers:{"content-type":"application/json"}});
  }
});