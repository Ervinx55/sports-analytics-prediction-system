import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function n(v:any):number|null{
  if(v===null||v===undefined||v==="") return null;
  const x=Number(v); return Number.isFinite(x)?x:null;
}
function avg(xs:number[]){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;}
function summarize(rows:any[]){
  const graded=rows.filter((r:any)=>["W","L","PUSH"].includes(String(r.outcome)));
  const wins=graded.filter((r:any)=>r.outcome==="W").length;
  const losses=graded.filter((r:any)=>r.outcome==="L").length;
  const pushes=graded.filter((r:any)=>r.outcome==="PUSH").length;

  const teamClv=rows.map((r:any)=>n(r.teamClvPp)).filter((x):x is number=>x!==null);
  const propLine=rows.map((r:any)=>n(r.propLineClv)).filter((x):x is number=>x!==null);
  const propPrice=rows.map((r:any)=>n(r.propPriceClvPp)).filter((x):x is number=>x!==null);
  const propDirectional=rows.filter((r:any)=>
    String(r.propClvClass||"").startsWith("POSITIVE") ||
    String(r.propClvClass||"").startsWith("NEGATIVE")
  );
  const usableClose=rows.filter((r:any)=>
    n(r.teamClvPp)!==null ||
    (r.propClvClass && !["TRACKING","NO_CLOSE","STALE_CLOSE"].includes(String(r.propClvClass)))
  ).length;

  return {
    snapshots:rows.length,
    usableClose,
    graded:graded.length,
    wins,losses,pushes,
    winRate:wins+losses?Number((wins/(wins+losses)).toFixed(4)):null,
    averageTeamClvPp:teamClv.length?Number(avg(teamClv)!.toFixed(3)):null,
    positiveTeamClvRate:teamClv.length?Number((teamClv.filter(x=>x>0).length/teamClv.length).toFixed(4)):null,
    averagePropLineClvUnits:propLine.length?Number(avg(propLine)!.toFixed(3)):null,
    averagePropPriceClvPp:propPrice.length?Number(avg(propPrice)!.toFixed(3)):null,
    propBeatCloseRate:propDirectional.length
      ? Number((propDirectional.filter((r:any)=>String(r.propClvClass).startsWith("POSITIVE")).length/propDirectional.length).toFixed(4))
      : null,
    sampleStatus:usableClose>=100?"EVALUABLE":usableClose>=30?"EARLY":"INSUFFICIENT_SAMPLE"
  };
}
function group(rows:any[],field:string){
  const m:Record<string,any[]>={};
  for(const r of rows){
    const k=String(r?.[field]??"UNKNOWN");
    (m[k]??=[]).push(r);
  }
  return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,summarize(v)]));
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
      {data:timing,error:te},
      {data:teamClv,error:tce},
      {data:teamResults,error:tre},
      {data:propClv,error:pce},
      {data:propResults,error:pre}
    ]=await Promise.all([
      supabase.from("decision_timing_shadow").select("*").gte("captured_at",since).limit(30000),
      supabase.from("sharp_market_clv").select("observation_id,market_to_close_clv_pp").gte("captured_at",since).limit(20000),
      supabase.from("team_market_results").select("observation_id,outcome").gte("graded_at",since).limit(20000),
      supabase.from("player_prop_clv").select("observation_id,finalized,line_clv_units,fair_probability_clv_pp,same_book_price_clv_pp,clv_classification").gte("starts_at",since).limit(30000),
      supabase.from("player_prop_results").select("observation_id,outcome").gte("graded_at",since).limit(30000)
    ]);
    if(te) throw te;if(tce) throw tce;if(tre) throw tre;if(pce) throw pce;if(pre) throw pre;

    const tc=new Map((teamClv??[]).map((r:any)=>[Number(r.observation_id),r]));
    const tr=new Map((teamResults??[]).map((r:any)=>[Number(r.observation_id),r]));
    const pc=new Map((propClv??[]).map((r:any)=>[Number(r.observation_id),r]));
    const pr=new Map((propResults??[]).map((r:any)=>[Number(r.observation_id),r]));

    const rows=(timing??[]).map((t:any)=>{
      const id=Number(t.observation_id);
      const isTeam=t.leg_type==="TEAM";
      const c=isTeam?tc.get(id):pc.get(id);
      const rr=isTeam?tr.get(id):pr.get(id);
      const propPrice=c
        ? (n(c.fair_probability_clv_pp)??n(c.same_book_price_clv_pp))
        : null;
      return {
        legType:t.leg_type,
        bucket:t.timing_bucket,
        category:t.category,
        upstreamStatus:t.upstream_status,
        fusionState:t.fusion_state,
        priceState:t.price_state,
        contextReady:t.context_ready,
        minutesToStart:t.minutes_to_start,
        outcome:rr?.outcome??null,
        teamClvPp:isTeam?n(c?.market_to_close_clv_pp):null,
        propLineClv:isTeam?null:n(c?.line_clv_units),
        propPriceClvPp:isTeam?null:propPrice,
        propClvClass:isTeam?null:c?.clv_classification??null
      };
    });

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"decision-timing-v1",
      days,
      mode:"COLLECTING",
      shadowOnly:true,
      affectsDecision:false,
      recommendationEnabled:false,
      overall:summarize(rows),
      byLegType:group(rows,"legType"),
      byBucket:group(rows,"bucket"),
      teamByBucket:group(rows.filter((r:any)=>r.legType==="TEAM"),"bucket"),
      propByBucket:group(rows.filter((r:any)=>r.legType==="PROP"),"bucket"),
      teamByMarketType:group(rows.filter((r:any)=>r.legType==="TEAM"),"category"),
      propByStat:group(rows.filter((r:any)=>r.legType==="PROP"),"category"),
      policy:{
        minimumUsableCloseSamplePerBucket:100,
        timingRecommendationEnabled:false,
        note:"Timing buckets are descriptive until enough pregame snapshots have matched closing-market data. No BET_NOW or WAIT recommendation is generated from small samples."
      }
    }),{
      headers:{"content-type":"application/json","cache-control":"public, max-age=60"}
    });
  }catch(error){
    return new Response(JSON.stringify({
      error:error instanceof Error?error.message:JSON.stringify(error)
    }),{status:500,headers:{"content-type":"application/json"}});
  }
});