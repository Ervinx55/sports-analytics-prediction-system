import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function num(v:unknown):number|null{
  if(v===null||v===undefined||v==="") return null;
  const n=Number(v); return Number.isFinite(n)?n:null;
}
function avg(xs:number[]){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;}
function summarize(rows:any[]){
  const usable=rows.filter((r:any)=>!["NO_CLOSE","STALE_CLOSE"].includes(String(r.clvClass)));
  const graded=rows.filter((r:any)=>["W","L","PUSH"].includes(String(r.outcome)));
  const wins=graded.filter((r:any)=>r.outcome==="W").length;
  const losses=graded.filter((r:any)=>r.outcome==="L").length;
  const pushes=graded.filter((r:any)=>r.outcome==="PUSH").length;

  const line=usable.map((r:any)=>num(r.lineClv)).filter((x):x is number=>x!==null);
  const lineMoved=usable.filter((r:any)=>{
    const x=num(r.lineClv); return x!==null&&Math.abs(x)>=0.49;
  });
  const price=usable.map((r:any)=>{
    const fair=num(r.fairClv);
    return fair!==null?fair:num(r.sameBookClv);
  }).filter((x):x is number=>x!==null);
  const directional=usable.filter((r:any)=>
    String(r.clvClass).startsWith("POSITIVE")||
    String(r.clvClass).startsWith("NEGATIVE")
  );
  const positive=directional.filter((r:any)=>String(r.clvClass).startsWith("POSITIVE")).length;

  return {
    rows:rows.length,
    usableClose:usable.length,
    graded:graded.length,
    wins,losses,pushes,
    winRate:wins+losses?Number((wins/(wins+losses)).toFixed(4)):null,
    beatCloseRate:directional.length?Number((positive/directional.length).toFixed(4)):null,
    averageLineClvUnits:line.length?Number(avg(line)!.toFixed(3)):null,
    positiveLineClvRate:lineMoved.length
      ? Number((lineMoved.filter((r:any)=>Number(r.lineClv)>0).length/lineMoved.length).toFixed(4))
      : null,
    averagePriceClvPp:price.length?Number(avg(price)!.toFixed(3)):null,
    positivePriceClvRate:price.length
      ? Number((price.filter((x:number)=>x>0.5).length/price.length).toFixed(4))
      : null,
    sampleStatus:usable.length>=100?"EVALUABLE":usable.length>=30?"EARLY":"INSUFFICIENT_SAMPLE"
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
      {data:clv,error:ce},
      {data:results,error:re},
      {data:fusion,error:fe},
      {data:obs,error:oe}
    ]=await Promise.all([
      supabase.from("player_prop_clv").select("*")
        .eq("finalized",true).gte("starts_at",since).limit(20000),
      supabase.from("player_prop_results").select("observation_id,outcome,graded_at")
        .gte("graded_at",since).limit(20000),
      supabase.from("player_prop_decision_fusion_shadow")
        .select("observation_id,player_role,fusion_state,conflict_code")
        .gte("source_captured_at",since).limit(20000),
      supabase.from("player_prop_observations")
        .select("id,status,stat_id,side,data_quality")
        .gte("captured_at",since).limit(20000)
    ]);
    if(ce) throw ce;if(re) throw re;if(fe) throw fe;if(oe) throw oe;

    const resultMap=new Map((results??[]).map((r:any)=>[Number(r.observation_id),r]));
    const fusionMap=new Map((fusion??[]).map((r:any)=>[Number(r.observation_id),r]));
    const obsMap=new Map((obs??[]).map((r:any)=>[Number(r.id),r]));

    const rows=(clv??[]).map((c:any)=>{
      const id=Number(c.observation_id);
      const r=resultMap.get(id),f=fusionMap.get(id),o=obsMap.get(id);
      return {
        clvClass:c.clv_classification,
        lineClv:c.line_clv_units,
        fairClv:c.fair_probability_clv_pp,
        sameBookClv:c.same_book_price_clv_pp,
        bestMarketClv:c.best_market_price_clv_pp,
        closeAge:c.close_quote_age_minutes,
        outcome:r?.outcome??null,
        fusionState:f?.fusion_state??null,
        fusionConflict:f?.conflict_code??null,
        playerRole:f?.player_role??(
          String(c.stat_id||"").startsWith("pitching_")?"PITCHER":"HITTER"
        ),
        statId:c.stat_id,
        upstreamStatus:o?.status??null,
        side:c.side
      };
    });

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"player-prop-clv-v1",
      days,
      overall:summarize(rows),
      byClassification:group(rows,"clvClass"),
      byStat:group(rows,"statId"),
      byRole:group(rows,"playerRole"),
      byFusionState:group(rows,"fusionState"),
      byFusionConflict:group(rows,"fusionConflict"),
      byUpstreamStatus:group(rows,"upstreamStatus"),
      bySide:group(rows,"side"),
      interpretation:{
        positiveLineClv:"For OVER, the closing line is higher than the ticket line; for UNDER, the closing line is lower than the ticket line.",
        positivePriceClv:"At the same line, closing fair probability or same-book implied probability moved toward the selected side after the decision.",
        staleCloseMinutes:15
      },
      promotionPolicy:{
        automaticPromotion:false,
        minimumUsableCloseSamplePerGroup:100,
        note:"CLV is used as a model-quality diagnostic, not as proof that any single wager was correct."
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