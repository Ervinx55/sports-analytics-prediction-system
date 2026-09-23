import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function summarize(rows:any[]){
  const graded=rows.filter((r:any)=>r.aOutcome&&r.bOutcome&&r.aOutcome!=="PUSH"&&r.bOutcome!=="PUSH");
  const bothWins=graded.filter((r:any)=>r.aOutcome==="W"&&r.bOutcome==="W").length;
  const independent=graded.map((r:any)=>Number(r.independentProbability)).filter(Number.isFinite);
  const avgIndependent=independent.length?independent.reduce((a,b)=>a+b,0)/independent.length:null;
  const empirical=graded.length?bothWins/graded.length:null;
  return {
    pairs:rows.length,
    gradedPairs:graded.length,
    bothWins,
    empiricalJointWinRate:empirical===null?null:Number(empirical.toFixed(4)),
    averageIndependenceEstimate:avgIndependent===null?null:Number(avgIndependent.toFixed(4)),
    excessVsIndependencePp:
      empirical===null||avgIndependent===null
        ? null
        : Number(((empirical-avgIndependent)*100).toFixed(2)),
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
      return new Response(JSON.stringify({error:"GET only"}),{status:405,headers:{"content-type":"application/json"}});
    }
    const u=new URL(req.url);
    const days=Math.max(1,Math.min(365,Number(u.searchParams.get("days")||90)));
    const since=new Date(Date.now()-days*86400_000).toISOString();

    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [
      {data:pairs,error:pe},
      {data:teamResults,error:te},
      {data:propResults,error:pre}
    ]=await Promise.all([
      supabase.from("parlay_correlation_shadow").select("*")
        .gte("first_seen_at",since).limit(10000),
      supabase.from("team_market_results").select("observation_id,outcome,graded_at")
        .gte("graded_at",since).limit(20000),
      supabase.from("player_prop_results").select("observation_id,outcome,graded_at")
        .gte("graded_at",since).limit(20000)
    ]);
    if(pe) throw pe;if(te) throw te;if(pre) throw pre;

    const teamMap=new Map((teamResults??[]).map((r:any)=>[Number(r.observation_id),r.outcome]));
    const propMap=new Map((propResults??[]).map((r:any)=>[Number(r.observation_id),r.outcome]));

    const outcome=(kind:string,id:number)=>
      kind==="TEAM"?teamMap.get(id)??null:propMap.get(id)??null;

    const rows=(pairs??[]).map((p:any)=>({
      pairType:p.pair_type,
      relationClass:p.relation_class,
      direction:p.direction,
      strength:p.strength,
      action:p.action,
      reasonCode:p.reason_code,
      independentProbability:p.independent_probability,
      independentEvPct:p.independent_ev_pct,
      aOutcome:outcome(p.leg_a_kind,Number(p.leg_a_observation_id)),
      bOutcome:outcome(p.leg_b_kind,Number(p.leg_b_observation_id))
    }));

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"parlay-correlation-v1",
      days,
      shadowOnly:true,
      affectsDecision:false,
      overall:summarize(rows),
      byPairType:group(rows,"pairType"),
      byRelationClass:group(rows,"relationClass"),
      byStrength:group(rows,"strength"),
      byReasonCode:group(rows,"reasonCode"),
      calibrationPolicy:{
        numericCorrelationAdjustmentEnabled:false,
        minimumGradedPairsPerRelation:100,
        note:"Until empirical joint outcomes are sufficiently sampled, same-game pairs remain audit-only and no adjusted joint probability is invented."
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