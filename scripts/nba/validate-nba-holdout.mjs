import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { backtestGames } from './backtest-nba-team-model.mjs';
import { backtestPlayerStats } from './backtest-nba-player-props.mjs';
import { SUPPORTED_STATS } from '../../sharp-service/lib/nba-player-props.js';

const root = fileURLToPath(new URL('../../',import.meta.url));
const modelFiles = ['sharp-service/lib/nba-model.js','sharp-service/lib/nba-player-props.js',
  'sharp-service/lib/nba-prop-context.js','scripts/nba/backtest-nba-team-model.mjs','scripts/nba/backtest-nba-player-props.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const codeHashes = () => Object.fromEntries(modelFiles.map(file=>[file,hash(fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n'))]));

export function freezePolicy(team, props, manifest) {
  if(team.season!==2024 || props.season!==2024 || props.holdoutTouched || manifest.season!==2024 || manifest.holdoutTouched || manifest.games!==1230) throw new Error('Freeze requires complete 2024 development reports and no holdout exposure');
  if(!team.gamesEvaluated || team.minimumPriorGames!==4 || props.minimumPriorGames!==4 || SUPPORTED_STATS.some(stat=>!props.markets?.[stat])) throw new Error('Incomplete development report or incompatible parameters');
  return { version:1, developmentSeason:2024, holdoutSeason:2025, frozenAt:new Date().toISOString(),
    minimumPriorGames:4, simulationIterations:4000, productionWeight:0, modelHashes:codeHashes(), inputHashes:manifest.sha256,
    developmentReportHashes:{team:hash(JSON.stringify(team)),props:hash(JSON.stringify(props))},
    propPredictors:Object.fromEntries(Object.entries(props.markets).map(([stat,m])=>[stat,
      m.promotion.accepted ? (m.contextPromotion.accepted ? 'contextModel' : 'model') : 'baseline'])) };
}

export function readFrozenPolicy(file) {
  const bytes=fs.readFileSync(file), policy=JSON.parse(bytes);
  if(policy.version!==1 || policy.developmentSeason!==2024 || policy.holdoutSeason!==2025 || policy.productionWeight!==0 || policy.minimumPriorGames!==4 || policy.simulationIterations!==4000) throw new Error('Invalid frozen NBA policy');
  for(const [file,sha] of Object.entries(codeHashes())) if(policy.modelHashes?.[file]!==sha) throw new Error(`Frozen NBA model changed: ${file}`);
  if(SUPPORTED_STATS.some(stat=>!policy.propPredictors?.[stat]) || Object.keys(policy.propPredictors).length!==SUPPORTED_STATS.length || Object.values(policy.propPredictors).some(v=>!['model','contextModel','baseline'].includes(v))) throw new Error('Invalid frozen NBA predictors');
  return {policy,sha256:hash(bytes)};
}

export function summarizeFrozenProps(rowsByMarket, predictors) {
  return Object.fromEntries(Object.entries(predictors).map(([market,predictor])=>{
    const rows=rowsByMarket[market]||[];
    if(!rows.length || rows.some(r=>![r.actual,r[predictor],r.baseline].every(Number.isFinite))) throw new Error(`Incomplete holdout predictions: ${market}`);
    const metrics=key=>({rows:rows.length,mae:rows.length?rows.reduce((sum,r)=>sum+Math.abs(r[key]-r.actual),0)/rows.length:null,
      rmse:rows.length?Math.sqrt(rows.reduce((sum,r)=>sum+(r[key]-r.actual)**2,0)/rows.length):null});
    return [market,{frozenPredictor:predictor,selected:metrics(predictor),baseline:metrics('baseline'),productionEligible:false}];
  }));
}

export function validateHoldoutInputs(games, players) {
  const validId=id=>Number.isSafeInteger(id)&&id>0;
  const validTime=game=>typeof game.datetime==='string' && Number.isFinite(Date.parse(game.datetime)) &&
    game.date===new Date(game.datetime).toISOString().slice(0,10) &&
    [game.season,game.season+1].includes(new Date(game.datetime).getUTCFullYear());
  const gameFields=['id','season','datetime','date','home_team_id','visitor_team_id','home_team_score','visitor_team_score','status','status_state','postseason'];
  const statFields=['pts','reb','ast','turnover','stl','blk','oreb','dreb','fgm','fga','fg3m','fg3a','ftm','fta'];
  const validTeam=(team,id)=>team?.id===id && typeof team.full_name==='string' && team.full_name.trim() && typeof team.abbreviation==='string' && team.abbreviation.trim();
  const sameTeam=(a,b)=>a?.id===b?.id && a?.full_name===b?.full_name && a?.abbreviation===b?.abbreviation;
  if(!Array.isArray(games)||!Array.isArray(players)) throw new Error('Invalid holdout input arrays');
  const byId=new Map(games.map(game=>[game.id,game]));
  const counts=new Map();
  if(games.length!==1230 || byId.size!==1230 || games.some(g=>g.season!==2025) || !players.length) throw new Error('Incomplete or wrong-season holdout data');
  for(const game of games) {
    if(!validId(game.id)||!validId(game.home_team_id)||!validId(game.visitor_team_id)||game.home_team_id===game.visitor_team_id||
      !validTime(game)||game.status!=='Final'||game.status_state!=='final'||game.postseason!==false||
      !validTeam(game.home_team,game.home_team_id)||!validTeam(game.visitor_team,game.visitor_team_id)||
      ![game.home_team_score,game.visitor_team_score].every(value=>Number.isSafeInteger(value)&&value>=0)) throw new Error('Invalid holdout game chronology or identity');
  }
  for(const game of games) for(const id of [game.home_team_id,game.visitor_team_id]) counts.set(id,(counts.get(id)||0)+1);
  if(counts.size!==30 || [...counts.values()].some(n=>n!==82)) throw new Error('Incomplete holdout team schedule');
  const seen=new Set(), totals=new Map();
  for(const row of players) {
    const game=byId.get(row.game?.id), key=`${row.game?.id}:${row.player?.id}`;
    if(!game || !validId(row.player?.id) || typeof row.player.first_name!=='string' || !row.player.first_name.trim() ||
      ![game.home_team_id,game.visitor_team_id].includes(row.team?.id) || seen.has(key)) throw new Error('Invalid or duplicate holdout player row');
    if(gameFields.some(field=>row.game[field]!==game[field]) || !sameTeam(row.game.home_team,game.home_team) ||
      !sameTeam(row.game.visitor_team,game.visitor_team) || !sameTeam(row.team,row.team.id===game.home_team_id?game.home_team:game.visitor_team)) throw new Error('Holdout player game does not match canonical schedule');
    const minutes=typeof row.min==='number'?row.min:typeof row.min==='string'&&/^\d+(?:\.\d+)?$/.test(row.min)?Number(row.min):NaN;
    if(!Number.isFinite(minutes)||minutes<0||statFields.some(field=>!Number.isSafeInteger(row[field])||row[field]<0)) throw new Error('Incomplete holdout player statistics');
    seen.add(key);
    const teamKey=`${game.id}:${row.team.id}`;
    totals.set(teamKey,(totals.get(teamKey)||0)+row.pts);
  }
  for(const game of games) for(const [id,score] of [[game.home_team_id,game.home_team_score],[game.visitor_team_id,game.visitor_team_score]]) {
    if(totals.get(`${game.id}:${id}`)!==score) throw new Error('Incomplete holdout boxscores');
  }
}

async function main() {
  const arg=(name,fallback)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
  const phase=arg('phase','freeze'), output=arg('output-dir','artifacts/nba-validation');
  fs.mkdirSync(output,{recursive:true});
  if(phase==='freeze') {
    const read=name=>JSON.parse(fs.readFileSync(arg(name,''),'utf8'));
    const policy=freezePolicy(read('team-report'),read('props-report'),read('input-manifest'));
    fs.writeFileSync(path.join(output,'frozen-policy.json'),JSON.stringify(policy,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(policy)); return;
  }
  if(phase!=='holdout') throw new Error('Unknown validation phase');
  const {policy,sha256}=readFrozenPolicy(arg('frozen-policy',''));
  const reportPath=path.join(output,'holdout-report.json');
  if(fs.existsSync(reportPath)||fs.existsSync(path.join(output,'holdout-started.json'))) throw new Error('Holdout already started; do not rerun or retune it');
  const gameBytes=fs.readFileSync(arg('games','')), playerBytes=fs.readFileSync(arg('player-stats',''));
  const games=JSON.parse(gameBytes), players=JSON.parse(playerBytes);
  validateHoldoutInputs(games,players);
  const inputHashes={games:hash(gameBytes),playerStats:hash(playerBytes)};
  fs.writeFileSync(path.join(output,'holdout-started.json'),JSON.stringify({startedAt:new Date().toISOString(),frozenPolicySha256:sha256,inputHashes}),{flag:'wx'});
  const team=backtestGames(games,{season:2025,minimumPriorGames:policy.minimumPriorGames,simulationIterations:policy.simulationIterations});
  const props=backtestPlayerStats(players,{season:2025,minimumPriorGames:policy.minimumPriorGames});
  const report={phase:'FROZEN_HOLDOUT',season:2025,holdoutTouched:true,generatedAt:new Date().toISOString(),frozenPolicySha256:sha256,inputHashes,
    team:{gamesEvaluated:team.gamesEvaluated,metrics:team.metrics,improvements:team.improvements},
    props:summarizeFrozenProps(props.rowsByMarket,policy.propPredictors),productionEligible:false,productionWeight:0,
    limitations:'Retrospective ESPN boxscores validate projection error and team-win Brier only. Historical sportsbook prices and publication-time injury/lineup context are unavailable. No market-calibration or production promotion.'};
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'}); console.log(JSON.stringify(report));
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main();
