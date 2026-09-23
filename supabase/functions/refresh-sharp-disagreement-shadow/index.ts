import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SOURCE_NAMES = ["pinnacle","circa","bookmaker"];

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function americanToProb(v: unknown) {
  const o = num(v);
  if (o === null || o === 0) return null;
  return o > 0 ? 100/(o+100) : Math.abs(o)/(Math.abs(o)+100);
}
function fairProb(candidateOdds: unknown, opponentOdds: unknown) {
  const a = americanToProb(candidateOdds), b = americanToProb(opponentOdds);
  if (a === null || b === null || a+b <= 0) return null;
  return a/(a+b);
}
function minutesBetween(later: unknown, earlier: unknown) {
  const a = Date.parse(String(later||"")), b = Date.parse(String(earlier||""));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0,(a-b)/60000);
}
function median(xs:number[]) {
  if (!xs.length) return null;
  const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function sourceLabel(x:string){
  return x==="pinnacle"?"Pinnacle":x==="circa"?"Circa":"BookMaker";
}
function currentSource(g:any,name:string){
  const detailed=g?.raw?.sources?.[name]??{};
  const summary=g?.source_summary?.[name]??{};
  const status=String(detailed?.status??summary?.status??"unavailable");
  const fp=num(
    detailed?.fairProbability ??
    summary?.fairProbability ??
    g?.[name+"_candidate_fair_probability"]
  );
  const updatedAt=
    detailed?.updatedAt ??
    g?.[name+"_freshness"] ??
    null;
  const freshnessMinutes=
    num(detailed?.freshnessMinutes ?? summary?.freshnessMinutes) ??
    minutesBetween(g?.checked_at,updatedAt);
  const explicitValid=
    typeof detailed?.valid==="boolean" ? detailed.valid :
    typeof summary?.valid==="boolean" ? summary.valid : null;
  const valid=explicitValid ?? (
    fp!==null &&
    !/reject|invalid|unavailable|missing|inconsistent|mismatch|stale/i.test(status)
  );
  const fresh=
    typeof detailed?.fresh==="boolean" ? detailed.fresh :
    typeof summary?.fresh==="boolean" ? summary.fresh :
    freshnessMinutes!==null ? freshnessMinutes<=30 : false;
  const invalid=/reject|invalid|inconsistent|mismatch|missing two-sided|missing exact line/i.test(status);
  const unavailable=/unavailable|direct price unavailable|matchup found.*price unavailable/i.test(status);
  const stale=/stale/i.test(status) || (freshnessMinutes!==null && freshnessMinutes>45);
  return {
    name,label:sourceLabel(name),status,valid,fresh,invalid,unavailable,stale,
    fairProbability:fp,freshnessMinutes,updatedAt,
    provider:detailed?.provider??null
  };
}
function lineKey(v:unknown){
  const n=num(v); return n===null?"":String(n);
}
function norm(s:unknown){return String(s??"").trim().toLowerCase();}
function matchesGate(q:any,g:any){
  if (String(q.sport||"").toUpperCase()!==String(g.sport||"").toUpperCase()) return false;
  if (norm(q.away_team)!==norm(g.away_team) || norm(q.home_team)!==norm(g.home_team)) return false;
  if (norm(q.market_type)!==norm(g.market_type) || norm(q.market_side)!==norm(g.market_side)) return false;
  return true;
}
function movementForGate(g:any,quotes:any[]){
  const start=Date.parse(String(g.checked_at||""))-60*60000;
  const end=Date.parse(String(g.checked_at||""));
  const relevant=quotes.filter(q=>{
    const t=Date.parse(String(q.observed_at||""));
    return Number.isFinite(t)&&t>=start&&t<=end&&matchesGate(q,g);
  });
  const by=new Map<string,any[]>();
  for(const q of relevant){
    const k=String(q.source_book||"").toLowerCase();
    if(!SOURCE_NAMES.includes(k)) continue;
    if(!by.has(k)) by.set(k,[]);
    by.get(k)!.push(q);
  }
  const perSource:any={};
  const signedMoves:number[]=[];
  for(const [book,rows] of by){
    rows.sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at));
    const first=rows[0],last=rows[rows.length-1];
    let delta:number|null=null,unit="pp";
    if(norm(g.market_type)==="moneyline"){
      const a=fairProb(first.odds,first.opponent_odds);
      const b=fairProb(last.odds,last.opponent_odds);
      if(a!==null&&b!==null) delta=(b-a)*100;
    }else{
      const a=num(first.line),b=num(last.line);
      if(a!==null&&b!==null){delta=b-a;unit="line";}
    }
    const threshold=unit==="pp"?0.35:0.5;
    const meaningful=delta!==null&&Math.abs(delta)>=threshold;
    if(meaningful) signedMoves.push(delta!);
    perSource[book]={
      observations:rows.length,
      firstAt:first.observed_at,lastAt:last.observed_at,
      firstOdds:first.odds??null,lastOdds:last.odds??null,
      firstLine:first.line??null,lastLine:last.line??null,
      delta:delta===null?null:Number(delta.toFixed(4)),
      unit,meaningful
    };
  }
  const positives=signedMoves.filter(x=>x>0).length;
  const negatives=signedMoves.filter(x=>x<0).length;
  let direction="NONE",aligned=false;
  if(signedMoves.length>=2){
    if(positives===signedMoves.length){direction="UP";aligned=true;}
    else if(negatives===signedMoves.length){direction="DOWN";aligned=true;}
    else direction="MIXED";
  }else if(signedMoves.length===1){
    direction=signedMoves[0]>0?"UP":"DOWN";
  }
  return {
    direction,
    aligned,
    sourceCount:signedMoves.length,
    magnitude:signedMoves.length
      ? signedMoves.reduce((s,x)=>s+Math.abs(x),0)/signedMoves.length
      : null,
    windowMinutes:60,
    sources:perSource
  };
}
function classify(g:any,quotes:any[]){
  const sources=SOURCE_NAMES.map(name=>currentSource(g,name));
  const valid=sources.filter(s=>s.valid&&s.fairProbability!==null);
  const fresh=valid.filter(s=>s.fresh);
  const stale=sources.filter(s=>s.stale);
  const invalid=sources.filter(s=>s.invalid);
  const unavailable=sources.filter(s=>s.unavailable);
  const probs=valid.map(s=>Number(s.fairProbability));
  const spread=probs.length>=2?(Math.max(...probs)-Math.min(...probs))*100:null;
  const ages=valid.map(s=>s.freshnessMinutes).filter((x):x is number=>x!==null);
  const ageGap=ages.length>=2?Math.max(...ages)-Math.min(...ages):null;
  const med=median(probs);
  let outlierSource:null|string=null,outlierDistance:null|number=null;
  if(valid.length>=3&&med!==null){
    for(const s of valid){
      const d=Math.abs(Number(s.fairProbability)-med)*100;
      if(outlierDistance===null||d>outlierDistance){outlierDistance=d;outlierSource=s.name;}
    }
  }
  const movement=movementForGate(g,quotes);
  const quality=num(g.sharp_data_quality);

  let classification="DISAGREEMENT_WATCH";
  let confidence=0.55;
  let reasonCode="UNRESOLVED_DISAGREEMENT";
  let reason="Sharp sources are not aligned enough for consensus, but there is not enough evidence to identify a specific cause.";

  const explicitQualityIssue=invalid.length>0;
  const staleExplains =
    stale.length>0 &&
    ((spread!==null&&spread>=2.0) || valid.length<2 || (ageGap!==null&&ageGap>=25));

  if(valid.length<2){
    if(staleExplains){
      classification="STALE_PRICE";
      confidence=Math.min(0.95,0.72+0.05*stale.length+(ageGap!==null&&ageGap>=30?0.08:0));
      reasonCode="STALE_SOURCE_PREVENTS_CONSENSUS";
      reason="A stale sharp source is preventing a reliable multi-source consensus.";
    }else if(explicitQualityIssue){
      classification="SOURCE_QUALITY_PROBLEM";
      confidence=Math.min(0.96,0.78+0.05*invalid.length);
      reasonCode="INVALID_OR_INCONSISTENT_SOURCE";
      reason="A sharp source failed quote-integrity checks, so the disagreement cannot be treated as a real market opinion.";
    }else{
      classification="INSUFFICIENT_SOURCES";
      confidence=0.96;
      reasonCode="FEWER_THAN_TWO_VALID_SHARP_SOURCES";
      reason="Fewer than two valid sharp sources are available; there is no true cross-book disagreement to classify yet.";
    }
  }else if(staleExplains){
    classification="STALE_PRICE";
    confidence=Math.min(0.95,0.72+0.05*stale.length+(ageGap!==null&&ageGap>=30?0.08:0));
    reasonCode="STALE_OUTLIER_EXPLAINS_SPREAD";
    reason="The sharp spread is best explained by an older/stale source rather than a clean simultaneous disagreement.";
  }else if(spread!==null&&spread<=2.5){
    classification="CONSENSUS_OK";
    confidence=Math.min(0.97,0.74+0.05*valid.length+0.04*fresh.length);
    reasonCode="SHARP_SOURCES_ALIGNED";
    reason="Valid sharp sources are within the normal agreement band.";
  }else if(movement.aligned&&movement.sourceCount>=2){
    classification="MARKET_MOVING";
    confidence=Math.min(0.95,0.68+0.06*movement.sourceCount+0.03*valid.length);
    reasonCode="MULTIPLE_SHARP_SOURCES_MOVING_SAME_DIRECTION";
    reason="Multiple sharp sources are moving in the same direction, so the current spread looks like price discovery in progress.";
  }else if(
    spread!==null&&spread>=4.0&&
    fresh.length>=2&&
    (quality===null||quality>=0.60)&&
    !explicitQualityIssue
  ){
    classification="REAL_SHARP_DISAGREEMENT";
    confidence=Math.min(0.96,Math.max(0.72,(quality??0.65)+0.12));
    reasonCode="FRESH_VALID_SOURCES_DISAGREE";
    reason="Fresh, valid sharp sources remain materially separated without a common movement signal; treat this as genuine sharp disagreement.";
  }else if(explicitQualityIssue){
    classification="SOURCE_QUALITY_PROBLEM";
    confidence=Math.min(0.92,0.68+0.05*invalid.length);
    reasonCode="SOURCE_INTEGRITY_REDUCES_CONFIDENCE";
    reason="At least one source has an integrity problem, so the apparent disagreement should not be trusted as a clean market signal.";
  }else{
    classification="DISAGREEMENT_WATCH";
    confidence=0.58;
    reasonCode="MODERATE_DISAGREEMENT_UNRESOLVED";
    reason="Sharp sources differ, but the spread is not yet large or clean enough to label as genuine disagreement or active market movement.";
  }

  return {
    classification,
    confidence:Number(confidence.toFixed(3)),
    reasonCode,reason,
    validSourceCount:valid.length,
    freshSourceCount:fresh.length,
    staleSourceCount:stale.length,
    invalidSourceCount:invalid.length,
    unavailableSourceCount:unavailable.length,
    spreadPp:spread===null?null:Number(spread.toFixed(4)),
    sharpDataQuality:quality,
    sourceAgeGapMinutes:ageGap===null?null:Number(ageGap.toFixed(1)),
    outlierSource,
    outlierDistancePp:outlierDistance===null?null:Number(outlierDistance.toFixed(4)),
    movementDirection:movement.direction,
    movementSourceCount:movement.sourceCount,
    movementMagnitude:movement.magnitude===null?null:Number(movement.magnitude.toFixed(4)),
    movementWindowMinutes:movement.windowMinutes,
    sourceDiagnostics:Object.fromEntries(sources.map(s=>[s.name,s])),
    movementDiagnostics:movement
  };
}

Deno.serve(async(req)=>{
  try{
    if(req.method!=="POST"){
      return new Response(JSON.stringify({error:"POST only"}),{status:405,headers:{"content-type":"application/json"}});
    }
    const body=await req.json().catch(()=>({}));
    const hours=Math.max(1,Math.min(336,Number(body.hours||48)));
    const since=new Date(Date.now()-hours*3600_000).toISOString();
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const {data:gates,error:ge}=await supabase.from("sharp_gate_history").select("*")
      .gte("checked_at",since).order("checked_at",{ascending:true}).limit(2000);
    if(ge) throw ge;
    const gateRows=gates??[];
    const earliest=gateRows.length
      ? new Date(Math.min(...gateRows.map((g:any)=>Date.parse(g.checked_at||"")).filter(Number.isFinite))-60*60000).toISOString()
      : since;
    const quotes:any[]=[];
    for(let offset=0;offset<20000;offset+=1000){
      const {data:page,error:qe}=await supabase.from("sharp_source_quotes").select("*")
        .gte("observed_at",earliest)
        .order("observed_at",{ascending:true})
        .range(offset,offset+999);
      if(qe) throw qe;
      quotes.push(...(page??[]));
      if((page??[]).length<1000) break;
    }

    const rows:any[]=[];
    for(const g of gateRows){
      const d=classify(g,quotes??[]);
      rows.push({
        sharp_gate_id:Number(g.id),evaluated_at:new Date().toISOString(),
        sport:String(g.sport||"MLB").toUpperCase(),event_id:String(g.event_id),
        starts_at:g.starts_at??null,market_type:String(g.market_type||"moneyline"),
        market_side:String(g.market_side||g.side_key||""),market_line:num(g.market_line),
        classification:d.classification,confidence:d.confidence,
        reason_code:d.reasonCode,reason:d.reason,
        valid_source_count:d.validSourceCount,fresh_source_count:d.freshSourceCount,
        stale_source_count:d.staleSourceCount,invalid_source_count:d.invalidSourceCount,
        unavailable_source_count:d.unavailableSourceCount,spread_pp:d.spreadPp,
        sharp_data_quality:d.sharpDataQuality,source_age_gap_minutes:d.sourceAgeGapMinutes,
        outlier_source:d.outlierSource,outlier_distance_pp:d.outlierDistancePp,
        movement_direction:d.movementDirection,movement_source_count:d.movementSourceCount,
        movement_magnitude:d.movementMagnitude,movement_window_minutes:d.movementWindowMinutes,
        source_diagnostics:d.sourceDiagnostics,movement_diagnostics:d.movementDiagnostics,
        shadow_only:true,affects_decision:false
      });
    }
    if(rows.length){
      const {error}=await supabase.from("sharp_disagreement_shadow").upsert(rows,{onConflict:"sharp_gate_id"});
      if(error) throw error;
    }

    const counts:Record<string,number>={};
    for(const r of rows) counts[r.classification]=(counts[r.classification]||0)+1;
    return new Response(JSON.stringify({
      ok:true,version:"sharp-disagreement-v1",shadowOnly:true,affectsDecision:false,
      evaluated:rows.length,classificationCounts:counts
    }),{headers:{"content-type":"application/json"}});
  }catch(error){
    return new Response(JSON.stringify({
      ok:false,error:error instanceof Error?error.message:JSON.stringify(error)
    }),{status:500,headers:{"content-type":"application/json"}});
  }
});