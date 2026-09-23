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
    const days=Math.max(1,Math.min(90,Number(u.searchParams.get("days")||14)));
    const since=new Date(Date.now()-days*86400_000).toISOString();
    const quoteSince=new Date(Date.now()-30*60_000).toISOString();

    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [
      {data:clv,error:ce},
      {data:quotes,error:qe}
    ]=await Promise.all([
      supabase.from("player_prop_clv").select("*")
        .gte("starts_at",since)
        .order("starts_at",{ascending:false})
        .limit(5000),
      supabase.from("player_prop_market_quotes")
        .select("observed_at,book,event_id,player_id,stat_id,side,line,odds")
        .gte("observed_at",quoteSince)
        .order("observed_at",{ascending:false})
        .limit(10000)
    ]);
    if(ce) throw ce;
    if(qe) throw qe;

    const rows=clv??[];
    const finalized=rows.filter((r:any)=>r.finalized);
    const tracking=rows.filter((r:any)=>!r.finalized);
    const lineClv=finalized.map((r:any)=>Number(r.line_clv_units)).filter(Number.isFinite);
    const fairClv=finalized.map((r:any)=>Number(r.fair_probability_clv_pp)).filter(Number.isFinite);
    const sameClv=finalized.map((r:any)=>Number(r.same_book_price_clv_pp)).filter(Number.isFinite);

    const bookHealth:Record<string,any>={};
    for(const book of ["draftkings","fanduel","betmgm","caesars"]){
      const xs=(quotes??[]).filter((q:any)=>String(q.book).toLowerCase()===book);
      bookHealth[book]={
        quotesLast30m:xs.length,
        latestObservedAt:xs[0]?.observed_at??null,
        status:xs.length?"ACTIVE":"NO_RECENT_QUOTES"
      };
    }

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"player-prop-clv-v1",
      source:"SportsGameOdds v2 via own pregame snapshots",
      captureCadenceMinutes:5,
      captureWindowMinutes:360,
      retentionDays:14,
      summary:{
        tracked:rows.length,
        tracking:tracking.length,
        finalized:finalized.length,
        byClassification:countBy(finalized,"clv_classification"),
        averageLineClvUnits:lineClv.length?Number(avg(lineClv)!.toFixed(3)):null,
        averageFairProbabilityClvPp:fairClv.length?Number(avg(fairClv)!.toFixed(3)):null,
        averageSameBookPriceClvPp:sameClv.length?Number(avg(sameClv)!.toFixed(3)):null,
        positiveCloseRate:finalized.length
          ? Number((finalized.filter((r:any)=>String(r.clv_classification).startsWith("POSITIVE")).length/finalized.length).toFixed(4))
          : null
      },
      bookHealth,
      tracking:tracking.slice(0,100),
      recentFinalized:finalized.slice(0,100)
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