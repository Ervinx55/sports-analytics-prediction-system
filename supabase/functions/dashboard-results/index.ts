import postgres from 'npm:postgres@3.4.9';
import {parseHistoricalFilters,readHistoricalResults} from '../_shared/historical-results-read.mjs';
Deno.serve(async req=>{
 const headers={'content-type':'application/json','cache-control':'no-store'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='GET')return respond({error:'GET only'},405);
 const input=Object.fromEntries(new URL(req.url).searchParams);
 try{parseHistoricalFilters(input);}catch{return respond({error:'INVALID_HISTORY_FILTERS'},400);}
 const url=Deno.env.get('SUPABASE_DB_URL');
 if(!url)return respond({error:'HISTORY_READ_UNAVAILABLE'},503);
 const sql=postgres(url,{max:1,prepare:false,connect_timeout:3,idle_timeout:1});
 try{return respond(await readHistoricalResults(sql,input));}
 catch(error){console.error('HISTORY_READ_FAILED',{code:typeof error?.code==='string'&&/^[A-Z0-9_]{1,30}$/.test(error.code)?error.code:'UNKNOWN'});return respond({error:'HISTORY_READ_UNAVAILABLE'},503);}
 finally{await sql.end({timeout:1}).catch(()=>{});}
});
