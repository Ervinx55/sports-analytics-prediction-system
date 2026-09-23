import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function num(v:unknown):number|null{
  if(v===null||v===undefined||v==="") return null;
  const n=Number(v); return Number.isFinite(n)?n:null;
}
function lineEq(a:unknown,b:unknown){
  const x=num(a),y=num(b);
  return x===null&&y===null ? true : x!==null&&y!==null&&Math.abs(x-y)<0.001;
}
function avg(xs:number[]){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;}
function summarize(rows:any[]){
  const graded=rows.filter(r=>["W","L","PUSH"].includes(String(r.outcome)));
  const wins=graded.filter(r=>r.outcome==="W").length;
  const losses=graded.filter(r=>r.outcome==="L").length;
  const pushes=graded.filter(r=>r.outcome==="PUSH").length;
  const clv=rows.map(r=>num(r.marketToCloseClvPp)).filter((x):x is number=>x!==null);
  const sharpMove=rows.map(r=>num(r.trackedSharpMovePp)).filter((x):x is number=>x!==null);
  const confidence=rows.map(r=>num(r.confidence)).filter((x):x is number=>x!==null);
  return {
    diagnoses:rows.length,
    matchedClvRows:rows.filter(r=>r.clvMatched).length,
    graded:graded.length,wins,losses,pushes,
    winRate:wins+losses?Number((wins/(wins+losses)).toFixed(4)):null,
    averageMarketToCloseClvPp:clv.length?Number(avg(clv)!.toFixed(3)):null,
    positiveClvRate:clv.length?Number((clv.filter(x=>x>0).length/clv.length).toFixed(4)):null,
    averageTrackedSharpMovePp:sharpMove.length?Number(avg(sharpMove)!.toFixed(3)):null,
    averageConfidence:confidence.length?Number(avg(confidence)!.toFixed(3)):null,
    finalPlayCount:rows.filter(r=>r.finalStatus==="FINAL_PLAY").length,
    pendingCount:rows.filter(r=>r.finalStatus==="PENDING").length,
    passCount:rows.filter(r=>r.finalStatus==="PASS").length,
    sampleStatus:rows.filter(r=>r.clvMatched).length>=100?"EVALUABLE":
      rows.filter(r=>r.clvMatched).length>=30?"EARLY":"INSUFFICIENT_SAMPLE"
  };
}

Deno.serve(async(req)=>{
  try{
    if(req.method!=="GET") return new Response(JSON.stringify({error:"GET only"}),{status:405,headers:{"content-type":"application/json"}});
    const u=new URL(req.url);
    const days=Math.max(1,Math.min(365,Number(u.searchParams.get("days")||90)));
    const since=new Date(Date.now()-days*86400_000).toISOString();
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [
      {data:diagnoses,error:de},
      {data:gates,error:ge},
      {data:clv,error:ce}
    ]=await Promise.all([
      supabase.from("sharp_disagreement_shadow").select("*").gte("evaluated_at",since).limit(5000),
      supabase.from("sharp_gate_history").select("id,checked_at,event_id,market_type,market_side,market_line,final_status")
        .gte("checked_at",since).limit(5000),
      supabase.from("sharp_market_clv").select("*").gte("captured_at",since).limit(10000)
    ]);
    if(de) throw de;if(ge) throw ge;if(ce) throw ce;

    const gateMap=new Map((gates??[]).map((g:any)=>[Number(g.id),g]));
    const rows=(diagnoses??[]).map((d:any)=>{
      const g=gateMap.get(Number(d.sharp_gate_id));
      if(!g) return {...d,clvMatched:false};
      const candidates=(clv??[]).filter((c:any)=>
        c.event_id===g.event_id &&
        c.market_type===g.market_type &&
        c.market_side===g.market_side &&
        lineEq(c.line,g.market_line)
      );
      candidates.sort((a:any,b:any)=>
        Math.abs(Date.parse(a.captured_at||"")-Date.parse(g.checked_at||""))-
        Math.abs(Date.parse(b.captured_at||"")-Date.parse(g.checked_at||""))
      );
      const c=candidates[0]??null;
      return {
        classification:d.classification,confidence:d.confidence,reasonCode:d.reason_code,
        finalStatus:g.final_status,clvMatched:Boolean(c),
        outcome:c?.outcome??null,marketToCloseClvPp:c?.market_to_close_clv_pp??null,
        trackedSharpMovePp:c?.tracked_sharp_move_pp??null,modelVsClosePp:c?.model_vs_close_pp??null
      };
    });

    const classes=[
      "CONSENSUS_OK","STALE_PRICE","MARKET_MOVING","REAL_SHARP_DISAGREEMENT",
      "SOURCE_QUALITY_PROBLEM","INSUFFICIENT_SOURCES","DISAGREEMENT_WATCH"
    ];
    const byClassification=Object.fromEntries(classes.map(k=>[k,summarize(rows.filter((r:any)=>r.classification===k))]));

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),version:"sharp-disagreement-v1",days,
      shadowOnly:true,affectsDecision:false,overall:summarize(rows),byClassification,
      promotionPolicy:{
        automaticPromotion:false,
        minimumMatchedSamplePerClass:100,
        note:"Classification remains descriptive until CLV/outcome behavior is stable and sufficiently sampled."
      }
    }),{headers:{"content-type":"application/json","cache-control":"public, max-age=60"}});
  }catch(error){
    return new Response(JSON.stringify({error:error instanceof Error?error.message:JSON.stringify(error)}),
      {status:500,headers:{"content-type":"application/json"}});
  }
});