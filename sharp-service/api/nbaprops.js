import {enrichQuoteExplanations,explanationSnapshot} from '../lib/nba-explanation-snapshot.js';
import {protectedSportsGameOddsFetch} from '../lib/provider-protection.js';
import {directSgoProps} from '../lib/nba-direct-props.js';
export async function propsResponse({now=null,key=process.env.SPORTS_ODDS_API_KEY||process.env.Sports_Game_Odds_API||'',fetchPage=protectedSportsGameOddsFetch}={}){
 const unavailable=()=>({status:503,body:{status:'UNAVAILABLE',reason:'NBA_QUOTE_PROVIDER_UNAVAILABLE',events:[],productionEligible:false,productionWeight:0}});
 if(!key)return unavailable();
 try{
  let cache;
  const body=await directSgoProps({clock:()=>new Date(now??Date.now()).toISOString(),page:async params=>{
   const bucket=Math.floor((now??Date.now())/3600000)*3600000;
   params={...params,startsAfter:new Date(bucket).toISOString(),startsBefore:new Date(bucket+48*3600000).toISOString()};
   const result=await fetchPage({url:'https://api.sportsgameodds.com/v2/events?'+new URLSearchParams(params),apiKey:key,consumer:'nba-prospective-quotes',priority:'critical',freshMs:60000,staleMs:600000,timeoutMs:8000});
   const checkedAt=now??Date.now();
   if(result.payload?.success!==true||!Array.isArray(result.payload.data)||result.payload.data.length>8||!Number.isFinite(result.fetchedAt)||result.fetchedAt>checkedAt||checkedAt-result.fetchedAt>600000)throw Error('Invalid or stale quote feed');
   cache={status:result.cacheStatus,fetchedAt:new Date(result.fetchedAt).toISOString()};
   return {events:result.payload.data,observedAt:cache.fetchedAt};
  }});
  return {status:200,body:{...body,source:'SportsGameOdds',scope:'NBA DraftKings points/rebounds/assists; first eight events within 48 hours',cache,productionEligible:false,productionWeight:0}};
 }catch{return unavailable();}
}
export default async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'GET required'});}
 const explanation=explanationSnapshot();const {status,body}=await propsResponse();const ttl=status===200?Math.max(0,Math.min(30,Math.floor((600000-(Date.now()-Date.parse(body.generatedAt)))/1000))):0;const enriched=status===200?await enrichQuoteExplanations(body,explanation):body;const rows=(enriched.events||[]).flatMap(e=>e.players||[]);const healthy=rows.length>0&&rows.every(p=>p.context?.evidenceRead?.status==='fresh');res.setHeader('Cache-Control',ttl>0&&healthy?`public, max-age=0, s-maxage=${ttl}`:'no-store');return res.status(status).json(enriched);
}


