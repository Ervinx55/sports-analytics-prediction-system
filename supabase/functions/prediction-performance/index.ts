import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {parsePerformanceFilters} from '../_shared/performance-metrics.mjs';
import {readPerformance} from '../_shared/performance-read.mjs';
Deno.serve(async req=>{
 const headers={'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='GET')return respond({error:'GET only'},405);
 const input=Object.fromEntries(new URL(req.url).searchParams);
 try{parsePerformanceFilters(input);}catch{return respond({error:'INVALID_PERFORMANCE_FILTERS'},400);}
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),url=Deno.env.get('SUPABASE_URL');
 if(!key||!url)return respond({error:'PERFORMANCE_READ_UNAVAILABLE'},503);
 try{return respond(await readPerformance(createClient(url,key,{global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})}}),input));}
 catch(error){if(error instanceof Error&&error.message==='PERFORMANCE_READ_LIMIT_EXCEEDED')return respond({error:error.message,message:'Narrow the date interval or sport filter; limit applies to 10000 raw saved observations before cohort selection.'},422);return respond({error:'PERFORMANCE_READ_UNAVAILABLE'},503);}
});
