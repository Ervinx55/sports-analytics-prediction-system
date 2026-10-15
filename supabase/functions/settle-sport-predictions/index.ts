import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {serviceAuthorized} from '../_shared/performance-mlb-adapter.mjs';
import {runSettlementPage,SETTLEMENT_SPORTS} from '../_shared/performance-worker.mjs';
Deno.serve(async req=>{
 const headers={'content-type':'application/json','cache-control':'no-store'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return respond({error:'POST only'},405);
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!serviceAuthorized(req.headers.get('authorization'),key))return respond({error:'Service authentication required'},401);
 let body;try{body=await req.json();}catch{return respond({error:'Invalid JSON'},400);}
 const sport=body?.sport,limit=body?.limit??100;
 if(!SETTLEMENT_SPORTS.includes(sport)||!Number.isSafeInteger(limit)||limit<1||limit>100)return respond({error:'Invalid sport or limit'},400);
 if(Deno.env.get('PERFORMANCE_SETTLEMENT_ENABLED')!=='true')return respond({ok:false,error:'Settlement disabled',coverage:{sport,complete:false,state:'DISABLED'}},503);
 try{const result=await runSettlementPage(createClient(Deno.env.get('SUPABASE_URL')!,key!),{sport,limit});return respond({ok:result.faults.length===0&&result.retries===0,...result},result.faults.length||result.retries?502:200);}
 catch{return respond({ok:false,error:'SETTLEMENT_FAILED',coverage:{sport,complete:false,state:'ERROR'}},500);}
});
