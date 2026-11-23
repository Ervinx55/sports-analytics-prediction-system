import {explainCoverage} from '../_shared/performance-coverage.mjs';
import {readHistoricalResults} from '../_shared/historical-results-read.mjs';
import postgres from 'npm:postgres@3.4.9';
import {performanceDatabaseClient} from '../_shared/performance-database-read.mjs';
import {parsePerformanceFilters} from '../_shared/performance-metrics.mjs';
import {readPerformance} from '../_shared/performance-read.mjs';
Deno.serve(async req=>{
 const headers={'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='GET')return respond({error:'GET only'},405);
 const input=Object.fromEntries(new URL(req.url).searchParams);
 try{parsePerformanceFilters(input);}catch{return respond({error:'INVALID_PERFORMANCE_FILTERS'},400);}
 const url=Deno.env.get('SUPABASE_DB_URL');
 if(!url)return respond({error:'PERFORMANCE_READ_UNAVAILABLE'},503);
 const sql=postgres(url,{max:1,prepare:false,connect_timeout:3,idle_timeout:1});
 try{
  const result=await readPerformance(performanceDatabaseClient(sql),input);
  if(!input.sport||input.sport==='MLB'){
   try{result.history=await readHistoricalResults(sql,{sport:'MLB',limit:50});result.historyStatus='AVAILABLE';}
   catch{result.historyStatus='UNAVAILABLE';}
  }
  return respond(explainCoverage(result));
 }
 catch(error){if(error instanceof Error&&error.message==='PERFORMANCE_READ_LIMIT_EXCEEDED')return respond({error:error.message,message:'Narrow the date interval or sport filter; limit applies to 10000 raw saved observations before cohort selection.'},422);console.error('PERFORMANCE_DATABASE_READ_FAILED',{code:typeof error?.code==='string'&&/^[A-Z0-9_]{1,30}$/.test(error.code)?error.code:'UNKNOWN'});return respond({error:'PERFORMANCE_READ_UNAVAILABLE'},503);}
 finally{await sql.end({timeout:1}).catch(()=>{});}
});
