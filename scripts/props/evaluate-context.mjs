import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const datasetDigest=rows=>createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex');
const number=v=>typeof v==='number'&&Number.isFinite(v);
const time=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
const average=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const prob=p=>number(p)&&p>=0&&p<=1;
function gameAverage(rows,key){const games=new Map();for(const r of rows){const a=games.get(r.gameId)||[];a.push(r[key]);games.set(r.gameId,a);}return average([...games.values()].map(average));}
export function evaluateContext(rows,manifest,{phase='development'}={}){
 if(!Array.isArray(rows)||!['development','holdout'].includes(phase))throw Error('Invalid evaluation input');
 if(manifest?.version!==1||!manifest.modelVersion||!Number.isFinite(time(manifest.frozenAt)))throw Error('Missing frozen manifest');
 if(manifest.datasetSha256!==datasetDigest(rows))throw Error('Frozen dataset digest mismatch');
 const dev=manifest.development,hold=manifest.holdout;
 if(![dev?.start,dev?.end,hold?.start,hold?.end].every(x=>Number.isFinite(time(x)))||time(dev.start)>=time(dev.end)||time(dev.end)>time(hold.start)||time(hold.start)>=time(hold.end)||time(manifest.frozenAt)>=time(hold.start))throw Error('Invalid chronological split');
 if(!Number.isSafeInteger(manifest.acceptancePolicy?.minimumGames)||manifest.acceptancePolicy.minimumGames<1)throw Error('Missing frozen sample policy');
 if(phase==='holdout'&&(manifest.holdoutAudit?.status!=='UNTOUCHED'||!manifest.holdoutAudit?.evidence))throw Error('Holdout must be audited untouched');
 const gameFacts=new Map(),outcomeFacts=new Map();
 const ids=new Set(),selected=[],window=phase==='holdout'?hold:dev;
 for(const r of rows){
  if(!r?.id||ids.has(r.id))throw Error('Duplicate or missing row identity');ids.add(r.id);
  if(!r.gameId||!r.playerId||!['NBA','NFL'].includes(r.sport)||!r.market||!r.variant)throw Error('Missing exact outcome identity');
  const forecast=time(r.forecastAt),start=time(r.startsAt),end=time(r.completedAt),available=time(r.featuresAvailableAt);
  if(![forecast,start,end,available].every(Number.isFinite)||available>forecast||forecast>=start||end<=start)throw Error('Invalid point-in-time cutoff evidence');
  if(![r.actual,r.baseline,r.prediction].every(number))throw Error('Missing paired projection values');
  const gameKey=JSON.stringify([r.sport,r.gameId]),gameFact=JSON.stringify([start,end]);
  const outcomeKey=JSON.stringify([r.sport,r.gameId,r.playerId,r.market]);
  if(gameFacts.has(gameKey)&&gameFacts.get(gameKey)!==gameFact)throw Error('Canonical game timestamps conflict');
  if(outcomeFacts.has(outcomeKey)&&outcomeFacts.get(outcomeKey)!==r.actual)throw Error('Canonical outcome conflict');
  gameFacts.set(gameKey,gameFact);outcomeFacts.set(outcomeKey,r.actual);
  const hasProbability=['modelProbability','baselineProbability','marketProbability','probabilityBasis'].some(k=>k in r);
  if(hasProbability&&(!r.book||!['OVER','UNDER'].includes(r.side)||!number(r.line)||!number(r.odds)||Math.abs(r.odds)<100||!Number.isFinite(time(r.quoteAt))||time(r.quoteAt)>forecast||forecast-time(r.quoteAt)>600000||r.probabilityBasis!=='CONDITIONAL_NO_PUSH'||![r.modelProbability,r.baselineProbability,r.marketProbability].every(prob)))throw Error('Invalid or incomplete probability evidence');

  if(start>=time(window.start)&&start<time(window.end))selected.push(r);
 }
 const grouped=new Map();
 for(const r of selected){const k=JSON.stringify([r.sport,r.market,r.variant]);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(r);}
 // Each sport/market ablation must use the same forecasts, outcomes and controls.
 // Quote identity is included so market-score comparisons cannot cherry-pick books.
 const cohorts=new Map();
 for(const [key,items] of grouped){
  const [sport,market]=JSON.parse(key),family=JSON.stringify([sport,market]);
  const signatures=[...new Set(items.map(r=>JSON.stringify([r.gameId,r.playerId,r.forecastAt,r.startsAt,r.completedAt,r.actual,r.baseline,r.book??null,r.line??null,r.side??null,r.odds??null,r.quoteAt??null,r.baselineProbability??null,r.marketProbability??null,r.probabilityBasis??null])))].sort();
  const signature=JSON.stringify(signatures);
  if(cohorts.has(family)&&cohorts.get(family)!==signature)throw Error('Ablation cohort or baseline mismatch');
  cohorts.set(family,signature);
 }
 const groups=[...grouped.entries()].map(([key,items])=>{
  const unique=new Map(),prices=new Set(),scores=[];
  for(const r of items){
   const k=JSON.stringify([r.gameId,r.playerId,r.forecastAt]);
   const previous=unique.get(k);
   if(previous&&(previous.actual!==r.actual||previous.baseline!==r.baseline||previous.prediction!==r.prediction))throw Error('Conflicting projections for identical player forecast');
   unique.set(k,r);
   if(!r.book||!['OVER','UNDER'].includes(r.side)||!number(r.line)||!number(r.odds)||Math.abs(r.odds)<100||!Number.isFinite(time(r.quoteAt))||time(r.quoteAt)>time(r.forecastAt)||time(r.forecastAt)-time(r.quoteAt)>600000||r.probabilityBasis!=='CONDITIONAL_NO_PUSH'||![r.modelProbability,r.baselineProbability,r.marketProbability].every(prob))continue;
   if(r.actual===r.line)continue;
   const pk=JSON.stringify([k,r.book,r.line,r.side]);if(prices.has(pk))throw Error('Duplicate exact price evaluation');prices.add(pk);
   const y=Number(r.side==='OVER'?r.actual>r.line:r.actual<r.line);
   const loss=p=>-(y*Math.log(Math.max(1e-15,p))+(1-y)*Math.log(Math.max(1e-15,1-p)));
   scores.push({gameId:r.gameId,brier:(r.modelProbability-y)**2,baselineBrier:(r.baselineProbability-y)**2,marketBrier:(r.marketProbability-y)**2,logLoss:loss(r.modelProbability),baselineLogLoss:loss(r.baselineProbability),marketLogLoss:loss(r.marketProbability)});
  }
  const errors=[...unique.values()].map(r=>({gameId:r.gameId,ae:Math.abs(r.prediction-r.actual),base:Math.abs(r.baseline-r.actual),se:(r.prediction-r.actual)**2,bias:r.prediction-r.actual}));
  const [sport,market,variant]=JSON.parse(key),games=new Set(items.map(r=>r.gameId)).size;
  return {sport,market,variant,games,samplePolicyMet:games>=manifest.acceptancePolicy.minimumGames,
   projection:{samples:errors.length,mae:gameAverage(errors,'ae'),baselineMae:gameAverage(errors,'base'),rmse:errors.length?Math.sqrt(gameAverage(errors,'se')):null,bias:gameAverage(errors,'bias')},
   probability:{samples:scores.length,games:new Set(scores.map(r=>r.gameId)).size,...Object.fromEntries(['brier','baselineBrier','marketBrier','logLoss','baselineLogLoss','marketLogLoss'].map(k=>[k,gameAverage(scores,k)]))}};
 });
 return {version:1,modelVersion:manifest.modelVersion,phase,datasetSha256:manifest.datasetSha256,selectedRows:selected.length,groups,weighting:'equal-game means; projections deduplicated by player/forecast; probability scores use exact paired rows',productionEligible:false,productionWeight:0,limitations:['Descriptive evaluation only; no fitted weights or automatic promotion.','Audit evidence is operator-attested; changing or copying a manifest is not proof of untouched data.','No game-level uncertainty intervals computed; promotion remains blocked.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [manifestPath,rowsPath,phase,outPath]=process.argv.slice(2);
 if(!manifestPath||!rowsPath||!outPath||!['development','holdout'].includes(phase))throw Error('Usage: node evaluate-context.mjs manifest.json rows.json development|holdout report.json');
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),rows=JSON.parse(readFileSync(rowsPath,'utf8'));
 const result=evaluateContext(rows,manifest,{phase});
 if(phase==='holdout'){
  if(!result.selectedRows)throw Error('Holdout is empty');
  writeFileSync(manifestPath+'.holdout-consumed',JSON.stringify({datasetSha256:manifest.datasetSha256,modelVersion:manifest.modelVersion,consumedAt:new Date().toISOString()}),{flag:'wx'});
 }
 writeFileSync(outPath,JSON.stringify(result,null,2),{flag:'wx'});
 console.log('Evaluation saved; production influence remains zero.');
}
