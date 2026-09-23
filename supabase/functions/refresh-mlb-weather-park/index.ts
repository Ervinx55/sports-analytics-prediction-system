import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MLB = "https://statsapi.mlb.com";

const PARK_FACTORS: Record<string, number> = {
  "Coors Field":112,"Fenway Park":103,"Target Field":103,"Chase Field":103,
  "Citizens Bank Park":102,"Nationals Park":102,"Oriole Park at Camden Yards":102,
  "Kauffman Stadium":101,"Yankee Stadium":101,"Rogers Centre":101,
  "Great American Ball Park":101,"PNC Park":101,"UNIQLO Field at Dodger Stadium":101,
  "Dodger Stadium":101,"Daikin Park":100,"Comerica Park":100,"Truist Park":100,
  "loanDepot park":100,"Progressive Field":99,"Rate Field":99,"Angel Stadium":99,
  "Wrigley Field":98,"American Family Field":98,"Citi Field":98,"Petco Park":97,
  "Oracle Park":97,"Busch Stadium":97,"Tropicana Field":97,"Globe Life Field":94,
  "T-Mobile Park":92,"Sutter Health Park":100
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function iso(v: unknown): string | null {
  const d = new Date(String(v || ""));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function parseWindMph(text: unknown) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*mph/i);
  return m ? Number(m[1]) : null;
}
function angleDiff(a:number,b:number) {
  let d=Math.abs(a-b)%360;
  return d>180?360-d:d;
}
function classifyWind(text: unknown, directionDeg:number|null, fieldAzimuth:number|null) {
  const s=String(text||"").toLowerCase();
  if (/out to/.test(s)) return "OUT";
  if (/in from/.test(s)) return "IN";
  if (/left to right|right to left|cross/.test(s)) return "CROSS";
  if (/calm/.test(s)) return "CALM";
  if (directionDeg!==null && fieldAzimuth!==null) {
    const flow=(directionDeg+180)%360;
    const d=angleDiff(flow,fieldAzimuth);
    if (d<=45) return "OUT";
    if (d>=135) return "IN";
    return "CROSS";
  }
  return "UNKNOWN";
}
async function fetchJson(url:string) {
  const r=await fetch(url,{headers:{accept:"application/json"},cache:"no-store"});
  const text=await r.text();
  let body:any;
  try{body=JSON.parse(text)}catch{body={error:text.slice(0,500)}}
  if(!r.ok) throw new Error(`${r.status} ${url}: ${JSON.stringify(body).slice(0,500)}`);
  return body;
}
function nearestHourly(hourly:any, startsAt:string|null) {
  const times=Array.isArray(hourly?.time)?hourly.time:[];
  const target=Date.parse(startsAt||"");
  if(!times.length || !Number.isFinite(target)) return null;
  let best=-1,bestDiff=Infinity;
  for(let i=0;i<times.length;i++){
    const t=Date.parse(String(times[i])+"Z");
    const d=Math.abs(t-target);
    if(d<bestDiff){best=i;bestDiff=d;}
  }
  if(best<0) return null;
  return {
    time:times[best],
    temperatureF:num(hourly?.temperature_2m?.[best]),
    humidityPct:num(hourly?.relative_humidity_2m?.[best]),
    precipProbabilityPct:num(hourly?.precipitation_probability?.[best]),
    precipInches:num(hourly?.precipitation?.[best]),
    windMph:num(hourly?.wind_speed_10m?.[best]),
    windDirectionDeg:num(hourly?.wind_direction_10m?.[best]),
  };
}
async function openMeteo(lat:number|null,lon:number|null,startsAt:string|null) {
  if(lat===null || lon===null || !startsAt) return null;
  const url="https://api.open-meteo.com/v1/forecast?"+
    new URLSearchParams({
      latitude:String(lat),longitude:String(lon),
      hourly:"temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m",
      temperature_unit:"fahrenheit",wind_speed_unit:"mph",precipitation_unit:"inch",
      timezone:"UTC",past_days:"2",forecast_days:"3"
    }).toString();
  const j=await fetchJson(url);
  return {provider:"Open-Meteo",...nearestHourly(j?.hourly,startsAt),rawElevationM:num(j?.elevation)};
}
function resolveRoofStatus(roofType:string|null,condition:string|null,override:any) {
  if(override?.roof_status==="OPEN" || override?.roof_status==="CLOSED") {
    return {status:override.roof_status,source:"verified_override"};
  }
  const t=String(roofType||"").toLowerCase();
  const c=String(condition||"").toLowerCase();
  if(/roof closed|closed roof/.test(c)) return {status:"CLOSED",source:"mlb_condition"};
  if(/roof open|open roof/.test(c)) return {status:"OPEN",source:"mlb_condition"};
  if(t.includes("dome")) return {status:"CLOSED",source:"venue_roof_type"};
  if(t==="open") return {status:"OPEN",source:"venue_roof_type"};
  if(t.includes("retractable")) return {status:"UNKNOWN",source:"unverified_retractable"};
  return {status:"UNKNOWN",source:"unknown"};
}
function delayRank(x:string|null){
  return x==="HIGH"?3:x==="MEDIUM"?2:x==="WATCH"?1:0;
}
function impactDirectionForTeam(obs:any,run:number|null) {
  if(run===null) return {direction:"UNKNOWN",multiplier:null,reason:"ENVIRONMENT_MISSING"};
  if(obs.market_type==="total"){
    const up=run>1.01,down=run<0.99;
    if(!up&&!down) return {direction:"NEUTRAL",multiplier:run,reason:"TOTAL_ENVIRONMENT_NEUTRAL"};
    const overFav=up;
    const side=String(obs.market_side||"").toLowerCase();
    const favorable=(side==="over"&&overFav)||(side==="under"&&!overFav);
    return {direction:favorable?"FAVORABLE":"ADVERSE",multiplier:run,reason:up?"TOTAL_RUN_ENVIRONMENT_UP":"TOTAL_RUN_ENVIRONMENT_DOWN"};
  }
  return {
    direction:run>1.025?"VARIANCE_UP":run<0.975?"VARIANCE_DOWN":"NEUTRAL",
    multiplier:run,
    reason:run>1.025?"SCORING_VARIANCE_UP":run<0.975?"SCORING_VARIANCE_DOWN":"SCORING_VARIANCE_NEUTRAL"
  };
}
function propFamily(statId:string){
  if(statId==="batting_homeRuns") return "HOME_RUNS";
  if(statId==="batting_totalBases") return "TOTAL_BASES";
  if(statId==="batting_hits") return "HITS";
  if(statId==="pitching_strikeouts") return "STRIKEOUTS";
  return "GENERIC";
}
function propMultiplier(statId:string,s:any){
  const hr=num(s.hr_multiplier),hit=num(s.hits_tb_multiplier),k=num(s.strikeout_opportunity_multiplier),run=num(s.run_multiplier);
  if(statId==="batting_homeRuns") return hr;
  if(statId==="batting_totalBases" && hr!==null && hit!==null) return 0.6*hit+0.4*hr;
  if(statId==="batting_hits") return hit;
  if(statId==="pitching_strikeouts") return k;
  return run;
}
function propDirection(side:string,m:number|null){
  if(m===null) return "UNKNOWN";
  if(Math.abs(m-1)<0.01) return "NEUTRAL";
  const up=m>1;
  const over=String(side||"").toLowerCase()==="over";
  return (up===over)?"FAVORABLE":"ADVERSE";
}

Deno.serve(async(req)=>{
  try{
    if(req.method!=="POST") return new Response(JSON.stringify({error:"POST only"}),{status:405,headers:{"content-type":"application/json"}});
    const body=await req.json().catch(()=>({}));
    const requested=Array.isArray(body.gamePks)?body.gamePks.map(Number).filter(Number.isFinite):[];
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const since=requested.length
      ? new Date(Date.now()-12*3600_000).toISOString()
      : new Date().toISOString();
    const until=new Date(Date.now()+(requested.length?36*3600_000:180*60_000)).toISOString();
    const [{data:markets,error:me},{data:props,error:pe}]=await Promise.all([
      supabase.from("market_grade_latest").select("*").gte("starts_at",since).lte("starts_at",until).not("game_pk","is",null),
      supabase.from("player_prop_latest").select("*").gte("starts_at",since).lte("starts_at",until).not("game_pk","is",null)
    ]);
    if(me) throw new Error("market query: "+JSON.stringify(me));
    if(pe) throw new Error("prop query: "+JSON.stringify(pe));

    const allMarkets=markets??[],allProps=props??[];
    const marketRows=requested.length?allMarkets.filter((r:any)=>requested.includes(Number(r.game_pk))):allMarkets;
    const propRows=requested.length?allProps.filter((r:any)=>requested.includes(Number(r.game_pk))):allProps;

    const games=new Map<number,any>();
    for(const r of [...marketRows,...propRows]){
      const gp=Number(r.game_pk); if(!Number.isFinite(gp)) continue;
      if(!games.has(gp)) games.set(gp,{gamePk:gp,eventId:r.event_id,startsAt:r.starts_at,awayTeam:r.away_team,homeTeam:r.home_team});
    }
    for(const gp of requested) if(!games.has(gp)) games.set(gp,{gamePk:gp,eventId:null,startsAt:null});

    const outputs:any[]=[];
    for(const game of games.values()){
      const feed=await fetchJson(`${MLB}/api/v1.1/game/${game.gamePk}/feed/live`);
      const gd=feed?.gameData??{},venue=gd?.venue??{},weather=gd?.weather??{},field=venue?.fieldInfo??{},loc=venue?.location??{};
      const startsAt=iso(game.startsAt??gd?.datetime?.dateTime);
      const lat=num(loc?.defaultCoordinates?.latitude),lon=num(loc?.defaultCoordinates?.longitude);
      const meteo=await openMeteo(lat,lon,startsAt).catch(()=>null);

      const {data:override}=await supabase.from("mlb_roof_status_overrides").select("*")
        .eq("game_pk",game.gamePk).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).maybeSingle();

      const roof=resolveRoofStatus(field?.roofType??null,weather?.condition??null,override);
      const temp=num(weather?.temp)??num(meteo?.temperatureF);
      const mlbWind=parseWindMph(weather?.wind);
      const windMph=mlbWind??num(meteo?.windMph);
      const windDeg=num(meteo?.windDirectionDeg);
      const az=num(loc?.azimuthAngle);
      const windClass=classifyWind(weather?.wind,windDeg,az);
      const venueName=venue?.name??null;
      const pfKnown=Object.prototype.hasOwnProperty.call(PARK_FACTORS,venueName);
      const pf=pfKnown?PARK_FACTORS[venueName]:100;

      const {data:impact,error:impactError}=await supabase.rpc("compute_weather_park_impact_v1",{
        p_park_factor:pf,p_park_factor_known:pfKnown,p_temp_f:temp,
        p_humidity_pct:num(meteo?.humidityPct),p_wind_mph:windMph,p_wind_class:windClass,
        p_roof_type:field?.roofType??null,p_roof_status:roof.status,
        p_precip_probability_pct:num(meteo?.precipProbabilityPct),
        p_precip_inches:num(meteo?.precipInches),p_condition:weather?.condition??null,
        p_elevation_ft:num(loc?.elevation)
      });
      if(impactError) throw new Error("impact rpc: "+JSON.stringify(impactError));

      const {data:prev}=await supabase.from("mlb_weather_park_snapshots").select("*")
        .eq("game_pk",game.gamePk).order("checked_at",{ascending:false}).limit(1).maybeSingle();

      const run=num(impact?.runMultiplier),hr=num(impact?.hrMultiplier);
      const materialReasons:string[]=[];
      if(prev){
        const pr=num(prev.run_multiplier),ph=num(prev.hr_multiplier);
        if(run!==null&&pr!==null&&Math.abs(run-pr)>=0.02) materialReasons.push("Run multiplier moved by at least 2%.");
        if(hr!==null&&ph!==null&&Math.abs(hr-ph)>=0.04) materialReasons.push("HR multiplier moved by at least 4%.");
        if(delayRank(String(impact?.delayRisk||""))>delayRank(prev.delay_risk)) materialReasons.push("Delay/weather risk worsened.");
        if(prev.roof_status&&prev.roof_status!==impact?.roofStatus) materialReasons.push("Roof status changed.");
        if(prev.wind_class&&prev.wind_class!==windClass&&["IN","OUT"].includes(prev.wind_class)&&["IN","OUT"].includes(windClass)) materialReasons.push("Wind flipped between in and out.");
        if(num(prev.temp_f)!==null&&temp!==null&&Math.abs(temp-Number(prev.temp_f))>=10) materialReasons.push("Temperature moved by at least 10°F.");
      }
      const materialChange=materialReasons.length>0;
      const materialChangeAt=materialChange?new Date().toISOString():(prev?.material_change_at??null);

      const row:any={
        checked_at:new Date().toISOString(),event_id:game.eventId,game_pk:game.gamePk,starts_at:startsAt,
        away_team:gd?.teams?.away?.name??game.awayTeam??null,home_team:gd?.teams?.home?.name??game.homeTeam??null,
        venue:venueName,venue_id:num(venue?.id),latitude:lat,longitude:lon,elevation_ft:num(loc?.elevation),field_azimuth_deg:az,
        roof_type:field?.roofType??null,roof_status:impact?.roofStatus??roof.status,roof_source:roof.source,
        condition:weather?.condition??null,temp_f:temp,humidity_pct:num(meteo?.humidityPct),
        precip_probability_pct:num(meteo?.precipProbabilityPct),precip_inches:num(meteo?.precipInches),
        wind_text:weather?.wind??null,wind_mph:windMph,wind_direction_deg:windDeg,wind_class:windClass,
        park_factor:pf,park_factor_known:pfKnown,run_multiplier:run,team_run_multiplier:num(impact?.teamRunMultiplier),
        hr_multiplier:hr,hits_tb_multiplier:num(impact?.hitsTbMultiplier),
        starter_durability_multiplier:num(impact?.starterDurabilityMultiplier),
        strikeout_opportunity_multiplier:num(impact?.strikeoutOpportunityMultiplier),
        expected_total_delta_runs_at_8_5:num(impact?.expectedTotalDeltaRunsAt8_5),
        delay_risk:impact?.delayRisk??null,state:impact?.state??"PENDING",data_quality:num(impact?.dataQuality),
        previous_run_multiplier:num(prev?.run_multiplier),previous_hr_multiplier:num(prev?.hr_multiplier),
        previous_delay_risk:prev?.delay_risk??null,previous_roof_status:prev?.roof_status??null,
        material_change:materialChange,material_change_at:materialChangeAt,material_change_reasons:materialReasons,
        reasons:impact?.reasons??[],warnings:impact?.warnings??[],
        raw:{source:{mlb:"MLB Stats live feed",weather:"Open-Meteo"},openMeteo:meteo,impact,
             roofOverride:override?{status:override.roof_status,source:override.source,verifiedAt:override.verified_at}:null}
      };
      const {data:snap,error:se}=await supabase.from("mlb_weather_park_snapshots").insert(row).select("*").single();
      if(se) throw new Error("snapshot insert: "+JSON.stringify(se));

      for(const obs of marketRows.filter((x:any)=>Number(x.game_pk)===game.gamePk)){
        const changed=Boolean(snap.material_change_at&&Date.parse(snap.material_change_at)>Date.parse(obs.captured_at||""));
        const imp=impactDirectionForTeam(obs,num(snap.run_multiplier));
        const state=changed?"REMODEL":snap.state==="PENDING"?"PENDING":snap.state==="WEATHER_RISK"?"WEATHER_RISK":"READY";
        const payload={
          observation_id:Number(obs.id),snapshot_id:snap.id,evaluated_at:new Date().toISOString(),
          state,impact_direction:imp.direction,impact_multiplier:imp.multiplier,
          run_multiplier:snap.run_multiplier,hr_multiplier:snap.hr_multiplier,hits_tb_multiplier:snap.hits_tb_multiplier,
          starter_durability_multiplier:snap.starter_durability_multiplier,
          strikeout_opportunity_multiplier:snap.strikeout_opportunity_multiplier,
          delay_risk:snap.delay_risk,data_quality:snap.data_quality,weather_change_after_model:changed,
          reason_code:changed?"MATERIAL_WEATHER_CHANGE_AFTER_MODEL":imp.reason,
          reasons:snap.reasons,warnings:[...(snap.warnings??[]),...(changed?snap.material_change_reasons??[]:[])],
          raw:{marketType:obs.market_type,marketSide:obs.market_side,marketLabel:obs.market_label,
               expectedTotalDeltaRunsAt8_5:snap.expected_total_delta_runs_at_8_5}
        };
        const {error}=await supabase.from("team_market_weather_shadow").upsert(payload,{onConflict:"observation_id"});
        if(error) throw new Error("team weather upsert: "+JSON.stringify(error));
      }

      for(const obs of propRows.filter((x:any)=>Number(x.game_pk)===game.gamePk)){
        const changed=Boolean(snap.material_change_at&&Date.parse(snap.material_change_at)>Date.parse(obs.captured_at||""));
        const m=propMultiplier(String(obs.stat_id||""),snap);
        const dir=propDirection(String(obs.side||""),m);
        let state=changed?"REMODEL":snap.state==="PENDING"?"PENDING":snap.state==="WEATHER_RISK"?"WEATHER_RISK":
          dir==="FAVORABLE"?"FAVORABLE":dir==="ADVERSE"?"ADVERSE":"NEUTRAL";
        const family=propFamily(String(obs.stat_id||""));
        const payload={
          observation_id:Number(obs.id),snapshot_id:snap.id,evaluated_at:new Date().toISOString(),
          prop_family:family,state,impact_direction:dir,impact_multiplier:m,raw_environment_multiplier:
            family==="HOME_RUNS"?snap.hr_multiplier:family==="STRIKEOUTS"?snap.strikeout_opportunity_multiplier:snap.hits_tb_multiplier,
          delay_risk:snap.delay_risk,data_quality:snap.data_quality,weather_change_after_model:changed,
          reason_code:changed?"MATERIAL_WEATHER_CHANGE_AFTER_MODEL":
            state==="WEATHER_RISK"?"WEATHER_DELAY_RISK":dir==="FAVORABLE"?"ENVIRONMENT_FAVORS_PROP_SIDE":
            dir==="ADVERSE"?"ENVIRONMENT_OPPOSES_PROP_SIDE":"ENVIRONMENT_NEUTRAL",
          reasons:snap.reasons,warnings:[...(snap.warnings??[]),...(changed?snap.material_change_reasons??[]:[])],
          raw:{statId:obs.stat_id,label:obs.label,side:obs.side,hrMultiplier:snap.hr_multiplier,
               hitsTbMultiplier:snap.hits_tb_multiplier,kOpportunityMultiplier:snap.strikeout_opportunity_multiplier,
               starterDurabilityMultiplier:snap.starter_durability_multiplier}
        };
        const {error}=await supabase.from("player_prop_weather_shadow").upsert(payload,{onConflict:"observation_id"});
        if(error) throw new Error("prop weather upsert: "+JSON.stringify(error));
      }

      outputs.push({
        snapshotId:snap.id,gamePk:game.gamePk,eventId:game.eventId,startsAt,state:snap.state,
        venue:venueName,roof:{type:snap.roof_type,status:snap.roof_status,source:snap.roof_source},
        weather:{condition:snap.condition,tempF:snap.temp_f,humidityPct:snap.humidity_pct,
          precipProbabilityPct:snap.precip_probability_pct,precipInches:snap.precip_inches,
          wind:snap.wind_text,windMph:snap.wind_mph,windClass:snap.wind_class},
        impact:{run:snap.run_multiplier,hr:snap.hr_multiplier,hitsTb:snap.hits_tb_multiplier,
          starterDurability:snap.starter_durability_multiplier,kOpportunity:snap.strikeout_opportunity_multiplier,
          delayRisk:snap.delay_risk,dataQuality:snap.data_quality},
        materialChange:{changed:snap.material_change,at:snap.material_change_at,reasons:snap.material_change_reasons}
      });
    }

    return new Response(JSON.stringify({
      ok:true,version:"weather-park-v1",shadowOnly:true,affectsDecision:false,capturedGames:outputs.length,games:outputs
    }),{headers:{"content-type":"application/json"}});
  }catch(error){
    return new Response(JSON.stringify({ok:false,error:error instanceof Error?error.message:JSON.stringify(error)}),
      {status:500,headers:{"content-type":"application/json"}});
  }
});