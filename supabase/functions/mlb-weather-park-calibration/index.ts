import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function num(v:unknown):number|null{
  if(v===null||v===undefined||v==="") return null;
  const n=Number(v); return Number.isFinite(n)?n:null;
}
function runBucket(m:number|null){
  if(m===null) return "UNKNOWN";
  return m>=1.025?"RUN_UP":m<=0.975?"RUN_DOWN":"NEUTRAL";
}
function propFamily(stat:string){
  if(stat==="batting_homeRuns") return "HOME_RUNS";
  if(stat==="batting_totalBases") return "TOTAL_BASES";
  if(stat==="batting_hits") return "HITS";
  if(stat==="pitching_strikeouts") return "STRIKEOUTS";
  return "GENERIC";
}
function propMultiplier(stat:string,e:any){
  const hr=num(e.hr_multiplier),hit=num(e.hits_tb_multiplier),k=num(e.strikeout_opportunity_multiplier),run=num(e.run_multiplier);
  if(stat==="batting_homeRuns") return hr;
  if(stat==="batting_totalBases"&&hr!==null&&hit!==null) return 0.6*hit+0.4*hr;
  if(stat==="batting_hits") return hit;
  if(stat==="pitching_strikeouts") return k;
  return run;
}
function direction(side:string,m:number|null){
  if(m===null||Math.abs(m-1)<0.01) return "NEUTRAL";
  const up=m>1,over=String(side||"").toLowerCase()==="over";
  return up===over?"FAVORABLE":"ADVERSE";
}
function summarizeOutcomes(rows:any[]){
  const g=rows.filter(r=>["W","L","PUSH"].includes(String(r.outcome)));
  const w=g.filter(r=>r.outcome==="W").length,l=g.filter(r=>r.outcome==="L").length,p=g.filter(r=>r.outcome==="PUSH").length;
  return {graded:g.length,wins:w,losses:l,pushes:p,winRate:w+l?Number((w/(w+l)).toFixed(4)):null};
}
function group(rows:any[],field:string){
  const out:Record<string,any>={};
  for(const r of rows){
    const k=String(r?.[field]??"UNKNOWN");
    (out[k]??=[]).push(r);
  }
  return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,summarizeOutcomes(v as any[])]));
}
function average(xs:number[]){
  return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
}

Deno.serve(async(req)=>{
  try{
    if(req.method!=="GET") return new Response(JSON.stringify({error:"GET only"}),{status:405,headers:{"content-type":"application/json"}});
    const u=new URL(req.url);
    const days=Math.max(1,Math.min(365,Number(u.searchParams.get("days")||90)));
    const since=new Date(Date.now()-days*86400_000).toISOString();
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [{data:env,error:ee},{data:tmr,error:te},{data:ppr,error:pe}]=await Promise.all([
      supabase.from("mlb_weather_park_final_pregame").select("*").gte("starts_at",since).limit(1000),
      supabase.from("team_market_results").select("*").gte("graded_at",since).limit(10000),
      supabase.from("player_prop_results").select("*").gte("graded_at",since).limit(20000)
    ]);
    if(ee) throw ee;if(te) throw te;if(pe) throw pe;

    const envMap=new Map((env??[]).map((e:any)=>[Number(e.game_pk),e]));
    const teamIds=[...new Set((tmr??[]).map((r:any)=>Number(r.observation_id)).filter(Number.isFinite))];
    const propIds=[...new Set((ppr??[]).map((r:any)=>Number(r.observation_id)).filter(Number.isFinite))];

    let teamObs:any[]=[];let propObs:any[]=[];
    if(teamIds.length){
      const {data,error}=await supabase.from("market_grade_observations")
        .select("id,game_pk,market_type,market_side,market_label,line,starts_at")
        .in("id",teamIds.slice(0,10000));
      if(error) throw error; teamObs=data??[];
    }
    if(propIds.length){
      const {data,error}=await supabase.from("player_prop_observations")
        .select("id,game_pk,stat_id,side,label,line,starts_at")
        .in("id",propIds.slice(0,20000));
      if(error) throw error; propObs=data??[];
    }
    const teamObsMap=new Map(teamObs.map((x:any)=>[Number(x.id),x]));
    const propObsMap=new Map(propObs.map((x:any)=>[Number(x.id),x]));

    const team=(tmr??[]).map((r:any)=>{
      const o=teamObsMap.get(Number(r.observation_id)); const e=o?envMap.get(Number(o.game_pk)):null;
      if(!o||!e) return null;
      const rb=runBucket(num(e.run_multiplier));
      let impact="NEUTRAL";
      if(o.market_type==="total"&&rb!=="NEUTRAL"){
        const favorsOver=rb==="RUN_UP";
        const isOver=String(o.market_side)==="over";
        impact=favorsOver===isOver?"FAVORABLE":"ADVERSE";
      }
      return {...r,marketType:o.market_type,marketSide:o.market_side,runBucket:rb,impactDirection:impact,
        runMultiplier:num(e.run_multiplier),delayRisk:e.delay_risk,
        actualTotal:(num(r.away_score)!==null&&num(r.home_score)!==null)?Number(r.away_score)+Number(r.home_score):null};
    }).filter(Boolean);

    const props=(ppr??[]).map((r:any)=>{
      const o=propObsMap.get(Number(r.observation_id)); const e=o?envMap.get(Number(o.game_pk)):null;
      if(!o||!e) return null;
      const m=propMultiplier(String(o.stat_id||""),e);
      return {...r,propFamily:propFamily(String(o.stat_id||"")),impactDirection:direction(String(o.side||""),m),
        environmentMultiplier:m,runBucket:runBucket(num(e.run_multiplier)),delayRisk:e.delay_risk};
    }).filter(Boolean);

    const totalRows=team.filter((r:any)=>r.marketType==="total");
    const actualTotals=team.map((r:any)=>num(r.actualTotal)).filter((x):x is number=>x!==null);
    const propMult=props.map((r:any)=>num(r.environmentMultiplier)).filter((x):x is number=>x!==null);

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),version:"weather-park-v1",days,shadowOnly:true,affectsDecision:false,
      sampleStatus:(env?.length??0)>=100?"EVALUABLE":(env?.length??0)>=30?"EARLY":"INSUFFICIENT_SAMPLE",
      finalPregameEnvironmentSnapshots:env?.length??0,
      teamMarkets:{
        overall:summarizeOutcomes(team),byRunBucket:group(team,"runBucket"),byDelayRisk:group(team,"delayRisk"),
        totals:{overall:summarizeOutcomes(totalRows),byImpactDirection:group(totalRows,"impactDirection")},
        averageActualGameTotal:actualTotals.length?Number(average(actualTotals)!.toFixed(3)):null
      },
      playerProps:{
        overall:summarizeOutcomes(props),byFamily:group(props,"propFamily"),byImpactDirection:group(props,"impactDirection"),
        byRunBucket:group(props,"runBucket"),byDelayRisk:group(props,"delayRisk"),
        averageEnvironmentMultiplier:propMult.length?Number(average(propMult)!.toFixed(4)):null
      },
      note:"Calibration is descriptive. Weather/park multipliers remain shadow-only until sample size and stability are sufficient."
    }),{headers:{"content-type":"application/json","cache-control":"public, max-age=60"}});
  }catch(error){
    return new Response(JSON.stringify({error:error instanceof Error?error.message:JSON.stringify(error)}),
      {status:500,headers:{"content-type":"application/json"}});
  }
});