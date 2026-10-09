import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {MLB_TABLES,importHistoryPage,serviceAuthorized} from '../_shared/performance-mlb-adapter.mjs';

// One atomic 500-row page per call. Reinvoke until complete; a failed page never advances its cursor.
Deno.serve(async req=>{
  const headers={'content-type':'application/json','cache-control':'no-store'};
  if(req.method!=='POST') return new Response(JSON.stringify({error:'POST only'}),{status:405,headers});
  if(!serviceAuthorized(req.headers.get('authorization'),Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))) return new Response(JSON.stringify({error:'Service authentication required'}),{status:401,headers});
  try {
    const body=await req.json();
    if(!MLB_TABLES.includes(body.table)) throw Error('Unsupported source table');
    const dryRun=body.dryRun !== false;
    if(!dryRun && Deno.env.get('PERFORMANCE_MLB_IMPORT_ENABLED')!=='true') return new Response(JSON.stringify({error:'History import disabled'}),{status:503,headers});
    const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data:checkpoint,error:checkpointError}=await client.from('performance_import_cursors').select('*').eq('source_table',body.table).maybeSingle();
    if(checkpointError) throw checkpointError;
    if(!dryRun && checkpoint?.complete) return new Response(JSON.stringify({table:body.table,complete:true,importedCount:checkpoint.imported_count,nextCursor:checkpoint.last_id,count:0}),{headers});
    const cursor=dryRun ? Number(body.cursor ?? checkpoint?.last_id ?? 0) : Number(checkpoint?.last_id ?? 0);
    const predictions:any[]=[];
    const report=await importHistoryPage({table:body.table,cursor,dryRun,fetchPage:async(table:string,last:number,size:number)=>{
      const {data,error}=await client.from(table).select('*').gt('id',last).order('id',{ascending:true}).limit(size);
      if(error) throw error;
      return data;
    },write:async(prediction:any)=>{predictions.push(prediction);}});
    let durable=null;
    if(!dryRun) {
      const {data,error}=await client.rpc('import_mlb_performance_page_v1',{payload:{...report,predictions}});
      if(error) throw error;
      durable=data;
    }
    return new Response(JSON.stringify({...report,durable,legacyReconstructed:true}),{headers});
  }catch(error: any){return new Response(JSON.stringify({error:error.message??String(error),complete:false}),{status:500,headers});}
});
