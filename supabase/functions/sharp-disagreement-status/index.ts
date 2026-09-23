import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function by(rows:any[],field:string){
  const out:Record<string,number>={};
  for(const r of rows){const k=String(r?.[field]??"UNKNOWN");out[k]=(out[k]||0)+1;}
  return out;
}
Deno.serve(async(req)=>{
  try{
    if(req.method!=="GET") return new Response(JSON.stringify({error:"GET only"}),{status:405,headers:{"content-type":"application/json"}});
    const u=new URL(req.url);
    const hours=Math.max(1,Math.min(168,Number(u.searchParams.get("hours")||24)));
    const since=new Date(Date.now()-hours*3600_000).toISOString();
    const sourceSince=new Date(Date.now()-60*60000).toISOString();

    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [
      {data:diagnoses,error:de},
      {data:quotes,error:qe}
    ]=await Promise.all([
      supabase.from("sharp_disagreement_shadow").select("*").gte("evaluated_at",since)
        .order("evaluated_at",{ascending:false}).limit(1000),
      supabase.from("sharp_source_quotes").select("source_book,provider,source_kind,observed_at,odds,opponent_odds,market_type")
        .gte("observed_at",sourceSince).order("observed_at",{ascending:false}).limit(10000)
    ]);
    if(de) throw de;if(qe) throw qe;

    const sourceHealth:Record<string,any>={};
    for(const name of ["pinnacle","circa","bookmaker"]){
      const xs=(quotes??[]).filter((q:any)=>String(q.source_book||"").toLowerCase()===name);
      const two=xs.filter((q:any)=>q.odds!==null&&q.opponent_odds!==null);
      sourceHealth[name]={
        quotesLast60m:xs.length,
        twoSidedQuotesLast60m:two.length,
        latestObservedAt:xs[0]?.observed_at??null,
        provider:xs[0]?.provider??null,
        sourceKind:xs[0]?.source_kind??null,
        status:xs.length?"ACTIVE":"NO_RECENT_QUOTES"
      };
    }

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"sharp-disagreement-v1",
      shadowOnly:true,
      affectsDecision:false,
      classificationCounts:by(diagnoses??[],"classification"),
      averageConfidence:(()=>{
        const xs=(diagnoses??[]).map((x:any)=>Number(x.confidence)).filter(Number.isFinite);
        return xs.length?Number((xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(3)):null;
      })(),
      sourceHealth,
      recent:(diagnoses??[]).slice(0,50).map((d:any)=>({
        sharpGateId:d.sharp_gate_id,eventId:d.event_id,startsAt:d.starts_at,
        marketType:d.market_type,marketSide:d.market_side,marketLine:d.market_line,
        classification:d.classification,confidence:d.confidence,reasonCode:d.reason_code,reason:d.reason,
        validSources:d.valid_source_count,freshSources:d.fresh_source_count,staleSources:d.stale_source_count,
        invalidSources:d.invalid_source_count,unavailableSources:d.unavailable_source_count,
        spreadPp:d.spread_pp,sourceAgeGapMinutes:d.source_age_gap_minutes,
        movementDirection:d.movement_direction,movementSourceCount:d.movement_source_count,
        movementMagnitude:d.movement_magnitude,outlierSource:d.outlier_source,outlierDistancePp:d.outlier_distance_pp
      }))
    }),{headers:{"content-type":"application/json","cache-control":"public, max-age=20"}});
  }catch(error){
    return new Response(JSON.stringify({error:error instanceof Error?error.message:JSON.stringify(error)}),
      {status:500,headers:{"content-type":"application/json"}});
  }
});