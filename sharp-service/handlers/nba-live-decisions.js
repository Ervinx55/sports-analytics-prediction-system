import {enrichLiveExplanations,explanationSnapshot} from '../lib/nba-explanation-snapshot.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'GET required'});
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)return res.status(503).json({error:'NBA decision service unavailable',decisions:[]});
 const headers={'Content-Type':'application/json',apikey:key};if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;
 try{
  const explanation=explanationSnapshot();
  const response=await fetch((process.env.SUPABASE_URL||'https://yeoxroijaptomomshdii.supabase.co').replace(/\/$/,'')+'/rest/v1/rpc/read_nba_live_decisions_v1',{method:'POST',headers,body:'{}',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Unavailable');const body=await response.json();
  if(body.contract!=='nba-reviewed-live-v1'||!Array.isArray(body.decisions))throw Error('Invalid response');
  return res.status(200).json(await enrichLiveExplanations(body,explanation));
 }catch{return res.status(503).json({error:'NBA decision service unavailable',decisions:[]});}
}


