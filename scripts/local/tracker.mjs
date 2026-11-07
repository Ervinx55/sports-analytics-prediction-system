import {mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync,appendFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {offlineReport,liveReport} from './report.mjs';
import {openLocalLedger} from './nba-ledger.mjs';
import {runNbaResearch} from '../../supabase/functions/_shared/nba-research-tracking.mjs';
import {fetchResultResponse} from '../../supabase/functions/_shared/performance-worker.mjs';
const args=process.argv.slice(2),value=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),dir=resolve(value('--data-dir',resolve(root,'local-data')));
mkdirSync(dir,{recursive:true});const repo=openLocalLedger(resolve(dir,'nba-research.sqlite'));
if(args.includes('--archive'))console.log(JSON.stringify({imported:repo.importArchive(JSON.parse(readFileSync(resolve(value('--archive')),'utf8')))}));
repo.scoreboard=async date=>{
 if(!/^\d{8}$/.test(date))throw Error('Invalid date');
 const cached=repo.state('scoreboard:'+date);if(cached&&Date.now()-cached.at<15*60000)return {ok:true,body:cached.body};
 const r=await fetchResultResponse('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates='+date);
 if(!r.ok)return r;
 if(!Array.isArray(r.body.events)||r.body.events.length>100)return {ok:false,error:'INVALID_SCOREBOARD'};
 const body={events:r.body.events.map(e=>({id:e.id,uid:e.uid,competitions:e.competitions?.map(c=>({id:c.id,date:c.date,status:c.status,competitors:c.competitors?.map(t=>({id:t.id,homeAway:t.homeAway,score:t.score,team:{id:t.team?.id,displayName:t.team?.displayName}}))}))}))};
 repo.set('scoreboard:'+date,{at:Date.now(),body});return {ok:true,body};
};
let running=false,stopping=false,timer,server;
// The observed model server clock leads this computer by about one second.
// Allow a real two-second handoff; never alter source timestamps or freshness gates.
const localFetch=async(url,options)=>{const response=await fetch(url,options);if(String(url).endsWith('/api/nbamodel'))await new Promise(resolve=>setTimeout(resolve,2000));return response;};
const saveReport=()=>{const report={...repo.report(),process:{pid:process.pid,running,stopping,pollMinutes:15,nextRunAt:args.includes('--watch')&&!stopping?new Date(Date.now()+15*60000).toISOString():null}};writeFileSync(resolve(dir,'report.json'),JSON.stringify(report,null,2));writeFileSync(resolve(dir,'report.html'),offlineReport(readFileSync(resolve(root,'scripts/local/tracker.html'),'utf8'),report));};
const tick=async()=>{
 if(running||stopping)return;running=true;const startedAt=new Date().toISOString();
 try{repo.set('lastRun',{startedAt,state:'RUNNING'});const result=await runNbaResearch(repo,{fetchImpl:localFetch});const run={startedAt,finishedAt:new Date().toISOString(),state:result.ok?'COMPLETE':'PARTIAL',...result};repo.set('lastRun',run);appendFileSync(resolve(dir,'runs.jsonl'),JSON.stringify(run)+'\n');console.log(JSON.stringify(run));}
 catch{const run={startedAt,finishedAt:new Date().toISOString(),state:'FAILED',error:'LOCAL_TRACKING_FAILED'};repo.set('lastRun',run);appendFileSync(resolve(dir,'runs.jsonl'),JSON.stringify(run)+'\n');console.error(JSON.stringify(run));}
 finally{running=false;saveReport();}
};
if(!args.includes('--watch')){await tick();repo.close();}
else{
 const stopPath=resolve(dir,'STOP');if(existsSync(stopPath))unlinkSync(stopPath);
 const html=liveReport(readFileSync(resolve(root,'scripts/local/tracker.html'),'utf8'));
 server=createServer((req,res)=>{
  if(!['127.0.0.1:8782','localhost:8782'].includes(req.headers.host)||req.method!=='GET'){res.writeHead(403);res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  if(req.url==='/api/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...repo.report(),process:{pid:process.pid,running,stopping,pollMinutes:15,nextRunAt:repo.state('nextRunAt')}}));}
  else if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}else{res.writeHead(404);res.end();}
 });
 await new Promise((ok,no)=>{server.once('error',no);server.listen(8782,'127.0.0.1',ok);});
 writeFileSync(resolve(dir,'process.json'),JSON.stringify({pid:process.pid,url:'http://127.0.0.1:8782',startedAt:new Date().toISOString()}));
 const loop=async()=>{await tick();if(!stopping){repo.set('nextRunAt',new Date(Date.now()+15*60000).toISOString());timer=setTimeout(loop,15*60000);}};
 const stop=()=>{stopping=true;clearTimeout(timer);server.close();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 const monitor=setInterval(()=>{if(existsSync(stopPath))stop();if(stopping&&!running){clearInterval(monitor);repo.set('nextRunAt',null);saveReport();repo.close();process.exit(0);}},1000);
 console.log('Edge Lab local research: http://127.0.0.1:8782');void loop();
}
