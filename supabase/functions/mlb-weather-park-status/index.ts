import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async(req)=>{
  try{
    if(req.method!=="GET") return new Response(JSON.stringify({error:"GET only"}),{status:405,headers:{"content-type":"application/json"}});
    const u=new URL(req.url);
    const hours=Math.max(1,Math.min(72,Number(u.searchParams.get("hours")||24)));
    const since=new Date(Date.now()-hours*3600_000).toISOString();
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [{data:games,error:ge},{data:teams,error:te},{data:props,error:pe}]=await Promise.all([
      supabase.from("mlb_weather_park_latest").select("*").gte("checked_at",since).order("starts_at",{ascending:true}).limit(100),
      supabase.from("team_market_weather_latest").select("*").gte("evaluated_at",since).limit(1000),
      supabase.from("player_prop_weather_latest").select("*").gte("evaluated_at",since).limit(3000)
    ]);
    if(ge) throw ge;if(te) throw te;if(pe) throw pe;
    const count=(xs:any[],field:string)=>{
      const o:Record<string,number>={};
      for(const x of xs){const k=String(x?.[field]??"UNKNOWN");o[k]=(o[k]||0)+1;}
      return o;
    };
    const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
    const vals=(field:string)=>(games??[]).map((g:any)=>Number(g[field])).filter(Number.isFinite);
    const latest=(games??[]).reduce((b:string|null,g:any)=>!b||Date.parse(g.checked_at)>Date.parse(b)?g.checked_at:b,null);

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),version:"weather-park-v1",shadowOnly:true,affectsDecision:false,
      refreshCadenceMinutes:5,pregameCaptureWindowMinutes:180,finalWindowMinutes:20,
      sources:{baseball:"MLB Stats live feed",humidityPrecipitation:"Open-Meteo"},
      latestCheckedAt:latest,
      summary:{
        games:games?.length??0,
        states:count(games??[],"state"),
        delayRisk:count(games??[],"delay_risk"),
        roofStatus:count(games??[],"roof_status"),
        materialChanges:(games??[]).filter((x:any)=>x.material_change).length,
        averages:{
          runMultiplier:vals("run_multiplier").length?Number(avg(vals("run_multiplier"))!.toFixed(4)):null,
          hrMultiplier:vals("hr_multiplier").length?Number(avg(vals("hr_multiplier"))!.toFixed(4)):null,
          hitsTbMultiplier:vals("hits_tb_multiplier").length?Number(avg(vals("hits_tb_multiplier"))!.toFixed(4)):null,
          starterDurability:vals("starter_durability_multiplier").length?Number(avg(vals("starter_durability_multiplier"))!.toFixed(4)):null,
          kOpportunity:vals("strikeout_opportunity_multiplier").length?Number(avg(vals("strikeout_opportunity_multiplier"))!.toFixed(4)):null
        },
        teamMarketImpact:count(teams??[],"state"),
        playerPropImpact:count(props??[],"state")
      },
      games:(games??[]).map((g:any)=>({
        id:g.id,gamePk:g.game_pk,eventId:g.event_id,startsAt:g.starts_at,
        matchup:String(g.away_team??"Away")+" @ "+String(g.home_team??"Home"),
        venue:g.venue,parkFactor:g.park_factor,parkFactorKnown:g.park_factor_known,
        roof:{type:g.roof_type,status:g.roof_status,source:g.roof_source},
        weather:{condition:g.condition,tempF:g.temp_f,humidityPct:g.humidity_pct,
          precipProbabilityPct:g.precip_probability_pct,precipInches:g.precip_inches,
          wind:g.wind_text,windMph:g.wind_mph,windClass:g.wind_class},
        impact:{state:g.state,runMultiplier:g.run_multiplier,teamRunMultiplier:g.team_run_multiplier,
          hrMultiplier:g.hr_multiplier,hitsTbMultiplier:g.hits_tb_multiplier,
          starterDurabilityMultiplier:g.starter_durability_multiplier,
          strikeoutOpportunityMultiplier:g.strikeout_opportunity_multiplier,
          expectedTotalDeltaRunsAt8_5:g.expected_total_delta_runs_at_8_5,
          delayRisk:g.delay_risk,dataQuality:g.data_quality},
        materialChange:{changed:g.material_change,at:g.material_change_at,reasons:g.material_change_reasons},
        reasons:g.reasons,warnings:g.warnings
      }))
    }),{headers:{"content-type":"application/json","cache-control":"public, max-age=20"}});
  }catch(error){
    return new Response(JSON.stringify({error:error instanceof Error?error.message:JSON.stringify(error)}),
      {status:500,headers:{"content-type":"application/json"}});
  }
});