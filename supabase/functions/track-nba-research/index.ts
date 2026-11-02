import postgres from 'npm:postgres@3.4.9';
import {nbaResearchRepository,runNbaResearch} from '../_shared/nba-research-tracking.mjs';
Deno.serve(async req=>{
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 if(req.method!=='POST')return reply({error:'POST only'},405);
 if(!req.headers.get('authorization')?.startsWith('Bearer '))return reply({error:'Service authentication required'},401);
 const url=Deno.env.get('SUPABASE_DB_URL');if(!url)return reply({error:'DATABASE_UNAVAILABLE'},503);
 const sql=postgres(url,{max:1,prepare:false,connect_timeout:3,idle_timeout:1});
 try{
  const repo=nbaResearchRepository(sql);
  if(!await repo.authorized(req.headers.get('authorization')))return reply({error:'Service authentication required'},401);
  if(!await repo.enabled())return reply({error:'TRACKING_DISABLED'},503);
  const result=await runNbaResearch(repo);return reply(result,result.ok?200:502);
 }catch{return reply({error:'NBA_RESEARCH_TRACKING_FAILED'},503);}
 finally{await sql.end({timeout:1}).catch(()=>{});}
});
