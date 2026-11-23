import minutesArtifact from '../../../docs/evaluations/nba-role-minutes-2026-11-10/candidate.json' with {type:'json'};
import minutesProtocol from '../../../docs/evaluations/nba-minutes-prospective-2026-11-10/protocol.json' with {type:'json'};
import bdlArchive from '../../../docs/evaluations/nba-bdl-2026-11-09/verified-archive.json' with {type:'json'};
import validationProtocol from '../../../docs/evaluations/nba-bilateral-2026-11-09/protocol.json' with {type:'json'};
import backupArchive from '../../../docs/evaluations/nba-backup-2026-11-09/archive-identities-v2.json' with {type:'json'};
import probabilityArtifact from '../../../docs/evaluations/nba-probability-2026-11-09/probability-model.json' with {type:'json'};
import {runHosted} from '../../../scripts/hosted/nba-worker.mjs';
import artifact from '../../../docs/evaluations/nba-defense-fit-2026-11-04/models.json' with {type:'json'};
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({error:'POST required'},{status:405});
 const authorization=req.headers.get('authorization')??'';
 let role='';try{role=JSON.parse(atob(authorization.replace(/^Bearer /,'').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role;}catch{}
 // Signature validation is mandatory at the Supabase gateway (verify_jwt=true).
 if(role!=='service_role')return Response.json({error:'Service authentication required'},{status:401});
 const key=authorization.replace(/^Bearer /,'');
 const rpc=async(name,args)=>{
  const response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/'+name,{method:'POST',headers:{'content-type':'application/json',apikey:key,authorization},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('DATABASE_HTTP_'+response.status);
  return response.json();
 };
 try{return Response.json(await runHosted({rpc,artifact,probabilityArtifact,backupArchive,bdlArchive,validationProtocol,minutesArtifact,minutesProtocol,bdlKey:Deno.env.get('BALLDONTLIE_API_KEY')||null,sgoKey:Deno.env.get('SPORTS_ODDS_API_KEY')||Deno.env.get('Sports_Game_Odds_API')||null}));}
 catch(e){console.error('collector-failure',e.name,String(e.stack??'').split('\n').slice(1,4).join('\n'));return Response.json({ok:false,error:/^DATABASE_HTTP_\d+$/.test(e.message)?e.message:'HOSTED_COLLECTION_FAILED'},{status:503});}
});
