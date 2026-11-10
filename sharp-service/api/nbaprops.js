import {protectedSportsGameOddsFetch} from '../lib/provider-protection.js';
import {directSgoProps} from '../lib/nba-direct-props.js';
export async function propsResponse({now=null,key=process.env.SPORTS_ODDS_API_KEY||process.env.Sports_Game_Odds_API||'',fetchPage=protectedSportsGameOddsFetch}={}){
 const unavailable=()=>({status:503,body:{status:'UNAVAILABLE',reason:'NBA_QUOTE_PROVIDER_UNAVAILABLE',events:[],productionEligible:false,productionWeight:0}});
 if(!key)return unavailable();
 try{
  let cache;
  const body=await directSgoProps({clock:()=>new Date(now??Date.now()).toISOString(),page:async params=>{
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
 const {status,body}=await propsResponse();res.setHeader('Cache-Control',status===200?'public, max-age=0, s-maxage=30':'no-store');return res.status(status).json(body);
}
