import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function summarize(rows:any[]){
  const graded=rows.filter((r:any)=>["W","L","PUSH"].includes(String(r.outcome)));
  const wins=graded.filter((r:any)=>r.outcome==="W").length;
  const losses=graded.filter((r:any)=>r.outcome==="L").length;
  const pushes=graded.filter((r:any)=>r.outcome==="PUSH").length;
  const blocked=graded.filter((r:any)=>["PASS","REMODEL"].includes(String(r.state)));
  return {
    rows:rows.length,
    graded:graded.length,
    wins,losses,pushes,
    winRate:wins+losses?Number((wins/(wins+losses)).toFixed(4)):null,
    goodBlocks:blocked.filter((r:any)=>r.outcome==="L").length,
    missedWins:blocked.filter((r:any)=>r.outcome==="W").length,
    pushedBlocks:blocked.filter((r:any)=>r.outcome==="PUSH").length,
    sampleStatus:graded.length>=100?"EVALUABLE":graded.length>=30?"EARLY":"INSUFFICIENT_SAMPLE"
  };
}
function group(rows:any[],field:string){
  const map:Record<string,any[]>={};
  for(const r of rows){
    const k=String(r?.[field]??"UNKNOWN");
    (map[k]??=[]).push(r);
  }
  return Object.fromEntries(Object.entries(map).map(([k,v])=>[k,summarize(v)]));
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
      {data:results,error:re}
    ]=await Promise.all([
      supabase.from("player_prop_decision_fusion_shadow").select("*")
        .gte("source_captured_at",since).limit(20000),
      supabase.from("player_prop_results").select("observation_id,outcome,graded_at")
        .gte("graded_at",since).limit(20000)
    ]);
    if(fe) throw fe;
    if(re) throw re;

    const resultMap=new Map((results??[]).map((r:any)=>[Number(r.observation_id),r]));

    const rows=(fusion??[]).map((f:any)=>{
      const r=resultMap.get(Number(f.observation_id));
      return {
        state:f.fusion_state,
        conflictCode:f.conflict_code,
        role:f.player_role,
        statId:f.stat_id,
        upstreamStatus:f.upstream_status,
        verificationState:f.verification_state,
        weatherState:f.weather_state,
        outcome:r?.outcome??null
      };
    });

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"player-prop-fusion-v1",
      days,
      shadowOnly:true,
      affectsDecision:false,
      overall:summarize(rows),
      byState:group(rows,"state"),
      byConflictCode:group(rows,"conflictCode"),
      byRole:group(rows,"role"),
      byStat:group(rows,"statId"),
      componentBreakdown:{
        upstream:group(rows,"upstreamStatus"),
        verification:group(rows,"verificationState"),
        weather:group(rows,"weatherState")
      },
      promotionPolicy:{
        automaticPromotion:false,
        minimumGradedSamplePerConflictCode:100,
        note:"Player-prop fusion remains explanatory and shadow-only until role-specific conflict codes have sufficient graded stability."
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