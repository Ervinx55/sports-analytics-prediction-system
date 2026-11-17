// Offline development research only. This runner neither fetches nor writes live data.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseCsv} from '../../sharp-service/lib/nfl-model.js';
import {metrics, pairedBlockBootstrap} from './winner-validation-metrics.mjs';

const BASE_FEATURES=['homeVenue','marginDifference','adjustedMarginDifference'];
// These protocol pins are independent of the mutable cache manifest. The CLI
// always uses these exact historical bytes; fixture expectations are API-only.
const EXPECTED_SOURCE_HASHES=Object.freeze({
  'games.csv':'3623ec559b2fda2b54eb5f54a6fa16b8cac908f96347c9ba8a362185a645a26d',
  'stats_team_week_2023.csv':'dc5a387daabe8663deaddac492ad7020d47fb1a66048690b355b406cd8e4c454',
  'stats_team_week_2024.csv':'b207a1430c2715d03bbf1844c4eae98695f364851ff6025f422febc2c13f5255',
  'depth_charts_2024.csv':'f210a33774611f7f78a89af789b61c6289a2631a21227a1a3c63c973c23588b7'
});
export const PROTOCOL=Object.freeze({
  version:'NFL independent winner development v1', trainSeason:2023, evaluationSeason:2024,
  minimumWeek:4, minimumHistoryGames:3, maximumHistoryGames:12,
  recencyDecay:0.16, previousSeasonWeight:0.45, ridgeLambda:1,
  ridgeConvention:'sum negative log likelihood + 0.5 * lambda * sum(nonintercept coefficients squared)',
  maximumNewtonSteps:50, convergenceTolerance:1e-9,
  featureSets:{baseline:BASE_FEATURES,rest:[...BASE_FEATURES,'restDifference'],
    defense:[...BASE_FEATURES,'epaMatchupDifference'],both:[...BASE_FEATURES,'restDifference','epaMatchupDifference']},
  dataStatus:'Both seasons are reused development data; no untouched holdout or promotion claim.',
  target:'Home win conditional on a decisive full-game result; ties reported separately.',
  epaPolicy:'Current-season strictly earlier weeks and earlier game dates only; complete reciprocal game/team pairs required.',
  schedulePolicy:'Strictly earlier current-season weeks and earlier dates, including for historical opponent-strength lookups; previous-season results require earlier dates.',
  restPolicy:'Prior same-season game calendar dates; home-minus-away day difference capped to [-4,4].',
  opponentAdjustment:'Each prior margin plus the opponent weighted prior margin measured before that historical game; no history uses zero with explicit evidence count.',
  selection:'Four fixed candidates, no hyperparameter search, selection or best-model promotion.'
});

const numeric=value=>value===null||value===undefined||String(value).trim()===''?null:
  (Number.isFinite(Number(value))?Number(value):null);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]))])):value);
const clip=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const sigmoid=x=>x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);

function uniqueRows(rows,keyOf,label) {
  const map=new Map();let duplicates=0;
  for(const row of rows){
    const key=keyOf(row);
    if(!key)throw new Error(`Missing ${label} identity`);
    const prior=map.get(key);
    if(prior){if(stable(prior)!==stable(row))throw new Error(`Conflicting ${label}: ${key}`);duplicates++;}
    else map.set(key,row);
  }
  return {rows:[...map.values()],duplicates};
}

export function kickoffIso(game) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(game.gameday||'')||!/^\d{2}:\d{2}$/.test(game.gametime||''))return null;
  const [y,m,d]=game.gameday.split('-').map(Number),[h,minute]=game.gametime.split(':').map(Number);
  const desired=Date.UTC(y,m-1,d,h,minute),format=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let utc=desired;
  for(let i=0;i<3;i++){
    const parts=Object.fromEntries(format.formatToParts(new Date(utc)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
    const actual=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);
    if(actual===desired)return new Date(utc).toISOString();
    utc+=desired-actual;
  }
  return null;
}

function noVig(game) {
  const implied=odds=>{const n=numeric(odds);return n===null||Math.abs(n)<100?null:n>0?100/(100+n):-n/(100-n);};
  const home=implied(game.home_moneyline),away=implied(game.away_moneyline);
  return home===null||away===null?null:home/(home+away);
}

function completed(game) {return numeric(game.home_score)!==null&&numeric(game.away_score)!==null;}
function marginFor(game,team){const margin=Number(game.home_score)-Number(game.away_score);return game.home_team===team?margin:-margin;}
function weighted(rows,value,season){
  let total=0,weight=0;
  rows.forEach((row,index)=>{const w=Math.exp(-PROTOCOL.recencyDecay*index)*(Number(row.season)===season?1:PROTOCOL.previousSeasonWeight);total+=w*value(row);weight+=w;});
  return weight?total/weight:null;
}
function offenseEpa(row){
  if(!row)return null;
  const values=['passing_epa','rushing_epa','attempts','sacks_suffered','carries'].map(k=>numeric(row[k]));
  if(values.some(v=>v===null))return null;
  const [pass,rush,attempts,sacks,carries]=values,plays=attempts+sacks+carries;
  return plays>0?(pass+rush)/plays:null;
}

export function buildFeatureRows(scheduleInput,statsInput) {
  const scheduleUnique=uniqueRows(scheduleInput,r=>r.game_id,'schedule');
  const statsUnique=uniqueRows(statsInput,r=>r.game_id&&r.team?`${r.game_id}|${r.team}`:null,'team statistics');
  const schedule=scheduleUnique.rows,stats=statsUnique.rows;
  const byGame=new Map(schedule.map(g=>[g.game_id,g]));
  const statsMap=new Map(stats.map(r=>[`${r.game_id}|${r.team}`,r]));
  const historyCache=new Map(),strengthCache=new Map();
  function history(team,season,date,week){
    const key=`${team}|${season}|${date}|${week}`;
    if(!historyCache.has(key))historyCache.set(key,schedule.filter(g=>
      g.game_type==='REG'&&[season,season-1].includes(Number(g.season))&&g.gameday<date&&completed(g)&&
      (Number(g.season)<season||Number(g.week)<week)&&
      [g.home_team,g.away_team].includes(team))
      .sort((a,b)=>b.gameday.localeCompare(a.gameday)||a.game_id.localeCompare(b.game_id)).slice(0,PROTOCOL.maximumHistoryGames));
    return historyCache.get(key);
  }
  function strength(team,season,date,week){
    const key=`${team}|${season}|${date}|${week}`;
    if(!strengthCache.has(key))strengthCache.set(key,weighted(history(team,season,date,week),g=>marginFor(g,team),season));
    return strengthCache.get(key);
  }
  function epaHistory(team,season,week,date){
    return stats.filter(r=>r.team===team&&Number(r.season)===season&&r.season_type==='REG'&&Number(r.week)<week)
      .map(r=>({row:r,game:byGame.get(r.game_id),opponent:statsMap.get(`${r.game_id}|${r.opponent_team}`)}))
      .filter(({row,game,opponent})=>game&&game.game_type==='REG'&&completed(game)&&game.gameday<date&&
        Number(game.season)===season&&Number(game.week)===Number(row.week)&&
        [game.home_team,game.away_team].includes(team)&&
        [game.home_team,game.away_team].includes(row.opponent_team)&&row.opponent_team!==team&&
        opponent&&opponent.opponent_team===team&&Number(opponent.season)===season&&
        Number(opponent.week)===Number(row.week)&&opponent.season_type==='REG'&&
        offenseEpa(row)!==null&&offenseEpa(opponent)!==null)
      .sort((a,b)=>b.game.gameday.localeCompare(a.game.gameday)||a.game.game_id.localeCompare(b.game.game_id))
      .slice(0,PROTOCOL.maximumHistoryGames);
  }
  const rows=[],exclusions=[];
  const targets=schedule.filter(g=>[PROTOCOL.trainSeason,PROTOCOL.evaluationSeason].includes(Number(g.season))&&
    g.game_type==='REG'&&Number(g.week)>=PROTOCOL.minimumWeek&&completed(g))
    .sort((a,b)=>a.gameday.localeCompare(b.gameday)||a.game_id.localeCompare(b.game_id));
  for(const target of targets){
    const season=Number(target.season),week=Number(target.week),gameId=target.game_id;
    const startsAt=kickoffIso(target);
    const exclude=reason=>exclusions.push({gameId,season,week,reason});
    if(!startsAt||!target.home_team||!target.away_team||target.home_team===target.away_team||
      !['home','neutral'].includes(String(target.location||'').toLowerCase())){exclude('invalid_identity_time_or_venue');continue;}
    const home=history(target.home_team,season,target.gameday,week),away=history(target.away_team,season,target.gameday,week);
    if(Math.min(home.length,away.length)<PROTOCOL.minimumHistoryGames){exclude('insufficient_prior_results');continue;}
    const homeEpa=epaHistory(target.home_team,season,week,target.gameday),awayEpa=epaHistory(target.away_team,season,week,target.gameday);
    if(Math.min(homeEpa.length,awayEpa.length)<PROTOCOL.minimumHistoryGames){exclude('insufficient_prior_epa');continue;}
    const homeLast=home.find(g=>Number(g.season)===season),awayLast=away.find(g=>Number(g.season)===season);
    if(!homeLast||!awayLast){exclude('missing_prior_rest');continue;}
    let opponentStrengthMissing=0;
    const strengthGameIds=new Set();
    function adjusted(game,team){
      const opponent=game.home_team===team?game.away_team:game.home_team;
      const rating=strength(opponent,Number(game.season),game.gameday,Number(game.week));
      history(opponent,Number(game.season),game.gameday,Number(game.week)).forEach(g=>strengthGameIds.add(g.game_id));
      if(rating===null)opponentStrengthMissing++;
      return marginFor(game,team)+(rating??0);
    }
    const epaAverage=(list,key)=>weighted(list.map(item=>({...item.row,value:offenseEpa(item[key])})),r=>r.value,season);
    const homeOff=epaAverage(homeEpa,'row'),homeDef=epaAverage(homeEpa,'opponent');
    const awayOff=epaAverage(awayEpa,'row'),awayDef=epaAverage(awayEpa,'opponent');
    const features={
      homeVenue:String(target.location).toLowerCase()==='neutral'?0:1,
      marginDifference:weighted(home,g=>marginFor(g,target.home_team),season)-weighted(away,g=>marginFor(g,target.away_team),season),
      adjustedMarginDifference:weighted(home,g=>adjusted(g,target.home_team),season)-weighted(away,g=>adjusted(g,target.away_team),season),
      restDifference:clip((Date.parse(awayLast.gameday)-Date.parse(homeLast.gameday))/86400000,-4,4),
      epaMatchupDifference:(homeOff+awayDef)-(awayOff+homeDef)
    };
    if(Object.values(features).some(v=>!Number.isFinite(v)))throw new Error(`Invalid feature in ${gameId}`);
    const scoreDifference=Number(target.home_score)-Number(target.away_score);
    rows.push({gameId,season,week,block:`${season}-${String(week).padStart(2,'0')}`,startsAt,
      homeTeam:target.home_team,awayTeam:target.away_team,
      outcome:scoreDifference===0?null:Number(scoreDifference>0),tie:scoreDifference===0,
      marketProbability:noVig(target),features,
      featureEvidence:{cutoff:target.gameday,homeHistoryGames:home.length,awayHistoryGames:away.length,
        homeEpaGames:homeEpa.length,awayEpaGames:awayEpa.length,opponentStrengthMissing,
        scheduleGameIds:[...new Set([...home,...away].map(g=>g.game_id))].sort(),
        opponentStrengthGameIds:[...strengthGameIds].sort(),
        statGameIds:[...new Set([...homeEpa,...awayEpa].map(g=>g.row.game_id))].sort()}});
  }
  return {rows,exclusions,inventory:{scheduleRows:schedule.length,teamStatisticRows:stats.length,
    duplicateScheduleRows:scheduleUnique.duplicates,duplicateStatisticRows:statsUnique.duplicates,
    targetGames:targets.length,eligibleGames:rows.length,
    availability:'Retrospective corrected archives; historical publication timestamps are unavailable.'}};
}

function solve(matrix,vector){
  const a=matrix.map((row,i)=>[...row,vector[i]]),n=vector.length;
  for(let col=0;col<n;col++){
    let pivot=col;for(let i=col+1;i<n;i++)if(Math.abs(a[i][col])>Math.abs(a[pivot][col]))pivot=i;
    if(Math.abs(a[pivot][col])<1e-12)throw new Error('Singular logistic Hessian');
    [a[col],a[pivot]]=[a[pivot],a[col]];const scale=a[col][col];
    for(let j=col;j<=n;j++)a[col][j]/=scale;
    for(let i=0;i<n;i++)if(i!==col){const factor=a[i][col];for(let j=col;j<=n;j++)a[i][j]-=factor*a[col][j];}
  }
  return a.map(row=>row[n]);
}

export function fitCandidates(rows){
  const training=rows.filter(r=>r.season===PROTOCOL.trainSeason&&[0,1].includes(r.outcome));
  if(training.length<2||new Set(training.map(r=>r.outcome)).size<2)throw new Error('Training requires decisive games from both outcome classes');
  const models={};
  for(const [name,featureNames] of Object.entries(PROTOCOL.featureSets)){
    const means=featureNames.map(k=>training.reduce((s,r)=>s+r.features[k],0)/training.length);
    const standardDeviations=featureNames.map((k,j)=>Math.sqrt(training.reduce((s,r)=>s+(r.features[k]-means[j])**2,0)/training.length)||1);
    const x=training.map(r=>[1,...featureNames.map((k,j)=>(r.features[k]-means[j])/standardDeviations[j])]);
    let coefficients=Array(featureNames.length+1).fill(0),steps=0,converged=false;
    const objective=beta=>training.reduce((s,r,i)=>{const z=dot(x[i],beta);return s+Math.max(z,0)+Math.log1p(Math.exp(-Math.abs(z)))-r.outcome*z;},0)+
      0.5*PROTOCOL.ridgeLambda*beta.slice(1).reduce((s,b)=>s+b*b,0);
    for(;steps<PROTOCOL.maximumNewtonSteps;steps++){
      const gradient=coefficients.map((b,j)=>j?PROTOCOL.ridgeLambda*b:0);
      const hessian=coefficients.map((_,j)=>coefficients.map((_,k)=>j===k&&j?PROTOCOL.ridgeLambda:0));
      for(let i=0;i<training.length;i++){
        const p=sigmoid(dot(x[i],coefficients)),w=p*(1-p);
        for(let j=0;j<coefficients.length;j++){
          gradient[j]+=x[i][j]*(p-training[i].outcome);
          for(let k=0;k<coefficients.length;k++)hessian[j][k]+=w*x[i][j]*x[i][k];
        }
      }
      const delta=solve(hessian,gradient);let step=1;
      let next=coefficients.map((b,j)=>b-step*delta[j]);
      while(objective(next)>objective(coefficients)+1e-12&&step>1/1048576){step/=2;next=coefficients.map((b,j)=>b-step*delta[j]);}
      if(objective(next)>objective(coefficients)+1e-9)throw new Error('Logistic line search failed');
      coefficients=next;
      if(Math.max(...delta.map(d=>Math.abs(step*d)))<PROTOCOL.convergenceTolerance){converged=true;steps++;break;}
    }
    if(!converged)throw new Error(`Logistic fit failed to converge: ${name}`);
    models[name]={featureNames,means,standardDeviations,coefficients,trainingRows:training.length,
      trainingSeason:PROTOCOL.trainSeason,ridgeLambda:PROTOCOL.ridgeLambda,steps,converged};
  }
  return models;
}

export function predictCandidate(model,features){
  const x=[1,...model.featureNames.map((key,i)=>(features[key]-model.means[i])/model.standardDeviations[i])];
  if(x.some(v=>!Number.isFinite(v)))throw new Error('Missing or invalid prediction feature');
  return clip(sigmoid(dot(x,model.coefficients)),1e-12,1-1e-12);
}

export async function evaluateRows(rows,{bootstrapIterations=2000}={}){
  const models=fitCandidates(rows),evaluationRows=rows.filter(r=>r.season===PROTOCOL.evaluationSeason);
  const decisive=evaluationRows.filter(r=>[0,1].includes(r.outcome));
  const predictions=decisive.map(row=>({gameId:row.gameId,block:row.block,startsAt:row.startsAt,outcome:row.outcome,
    market:row.marketProbability,...Object.fromEntries(Object.entries(models).map(([key,model])=>[key,predictCandidate(model,row.features)]))}));
  const pairedMarket=predictions.filter(r=>Number.isFinite(r.market));
  const candidates=Object.fromEntries(Object.keys(models).map(key=>[key,{
    metrics:metrics(predictions.map(r=>({probability:r[key],outcome:r.outcome}))),
    versusBaseline:pairedBlockBootstrap(predictions,key,'baseline',{iterations:bootstrapIterations,seed:20261117}),
    versusClosingReference:pairedBlockBootstrap(pairedMarket,key,'market',{iterations:bootstrapIterations,seed:20261117})}]));
  const training=rows.filter(r=>r.season===PROTOCOL.trainSeason&&[0,1].includes(r.outcome));
  const homeRate=training.reduce((sum,r)=>sum+r.outcome,0)/training.length;
  return {protocol:PROTOCOL,models,productionWeight:0,untouchedHoldout:false,
    training:{games:training.length,homeWinRate:homeRate},
    lineupAblation:{status:'unavailable',reason:'Archived target starters and weekly depth charts have no original pregame publication timestamps. No target QB, injury, actual participation or lineup feature is used.'},
    evaluation:{season:PROTOCOL.evaluationSeason,games:evaluationRows.length,decisiveGames:decisive.length,
      ties:evaluationRows.filter(r=>r.tie).length,tieGameIds:evaluationRows.filter(r=>r.tie).map(r=>r.gameId),
      candidates,naiveReferences:{coinFlip:metrics(predictions.map(r=>({probability:0.5,outcome:r.outcome}))),
        trainingHomeRate:metrics(predictions.map(r=>({probability:homeRate,outcome:r.outcome})))},
      closingMoneylineReference:{metrics:metrics(pairedMarket.map(r=>({probability:r.market,outcome:r.outcome}))),
        gameIds:pairedMarket.map(r=>r.gameId),missing:predictions.length-pairedMarket.length,
        timestampStatus:'unknown original observation time',label:'Descriptive retrospective closing no-vig reference; not executable EV or ROI.'},predictions},
    limitations:['All model comparisons are reused development; no best candidate is selected.',
      'Corrected statistics are replayed chronologically, but original publication/revision times are unavailable.',
      'EPA is a lagged aggregate offense/defense matchup feature, not player assignments or verified lineup adjustment.',
      'Weekly block bootstrap intervals are descriptive and do not remove development reuse or establish profitability.',
      'A new prospectively frozen winner cohort is required before validation or promotion.']};
}

function loadCache(cacheDir,expectedSourceHashes){
  const manifest=JSON.parse(fs.readFileSync(path.join(cacheDir,'manifest.json'),'utf8'));
  const wanted=['games.csv','stats_team_week_2023.csv','stats_team_week_2024.csv','depth_charts_2024.csv'];
  const sources=[],loaded={};
  for(const name of wanted){
    const matches=Object.entries(manifest).filter(([,entry])=>entry.url.endsWith(`/${name}`));
    if(matches.length!==1)throw new Error(`Expected one cached source: ${name}`);
    const [id,entry]=matches[0],filename=path.join(cacheDir,`${id}.bin`),bytes=fs.readFileSync(filename);
    if(sha(bytes)!==entry.sha256||bytes.length!==entry.bytes)throw new Error(`Source integrity mismatch: ${name}`);
    if(sha(bytes)!==expectedSourceHashes[name])throw new Error(`Protocol source hash mismatch: ${name}`);
    loaded[name]=parseCsv(bytes.toString('utf8'));sources.push({...entry,file:filename,rows:loaded[name].length});
  }
  return {schedule:loaded['games.csv'],stats:[...loaded['stats_team_week_2023.csv'],...loaded['stats_team_week_2024.csv']],
    depth:loaded['depth_charts_2024.csv'],sources};
}

export async function runOffline({cacheDir,outputDir,expectedSourceHashes=EXPECTED_SOURCE_HASHES}){
  const {schedule,stats,depth,sources}=loadCache(cacheDir,expectedSourceHashes);
  fs.mkdirSync(path.dirname(outputDir),{recursive:true});
  // The nonrecursive mkdir is the reservation. An existence check followed by
  // recursive mkdir would let concurrent runs both fit and overwrite artifacts.
  try{fs.mkdirSync(outputDir);}
  catch(error){
    if(error.code==='EEXIST')throw new Error('Refusing to overwrite existing output directory; use a new output directory');
    throw error;
  }
  const features=buildFeatureRows(schedule,stats),report=await evaluateRows(features.rows);
  const implementationFiles=[fileURLToPath(import.meta.url),fileURLToPath(new URL('./winner-validation-metrics.mjs',import.meta.url)),
    fileURLToPath(new URL('../../sharp-service/lib/nfl-model.js',import.meta.url))];
  const featureBytes=JSON.stringify(features,null,2)+'\n',modelBytes=JSON.stringify(report.models,null,2)+'\n';
  const predictions=report.evaluation.predictions;
  delete report.evaluation.predictions;
  report.generatedAt=new Date().toISOString();
  report.coverage=features.inventory;report.exclusions=features.exclusions;
  report.depthArchive={rows:depth.length,datedRows:depth.filter(r=>r.dt).length,usedForFeatures:false};
  report.provenance={sources,expectedSourceHashes,implementationHashes:Object.fromEntries(implementationFiles.map(file=>[file,sha(fs.readFileSync(file))])),
    protocolSha256:sha(JSON.stringify(PROTOCOL)),featureRowsSha256:sha(featureBytes),coefficientsSha256:sha(modelBytes)};
  fs.writeFileSync(path.join(outputDir,'features.json'),featureBytes,{flag:'wx'});
  fs.writeFileSync(path.join(outputDir,'models.json'),modelBytes,{flag:'wx'});
  fs.writeFileSync(path.join(outputDir,'predictions.json'),JSON.stringify(predictions,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  const lines=['# NFL independent winner development validation','',PROTOCOL.dataStatus,'',
    `Training: ${report.training.games} decisive 2023 games. Evaluation: ${report.evaluation.decisiveGames} decisive 2024 games; ${report.evaluation.ties} ties separately excluded.`,
    '', '| Candidate | Games | Brier | Log loss | Accuracy | Brier delta vs baseline (95% interval) |',
    '|---|---:|---:|---:|---:|---|'];
  for(const [key,item] of Object.entries(report.evaluation.candidates)){
    const m=item.metrics,ci=item.versusBaseline.brier,fmt=x=>x===null?'unavailable':x.toFixed(6);
    lines.push(`| ${key} | ${m.n} | ${fmt(m.brier)} | ${fmt(m.logloss)} | ${fmt(m.accuracy)} | ${fmt(ci.delta)} [${fmt(ci.lower)}, ${fmt(ci.upper)}] |`);
  }
  lines.push('','Negative delta favors the candidate. Intervals resample weeks and are descriptive development uncertainty.',
    '',`Closing-moneyline reference Brier: ${report.evaluation.closingMoneylineReference.metrics.brier}; original price timestamps are unknown. No executable EV/ROI claim.`,
    '',`Lineup ablation: unavailable. ${report.lineupAblation.reason}`,
    '',`Source inventory, exclusions, calibration and market-relative paired intervals are preserved in report.json; game features, predictions and coefficients are separate hashed artifacts.`,
    '', 'Production weight remains zero. No untouched cohort was evaluated and no candidate was selected.');
  fs.writeFileSync(path.join(outputDir,'README.md'),lines.join('\n')+'\n',{flag:'wx'});
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
  const cacheDir=arg('cache-dir'),outputDir=arg('output-dir');
  if(!cacheDir||!outputDir)throw new Error('Required: --cache-dir=PATH --output-dir=NEW_PATH');
  const report=await runOffline({cacheDir:path.resolve(cacheDir),outputDir:path.resolve(outputDir)});
  console.log(JSON.stringify({outputDir,training:report.training,evaluation:report.evaluation,productionWeight:0}));
}
