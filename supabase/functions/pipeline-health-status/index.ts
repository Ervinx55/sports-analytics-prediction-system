import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEGRADED = new Set([
  "MISSING_JOB","CRON_DISABLED","NEVER_RAN","CRON_FAILED","CRON_STALE",
  "HTTP_NOT_OBSERVED","HTTP_NO_RESPONSE","HTTP_FAILED","HTTP_STALE"
]);

Deno.serve(async(req)=>{
  try{
    if(req.method!=="GET"){
      return new Response(JSON.stringify({error:"GET only"}),{
        status:405,headers:{"content-type":"application/json"}
      });
    }

    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {data,error}=await supabase
      .from("pipeline_component_health_v1")
      .select("*")
      .order("critical",{ascending:false})
      .order("subsystem",{ascending:true})
      .order("display_name",{ascending:true});
    if(error) throw error;

    const rows=data??[];
    const critical=rows.filter((x:any)=>x.critical);
    const criticalDegraded=critical.filter((x:any)=>DEGRADED.has(String(x.health_status)));
    const warming=rows.filter((x:any)=>["WARMING_UP","HTTP_PENDING"].includes(String(x.health_status)));
    const degraded=rows.filter((x:any)=>DEGRADED.has(String(x.health_status)));
    const healthy=rows.filter((x:any)=>x.health_status==="HEALTHY");

    const overallStatus=criticalDegraded.length
      ? "DEGRADED"
      : warming.some((x:any)=>x.critical)
        ? "WARMING_UP"
        : "HEALTHY";

    return new Response(JSON.stringify({
      fetchedAt:new Date().toISOString(),
      version:"pipeline-health-v1",
      overallStatus,
      summary:{
        components:rows.length,
        healthy:healthy.length,
        warming:warming.length,
        degraded:degraded.length,
        criticalComponents:critical.length,
        criticalDegraded:criticalDegraded.length
      },
      components:rows,
      criticalIssues:criticalDegraded.map((x:any)=>({
        componentKey:x.component_key,
        displayName:x.display_name,
        status:x.health_status,
        reason:x.health_reason,
        cronAgeMinutes:x.cron_age_minutes,
        httpStatusCode:x.http_status_code,
        httpError:x.http_error_msg
      })),
      interpretation:{
        HEALTHY:"Cron and downstream runner are both within the configured freshness SLO.",
        WARMING_UP:"Instrumentation is newly attached or the latest HTTP request is still pending.",
        DEGRADED:"At least one critical component is missing, stale, disabled, or has a failed downstream HTTP response."
      }
    }),{
      headers:{
        "content-type":"application/json",
        "cache-control":"public, max-age=20"
      }
    });
  }catch(error){
    return new Response(JSON.stringify({
      error:error instanceof Error?error.message:JSON.stringify(error)
    }),{
      status:500,
      headers:{"content-type":"application/json"}
    });
  }
});