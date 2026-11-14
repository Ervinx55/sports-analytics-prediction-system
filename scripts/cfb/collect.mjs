// Read-only, resumable ESPN season evidence collector. No sportsbook credentials required.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseMembership,validateSchedule,assembleHistory} from '../../sharp-service/lib/cfb-sources.js';
const out=process.argv[2];if(!out)throw Error('Supply evidence output directory');await fs.mkdir(out,{recursive:true});
const get=async(url,file)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{}
 const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('SOURCE_HTTP_'+response.status);const payload=await response.json();await fs.writeFile(file,JSON.stringify(payload));return payload;
};
const membership={},schedules=[],failures=[];
for(const season of [2024,2025,2026]){
 const payload=await get(`https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/types/2/groups/80/teams?limit=1000`,path.join(out,`membership-${season}.json`));
 membership[season]=parseMembership(payload,season);let index=0;
 await Promise.all(Array.from({length:4},async()=>{while(index<membership[season].length){const id=membership[season][index++];try{
  const payload=await get(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${id}/schedule?season=${season}`,path.join(out,`schedule-${season}-${id}.json`));
  const regular=validateSchedule(payload,id,season,new Date().toISOString());
  if(season<2026){
   const post=await get(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${id}/schedule?season=${season}&seasontype=3`,path.join(out,`postseason-${season}-${id}.json`));
   const explicitEmpty=post.status==='success'&&String(post.team?.id)===id&&Array.isArray(post.events)&&post.events.length===0;
   if(!explicitEmpty&&(post.requestedSeason?.year!==season||post.requestedSeason?.type!==3))throw Error('POSTSEASON_COVERAGE_UNVERIFIED');
   const parsed=validateSchedule(post,id,season,new Date().toISOString());
   regular.games.push(...parsed.games);regular.postseasonComplete=true;
  }else regular.postseasonComplete=false;
  schedules.push(regular);
 }catch(e){failures.push({season,teamID:id,error:e.message});}await new Promise(r=>setTimeout(r,120));}}));
 process.stdout.write(JSON.stringify({season,teams:membership[season].length,validSchedules:schedules.filter(s=>s.season===season).length,failures:failures.filter(s=>s.season===season).length})+'\n');
}
const assembled=assembleHistory(schedules,membership),result={fetchedAt:new Date().toISOString(),membership,schedules,...assembled,failures};
await fs.writeFile(path.join(out,'history.json'),JSON.stringify(result));
process.stdout.write(JSON.stringify({complete:assembled.complete,games:assembled.games.length,conflicts:assembled.conflicts.length,missing:assembled.missing.length,failures:failures.slice(0,8)})+'\n');
