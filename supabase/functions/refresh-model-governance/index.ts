import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EPS=1e-9;
function n(v:any):number|null{
  if(v===null||v===undefined||v==="") return null;
  const x=Number(v); return Number.isFinite(x)?x:null;
}
function clipped(p:number){return Math.max(EPS,Math.min(1-EPS,p));}
function summarize(rows:any[], prediction:(r:any)=>number|null, clv:(r:any)=>number|null){
  const allPred=rows.map(prediction).filter((x):x is number=>x!==null&&x>=0&&x<=1);
  const resolved=rows.map(r=>({r,p:prediction(r)})).filter(x=>
    x.p!==null && x.p!>=0 && x.p!<=1 && ["W","L"].includes(String(x.r.outcome))
  );
  const pushes=rows.filter(r=>r.outcome==="PUSH").length;
  const wins=resolved.filter(x=>x.r.outcome==="W").length;
  const losses=resolved.filter(x=>x.r.outcome==="L").length;
  const brier=resolved.length
    ? resolved.reduce((s,x)=>{
        const y=x.r.outcome==="W"?1:0;
        return s+Math.pow(Number(x.p)-y,2);
      },0)/resolved.length
    : null;
  const logLoss=resolved.length
    ? -resolved.reduce((s,x)=>{
        const y=x.r.outcome==="W"?1:0,p=clipped(Number(x.p));
        return s+y*Math.log(p)+(1-y)*Math.log(1-p);
      },0)/resolved.length
    : null;
  const observed=wins+losses?wins/(wins+losses):null;
  const avgPred=resolved.length?resolved.reduce((s,x)=>s+Number(x.p),0)/resolved.length:null;
  const clvs=rows.map(clv).filter((x):x is number=>x!==null);
  return {
    observationCount:rows.length,
    gradedCount:resolved.length,
    closeCount:clvs.length,
    wins,losses,pushes,
    averagePrediction:avgPred,
    observedWinRate:observed,
    calibrationBiasPp:avgPred!==null&&observed!==null?(avgPred-observed)*100:null,
    brierScore:brier,
    logLoss,
    averageClvPp:clvs.length?clvs.reduce((a,b)=>a+b,0)/clvs.length:null,
    positiveClvRate:clvs.length?clvs.filter(x=>x>0).length/clvs.length:null
  };
}
function categories(rows:any[], field:string){
  return [...new Set(rows.map(r=>String(r[field]??"UNKNOWN")))];
}

Deno.serve(async(req)=>{
  try{
    if(req.method!=="POST"){
      return new Response(JSON.stringify({error:"POST only"}),{status:405,headers:{"content-type":"application/json"}});
    }
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const since=new Date(Date.now()-180*86400_000).toISOString();

    const [
      {data:registry,error:rge},
      {data:teamObs,error:toe},
      {data:teamRes,error:tre},
      {data:teamClv,error:tce},
      {data:uncertainty,error:ue},
      {data:propObs,error:poe},
      {data:propRes,error:pre},
      {data:propClv,error:pce}
    ]=await Promise.all([
      supabase.from("model_governance_registry").select("*").eq("active",true),
      supabase.from("market_grade_observations").select("id,captured_at,model_version,market_type,model_probability").gte("captured_at",since).limit(30000),
      supabase.from("team_market_results").select("observation_id,outcome").gte("graded_at",since).limit(30000),
      supabase.from("sharp_market_clv").select("observation_id,market_to_close_clv_pp").gte("captured_at",since).limit(30000),
      supabase.from("market_uncertainty_shadow").select("observation_id,conservative_probability").gte("source_captured_at",since).limit(30000),
      supabase.from("player_prop_observations").select("id,captured_at,model_version,stat_id,model_probability,raw_independent_probability").gte("captured_at",since).limit(50000),
      supabase.from("player_prop_results").select("observation_id,outcome").gte("graded_at",since).limit(50000),
      supabase.from("player_prop_clv").select("observation_id,finalized,fair_probability_clv_pp,same_book_price_clv_pp,clv_classification").gte("starts_at",since).limit(50000)
    ]);
    for(const e of [rge,toe,tre,tce,ue,poe,pre,pce]) if(e) throw e;

    const tr=new Map((teamRes??[]).map((x:any)=>[Number(x.observation_id),x.outcome]));
    const tc=new Map((teamClv??[]).map((x:any)=>[Number(x.observation_id),x]));
    const um=new Map((uncertainty??[]).map((x:any)=>[Number(x.observation_id),x]));
    const pr=new Map((propRes??[]).map((x:any)=>[Number(x.observation_id),x.outcome]));
    const pc=new Map((propClv??[]).map((x:any)=>[Number(x.observation_id),x]));

    const teamRows=(teamObs??[]).map((o:any)=>({
      ...o,
      outcome:tr.get(Number(o.id))??null,
      clv:n(tc.get(Number(o.id))?.market_to_close_clv_pp),
      conservative:n(um.get(Number(o.id))?.conservative_probability)
    }));
    const propRows=(propObs??[]).map((o:any)=>{
      const c=pc.get(Number(o.id));
      const propClv=n(c?.fair_probability_clv_pp)??n(c?.same_book_price_clv_pp);
      return {...o,outcome:pr.get(Number(o.id))??null,clv:propClv};
    });

    const rowsToInsert:any[]=[];
    const evaluated:any[]=[];

    for(const model of registry??[]){
      const family=String(model.model_family);
      let baseRows:any[]=[];
      let pred:(r:any)=>number|null;
      let categoryField="";

      if(family==="TEAM"){
        baseRows=teamRows.filter((r:any)=>r.model_version===model.model_version);
        pred=model.variant==="UNCERTAINTY_CONSERVATIVE"
          ? (r:any)=>n(r.conservative)
          : (r:any)=>n(r.model_probability);
        categoryField="market_type";
      }else{
        baseRows=propRows.filter((r:any)=>r.model_version===model.model_version);
        pred=model.variant==="RAW_INDEPENDENT"
          ? (r:any)=>n(r.raw_independent_probability)
          : (r:any)=>n(r.model_probability);
        categoryField="stat_id";
      }

      const scopes=[{scope:"OVERALL",category:"ALL",rows:baseRows}];
      for(const cat of categories(baseRows,categoryField)){
        scopes.push({scope:"CATEGORY",category:cat,rows:baseRows.filter((r:any)=>String(r[categoryField]??"UNKNOWN")===cat)});
      }

      for(const s of scopes){
        const metrics=summarize(s.rows,pred,(r:any)=>n(r.clv));
        evaluated.push({model,s,metrics,pred});
      }
    }

    const references=new Map<string,any>();
    for(const x of evaluated){
      if(x.model.role==="REFERENCE"){
        references.set(x.model.model_family+"|"+x.s.scope+"|"+x.s.category,x);
      }
    }

    for(const x of evaluated){
      const ref=references.get(x.model.model_family+"|"+x.s.scope+"|"+x.s.category)??null;
      const m=x.metrics;
      const minGraded=Number(x.model.minimum_graded_sample||100);
      const minClose=Number(x.model.minimum_close_sample||100);
      let governanceState="COLLECTING";
      if(x.model.role==="REFERENCE"){
        governanceState=m.gradedCount>=minGraded&&m.closeCount>=minClose
          ?"REFERENCE_STABLE_SAMPLE":"REFERENCE_COLLECTING";
      }else if(x.model.role==="DIAGNOSTIC"){
        governanceState=m.gradedCount>=minGraded
          ?"DIAGNOSTIC_EVALUABLE":"DIAGNOSTIC_COLLECTING";
      }else if(x.model.role==="CHALLENGER"){
        governanceState=m.gradedCount>=minGraded&&m.closeCount>=minClose
          ?"READY_FOR_HUMAN_REVIEW":"CHALLENGER_COLLECTING";
      }else{
        governanceState="LEGACY";
      }

      const deltaBrier=ref?.metrics?.brierScore!=null&&m.brierScore!=null?m.brierScore-ref.metrics.brierScore:null;
      const deltaLog=ref?.metrics?.logLoss!=null&&m.logLoss!=null?m.logLoss-ref.metrics.logLoss:null;
      const deltaCal=ref?.metrics?.calibrationBiasPp!=null&&m.calibrationBiasPp!=null
        ? Math.abs(m.calibrationBiasPp)-Math.abs(ref.metrics.calibrationBiasPp):null;

      rowsToInsert.push({
        evaluated_at:new Date().toISOString(),
        model_key:x.model.model_key,
        model_family:x.model.model_family,
        model_version:x.model.model_version,
        variant:x.model.variant,
        role:x.model.role,
        scope:x.s.scope,
        category:x.s.category,
        observation_count:m.observationCount,
        graded_count:m.gradedCount,
        close_count:m.closeCount,
        wins:m.wins,losses:m.losses,pushes:m.pushes,
        average_prediction:m.averagePrediction,
        observed_win_rate:m.observedWinRate,
        calibration_bias_pp:m.calibrationBiasPp,
        brier_score:m.brierScore,
        log_loss:m.logLoss,
        average_clv_pp:m.averageClvPp,
        positive_clv_rate:m.positiveClvRate,
        reference_model_key:ref?.model?.model_key??null,
        reference_brier_score:ref?.metrics?.brierScore??null,
        reference_log_loss:ref?.metrics?.logLoss??null,
        delta_brier:deltaBrier,
        delta_log_loss:deltaLog,
        delta_abs_calibration_pp:deltaCal,
        governance_state:governanceState,
        automatic_promotion:false,
        human_review_required:true,
        raw:{
          evaluatorVersion:"model-governance-v1",
          minimumGradedSample:minGraded,
          minimumCloseSample:minClose,
          eligibleForPromotion:Boolean(x.model.eligible_for_promotion),
          lowerBrierBetter:true,
          lowerLogLossBetter:true,
          lowerAbsoluteCalibrationBiasBetter:true
        }
      });
    }

    if(rowsToInsert.length){
      const {error}=await supabase.from("model_governance_evaluations").insert(rowsToInsert);
      if(error) throw error;
    }

    return new Response(JSON.stringify({
      ok:true,
      version:"model-governance-v1",
      automaticPromotion:false,
      evaluations:rowsToInsert.length,
      states:rowsToInsert.reduce((a:any,x:any)=>{a[x.governance_state]=(a[x.governance_state]||0)+1;return a;},{})
    }),{headers:{"content-type":"application/json"}});
  }catch(error){
    return new Response(JSON.stringify({ok:false,error:error instanceof Error?error.message:JSON.stringify(error)}),
      {status:500,headers:{"content-type":"application/json"}});
  }
});