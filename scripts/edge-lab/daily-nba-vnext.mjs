import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {parseEspnScoreboard,projectNbaGames} from "../../sharp-service/lib/nba-vnext-baseline.js";
import {backtestNbaBaseline} from "../../sharp-service/lib/nba-vnext-backtest.js";

const ENDPOINT="https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const option=(name)=>process.argv.find(s=>s.startsWith("--"+name+"="))?.split("=").slice(1).join("=")||null;
function easternToday(){
 const parts=new Intl.DateTimeFormat("en-US",{
  timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"
 }).formatToParts(new Date());
 const get=t=>parts.find(p=>p.type===t)?.value;
 return get("year")+"-"+get("month")+"-"+get("day");
}
function offset(date,days) {
 return new Date(Date.parse(date+"T12:00:00Z")+days*86400000).toISOString().slice(0,10);
}
async function getScoreboard(date) {
 const u=new URL(ENDPOINT);u.searchParams.set("dates",date.replaceAll("-",""));
 u.searchParams.set("limit","200");
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),7000);
 try{
  const r=await fetch(u,{signal:controller.signal,headers:{"accept":"application/json"}});
  if(!r.ok)throw Error("HTTP "+r.status);
  return parseEspnScoreboard(await r.json());
 }finally{clearTimeout(timeout);}
}
export async function collectDaily({date=easternToday(),days=21,fetchDay=getScoreboard}={}) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||
   new Date(date+"T00:00:00Z").toISOString().slice(0,10)!==date)
   throw Error("Invalid date");
 if(!Number.isInteger(days)||days<10||days>35)throw Error("days must be 10..35");
 const dates=Array.from({length:days+1},(_,i)=>offset(date,i-days));
 const records=new Array(dates.length);
 let cursor=0;
 async function worker(){
  while(cursor<dates.length){
   const i=cursor++;
   try{records[i]={date:dates[i],ok:true,games:await fetchDay(dates[i])};}
   catch(e){records[i]={date:dates[i],ok:false,games:[],error:String(e.message||e)};}
  }
 }
 await Promise.all(Array.from({length:4},worker));
 const today=records.at(-1),previous=records.slice(0,-1);
 const successDays=previous.filter(r=>r.ok).length;
 const complete=today.ok&&successDays>=Math.ceil(days*.9);
 const history=previous.flatMap(r=>r.games);
 const now=new Date().toISOString();
 const forecast=projectNbaGames({historicalGames:history,
   upcomingGames:today.games,asOf:now,historyComplete:complete});
 const audit=backtestNbaBaseline({games:history});
 return {
  version:"edge-vnext-daily-nba-snapshot-v1",createdAt:now,
  slateDate:date,provider:"ESPN basketball scoreboard",
  paidRequests:0,providerSecretUsed:false,productionEligible:false,
  source:{dateCount:dates.length,successDays,failedDates:records.filter(x=>!x.ok).map(x=>x.date),
    complete},
  forecast,backtest:audit,
  warning:"Research only: model uncalibrated; no opponent injuries, sharp odds or historical price-matched ROI."
 };
}
if(process.argv[1]&&import.meta.url===new URL("file://"+path.resolve(process.argv[1])).href){
 try{
  const result=await collectDaily({date:option("date")||easternToday(),
   days:Number(option("days")||21)});
  const dest=option("output")||"artifacts/edge-vnext/nba-daily.json";
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,JSON.stringify(result,null,2)+"\n");
  process.stdout.write(JSON.stringify({date:result.slateDate,source:result.source,
    forecasts:result.forecast.rows.length,backtestGames:result.backtest.evaluatedGames,
    output:dest,productionEligible:false})+"\n");
  if(!result.source.complete)process.exitCode=2;
 }catch(err){process.stderr.write(String(err.message||err)+"\n");process.exitCode=1;}
}
