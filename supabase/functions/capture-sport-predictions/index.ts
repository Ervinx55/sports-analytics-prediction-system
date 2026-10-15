import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {adaptModelResponse,fetchModelResponse} from '../_shared/performance-model-adapters.mjs';
import {MLB_TABLES,serviceAuthorized} from '../_shared/performance-mlb-adapter.mjs';

Deno.serve(async req=>{
 const headers={'content-type':'application/json','cache-control':'no-store'};
 const respond=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return respond({error:'POST only'},405);
 const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!serviceAuthorized(req.headers.get('authorization'),secret))return respond({error:'Service authentication required'},401);
 let body:any;
 try{body=await req.json();}catch{return respond({error:'Invalid JSON'},400);}
 const {sport,kind,requestId}=body??{};
 if(!['MLB','NFL','NBA','CFB','NHL','TENNIS','SOCCER'].includes(sport)||typeof requestId!=='string'||! /^[A-Za-z0-9:_-]{1,128}$/.test(requestId)||!(sport==='MLB'?MLB_TABLES.includes(kind):['team','props'].includes(kind)))return respond({error:'Invalid sport, kind or requestId'},400);
 const capturedAt=new Date().toISOString();
 if(['NBA','CFB','NHL','TENNIS','SOCCER'].includes(sport))return respond({ok:true,captured:0,rejected:0,...adaptModelResponse({}, {sport,kind,capturedAt,sourceRequestId:requestId})});
 if(Deno.env.get('PERFORMANCE_SPORT_CAPTURE_ENABLED')!=='true')return respond({error:'Sport capture disabled',coverage:{sport,modelAvailable:sport==='NFL'||sport==='MLB',complete:false,state:'DISABLED'}},503);
 try {
  const client=createClient(Deno.env.get('SUPABASE_URL')!,secret!);
  let source:any,nextCursor=null;
  if(sport==='MLB') {
   const cursor=body.cursor??0;
   if(!Number.isSafeInteger(cursor)||cursor<0)return respond({error:'Invalid cursor'},400);
   const {data,error}=await client.from(kind).select('*').gt('id',cursor).order('id',{ascending:true}).limit(500);
   if(error||!Array.isArray(data)||data.length>500)return respond({ok:false,error:'OBSERVATION_PAGE_UNAVAILABLE',coverage:{sport,complete:false,state:'ERROR'}},502);
   let last=cursor;
   for(const row of data){if(!Number.isSafeInteger(Number(row.id))||Number(row.id)<=last)return respond({ok:false,error:'INVALID_OBSERVATION_PAGE',coverage:{sport,complete:false,state:'ERROR'}},502);last=Number(row.id);}
   source={rows:data,complete:data.length<500};nextCursor=last;
  }else {
   const base=Deno.env.get('PERFORMANCE_MODEL_BASE_URL');
   if(!base)return respond({ok:false,error:'MODEL_SOURCE_NOT_CONFIGURED',coverage:{sport,modelAvailable:true,dataAvailable:false,complete:false,state:'UNAVAILABLE'}},503);
   const url=new URL(kind==='props'?'/api/nflprops':'/api/nflmodel',base);
   if(url.protocol!=='https:')return respond({ok:false,error:'INVALID_MODEL_SOURCE_CONFIG',coverage:{sport,complete:false,state:'ERROR'}},503);
   const fetched=await fetchModelResponse(url.href);
   if(!fetched.ok)return respond({ok:false,error:fetched.error,attempts:fetched.attempts,coverage:{sport,modelAvailable:true,dataAvailable:false,complete:false,state:'ERROR'}},502);
   source=fetched.body;
  }
  const adapted=adaptModelResponse(source,{sport,kind,capturedAt:new Date().toISOString(),sourceRequestId:requestId});
  const faults:any[]=[],reasons:Record<string,number>={};let captured=0,excluded=0;
  const scheduledAt=Date.now();
  const predictions=body.scheduled===true?adapted.predictions.filter(p=>{const start=Date.parse(p.startsAt??'');return start>scheduledAt&&start<=scheduledAt+6*3600000;}):adapted.predictions;
  for(const prediction of predictions) {
   let savedReasons=prediction.eligibilityReasons;
   try{
    const {data,error}=await client.rpc(sport==='NFL'?'ingest_sport_prediction_v1':'ingest_prediction_v1',{payload:prediction});if(error)throw error;
    if(sport==='NFL'){
     if(typeof data?.id!=='string'||!Array.isArray(data.eligibilityReasons))throw Error('Invalid receipt response');
     savedReasons=[...new Set([...savedReasons,...data.eligibilityReasons])];
    }
    captured++;
   }
   catch{faults.push({sourceKey:prediction.sourceKey,reason:'LEDGER_WRITE_FAILED'});}
   for(const reason of savedReasons)reasons[reason]=(reasons[reason]??0)+1;
   if(savedReasons.length)excluded++;
  }
  if(sport==='MLB'&&(faults.length||adapted.diagnostics.length))nextCursor=body.cursor??0;
  return respond({ok:faults.length===0&&adapted.coverage.complete,captured,rejected:adapted.coverage.received-adapted.predictions.length,excluded,skippedOutsideWindow:adapted.predictions.length-predictions.length,reasons,diagnostics:adapted.diagnostics,faults,nextCursor,coverage:{...adapted.coverage,complete:adapted.coverage.complete&&faults.length===0}});
 }catch{return respond({ok:false,error:'CAPTURE_FAILED',coverage:{sport,complete:false,state:'ERROR'}},500);}
});
