import {capturePropFeed} from './prop-capture-core.mjs';
import {propOutcome} from './prop-settlement.mjs';
import {fetchResultResponse} from '../../supabase/functions/_shared/performance-worker.mjs';
export async function propTick(db,{url,fetchImpl=fetch,clock=()=>new Date().toISOString(),cooldowns={},matchedCollector=null}){
 const report={at:clock(),captured:0,settled:0,faults:[],cooldowns};
 const get=async(url,provider)=>{
  if((cooldowns[provider]??0)>Date.parse(clock()))return {ok:false,error:'PROVIDER_COOLDOWN'};
  const r=await fetchResultResponse(url,{fetchImpl});
  if(provider==='espn'&&r.error==='PROVIDER_HTTP_403')r.cooldownSeconds=Math.max(r.cooldownSeconds??0,3600);
  if(r.cooldownSeconds>0)cooldowns[provider]=Date.parse(clock())+r.cooldownSeconds*1000;
  if(!r.ok)report.faults.push(provider+':'+r.error);return r;
 };
 const feed=await get(url,'props');
 if(feed.ok){try{report.capture=capturePropFeed(db,feed.body,clock());report.captured=report.capture.inserted;}catch{report.faults.push('INVALID_PROP_FEED');}}
 if(feed.ok&&matchedCollector){try{report.matched=await matchedCollector(feed.body,db,{get,clock});}catch{report.faults.push('MATCHED_CAPTURE_FAILED');}}
 const now=Date.parse(clock()),pending=db.pending().filter(p=>Date.parse(p.startsAt)<now&&Date.parse(p.startsAt)>now-30*86400000).slice(0,500);
 const dates=[...new Set(pending.flatMap(p=>[0,-86400000].map(offset=>new Date(Date.parse(p.startsAt)+offset).toISOString().slice(0,10).replaceAll('-',''))))].sort().slice(0,4);
 const events=new Map();
 for(const date of dates){const r=await get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates='+date,'espn');if(!r.ok)continue;
  if(!Array.isArray(r.body.events)||r.body.events.length>100){report.faults.push('INVALID_SCOREBOARD');continue;}
  for(const e of r.body.events){if(events.has(e.id)&&JSON.stringify(events.get(e.id))!==JSON.stringify(e))events.set(e.id,null);else if(!events.has(e.id))events.set(e.id,e);}
 }
 const summaries=new Map();
 for(const row of pending){
  const team=String(row.context?.teamId??''),opp=String(row.context?.opponentTeamId??'');
  const matched=[...events.values()].filter(e=>{const c=e?.competitions?.[0];return e?.competitions?.length===1&&c?.status?.type?.completed===true&&Math.abs(Date.parse(c.date)-Date.parse(row.startsAt))<=900000&&c.competitors?.length===2&&new Set(c.competitors.map(t=>String(t.id))).size===2&&team&&opp&&team!==opp&&c.competitors.every(t=>[team,opp].includes(String(t.id)));});
  if(matched.length!==1)continue;const id=String(matched[0].id);if(!/^\d+$/.test(id))continue;
  if(!summaries.has(id)){if(summaries.size>=8){report.faults.push('SUMMARY_BUDGET');break;}summaries.set(id,await get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+id,'espn'));}
  const response=summaries.get(id);if(!response.ok)continue;const outcome=propOutcome(row,response.body,id,clock(),matched[0]);if(outcome)report.settled+=db.settle(outcome);
 }
 report.unresolved=db.pending().length;report.observations=db.rows().length;report.outcomes=db.outcomes().length;report.faults=[...new Set(report.faults)];return report;
}
