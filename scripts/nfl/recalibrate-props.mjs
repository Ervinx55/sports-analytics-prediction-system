import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {backtestSeason} from './backtest-nfl-player-props.mjs';
import {fitRecalibration,kickoffIso,candidateProbability,probabilityMetrics} from './recalibration-lib.mjs';
import {independentProbability} from '../../sharp-service/lib/nfl-player-props.js';

const arg=(key,fallback)=>process.argv.find(x=>x.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const output=path.resolve(arg('output-dir','artifacts/nfl-recalibration-2026-11-16'));
const cache=path.resolve(arg('cache-dir',path.join(output,'source-cache')));
const offline=!process.argv.includes('--fetch');
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const file of ['candidate.json','report.json','development-rows.json']){
  if(fs.existsSync(path.join(output,file)))throw new Error(`Refusing to overwrite existing candidate artifact: ${file}; use a new output directory`);
}
fs.mkdirSync(cache,{recursive:true});
const manifestPath=path.join(cache,'manifest.json');
const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{};
const used=new Map();
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,options)=>{
  const source=String(url);
  if(!/^https:\/\/(raw\.githubusercontent\.com|github\.com)\//.test(source)) throw new Error(`Unexpected historical source: ${source}`);
  const id=sha(source),filename=path.join(cache,`${id}.bin`);
  let bytes,entry=manifest[id];
  if(entry&&fs.existsSync(filename)){
    bytes=fs.readFileSync(filename);
    if(sha(bytes)!==entry.sha256||entry.url!==source) throw new Error(`Source cache integrity error: ${id}`);
  }else{
    if(offline) throw new Error(`Uncached source; run with --fetch: ${source}`);
    const response=await originalFetch(source,options);
    if(!response.ok) return response;
    bytes=Buffer.from(await response.arrayBuffer());
    entry={url:source,sha256:sha(bytes),bytes:bytes.length,receivedAt:new Date().toISOString()};
    fs.writeFileSync(filename,bytes);manifest[id]=entry;
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  }
  used.set(id,entry);
  return new Response(bytes,{status:200});
};

try{
  // Targets are strictly 2024. Multi-season schedule/NGS archives can contain
  // later rows; the unchanged point-in-time feature filters exclude them.
  const replay=await backtestSeason(2024,4,{eventBuilder:game=>({
    eventID:game.game_id,startsAt:kickoffIso(game),
    matchup:{away:{name:game.away_team,short:game.away_team},home:{name:game.home_team,short:game.home_team}},
    // Archived closing game spreads/totals lack observedAt. Do not call them pregame evidence.
    markets:{}
  })});
  const rows=Object.entries(replay.rowsByMarket).flatMap(([market,items])=>items.map(row=>({...row,market,prediction:row.incumbentPrediction})))
    .filter(row=>Number.isFinite(row.prediction)&&row.playerID);
  const input=JSON.stringify(rows);
  const report=fitRecalibration(rows);
  for(const [market,model] of Object.entries(report.markets)){
    const confirmation=rows.filter(r=>r.market===market&&r.week>=11&&(market==='passing_touchdowns'||(Number.isFinite(r.incumbentSd)&&r.incumbentSd>0)));
    const diagnostics=confirmation.map(row=>{
      // A prior-model threshold independent of actual outcome, never a claimed book price.
      const line=Math.max(.5,Math.floor(row.prediction)+.5);
      return {gameId:row.gameId,outcome:Number(row.actual>line),line,
        baseline:independentProbability({mean:row.prediction,sd:row.incumbentSd},line,'over',market),
        candidate:candidateProbability(model,row.prediction,line,'over')};
    }).filter(r=>Number.isFinite(r.baseline)&&Number.isFinite(r.candidate));
    model.syntheticThresholdDiagnostics={thresholdPolicy:'floor(prior incumbent mean)+0.5; not sportsbook lines',
      baseline:probabilityMetrics(diagnostics.map(r=>({...r,probability:r.baseline}))),
      candidate:probabilityMetrics(diagnostics.map(r=>({...r,probability:r.candidate}))),
      acceptanceInfluence:false};
  }
  const baselineFiles=['sharp-service/lib/nfl-player-props.js','sharp-service/lib/nfl-model.js','sharp-service/lib/nfl-game-script.js'];
  const baselineHashes=Object.fromEntries(baselineFiles.map(file=>[file,sha(fs.readFileSync(file))]));
  const candidateSourceHashes=Object.fromEntries(['scripts/nfl/recalibrate-props.mjs','scripts/nfl/recalibration-lib.mjs','scripts/nfl/backtest-nfl-player-props.mjs'].map(file=>[file,sha(fs.readFileSync(file))]));
  const candidate={...report,sourceProvenance:{inputSha256:sha(input),baselineHashes,candidateSourceHashes,sourceManifest:[...used.values()]},
    limitations:['Historical stat replay is not a timestamped sportsbook backtest.','Residual distribution is descriptive development evidence; no probability calibration or ROI claim.','No new holdout has been run.','Availability/injury publication timelines are not established by these archives.']};
  candidate.modelHash=sha(JSON.stringify(candidate));
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'development-rows.json'),input+'\n');
  fs.writeFileSync(path.join(output,'candidate.json'),JSON.stringify(candidate,null,2)+'\n');
  const compact=Object.fromEntries(Object.entries(candidate.markets).map(([k,{residuals,...v}])=>[k,{...v,residualSamples:residuals.length}]));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({...candidate,markets:compact},null,2)+'\n');
  console.log(JSON.stringify({output,rows:rows.length,modelHash:candidate.modelHash,markets:compact,productionWeight:0}));
}finally{globalThis.fetch=originalFetch;}
