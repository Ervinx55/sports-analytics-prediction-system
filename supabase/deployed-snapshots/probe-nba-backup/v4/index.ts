Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({error:'POST required'},{status:405});
 let role='';try{role=JSON.parse(atob((req.headers.get('authorization')??'').replace(/^Bearer /,'').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role;}catch{}
 if(role!=='service_role')return Response.json({error:'Service authentication required'},{status:401});
 const key=Deno.env.get('BALLDONTLIE_API_KEY');if(!key)return Response.json({error:'BALLDONTLIE_KEY_NOT_CONFIGURED'},{status:503});
 let input;try{input=await req.json();}catch{return Response.json({error:'Invalid input'},{status:400});}
 const dates=input.dates??[],ids=input.eventIDs??[];
 if(!Array.isArray(dates)||dates.length>3||dates.some(d=>!/^2026-(10-(2[0-9]|3[01])|11-0[1-8])$/.test(d))||!Array.isArray(ids)||ids.length>20||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9]{15,30}$/.test(id)))return Response.json({error:'Invalid scope'},{status:400});
 const results=[];
 for(const date of dates){
  if(results.length)await new Promise(r=>setTimeout(r,15000));
  const url='https://api.balldontlie.io/v1/box_scores?date='+date;
  try{
   const r=await fetch(url,{headers:{Authorization:key,accept:'application/json'},signal:AbortSignal.timeout(15000),redirect:'error'});
   if(!r.ok){results.push({date,status:r.status,retryAfter:r.headers.get('retry-after')});break;}
   const body=await r.text();if(body.length>4000000)throw Error('RESPONSE_TOO_LARGE');
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
   results.push({date,status:r.status,url,retrievedAt:new Date().toISOString(),sha256:Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join(''),body:JSON.parse(body)});
  }catch{results.push({date,error:'BACKUP_FETCH_FAILED'});break;}
 }
 let sgo=null;
 if(ids.length){
  const sk=Deno.env.get('SPORTS_ODDS_API_KEY')||Deno.env.get('Sports_Game_Odds_API');
  if(sk)try{
   const url='https://api.sportsgameodds.com/v2/events?'+new URLSearchParams({leagueID:'NBA',eventIDs:ids.join(','),expandResults:'true',oddID:'points-home-game-ml-home',limit:'20'});
   const r=await fetch(url,{headers:{'x-api-key':sk},signal:AbortSignal.timeout(15000),redirect:'error'});
   if(r.ok){const body=await r.json();sgo={status:r.status,retrievedAt:new Date().toISOString(),body};}else sgo={status:r.status};
  }catch{sgo={error:'SGO_FETCH_FAILED'};}
 }
 return Response.json({researchOnly:true,results,sgo});
});