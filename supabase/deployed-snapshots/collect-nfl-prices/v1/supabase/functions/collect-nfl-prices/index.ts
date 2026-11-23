import {createRestPriceStore,runNflPriceCollector} from '../../../scripts/nfl/hosted-price-collector.mjs';

// Supabase gateway signature verification MUST remain enabled (verify_jwt=true).
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({error:'POST required'},{status:405});
 const authorization=req.headers.get('authorization')??'';
 let role='';try{role=JSON.parse(atob(authorization.replace(/^Bearer /,'').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role;}catch{}
 if(role!=='service_role')return Response.json({error:'Service authentication required'},{status:401});
 try{
  const store=createRestPriceStore({url:Deno.env.get('SUPABASE_URL'),authorization});
  const report=await runNflPriceCollector({store});
  return Response.json(report,{status:report.ok?200:503,headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({ok:false,error:'NFL_COLLECTION_UNAVAILABLE',productionEligible:false,productionWeight:0},{status:503,headers:{'Cache-Control':'no-store'}});}
});
