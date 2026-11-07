/**
 * Edge Lab V3: offline point-in-time market calibration.
 * Usage: node scripts/calibrate-prop-probabilities.mjs --input=/path/immutable-historical-props.jsonl
 * The input MUST contain genuine pregame predictions, executable book quotes and
 * subsequently graded results. This is not a live prediction engine.
 *
 * Row contract:
 *   sport: NBA|NFL, market: stable stat identifier, eventId, playerId, book,
 *   line, side: over|under, americanOdds (integer |abs|>=100),
 *   startsAt, predictionAt, quoteAt, settledAt (ISO timestamps w/ zone),
 *   season (integer), predictedProbability (0..1), actualValue (>=0).
 * One row per independent offer and game. Integer-line pushes are excluded.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CALIBRATION_VERSION = 'edge-lab-v3-chronological-calibration-v1';
const stamp = s => typeof s === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(s) ? Date.parse(s) : NaN;
const num = x => typeof x === 'number' && Number.isFinite(x);
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const sigmoid = x => 1 / (1 + Math.exp(-clamp(x,-30,30)));
const logit = p => Math.log(clamp(p,1e-5,1-1e-5) / (1-clamp(p,1e-5,1-1e-5)));
const avg = xs => xs.reduce((a,b)=>a+b,0)/xs.length;
export function breakEven(odds) {
  if (!Number.isInteger(odds) || odds === 0 || Math.abs(odds)<100) return null;
  return odds>0 ? 100/(odds+100) : -odds/(100-odds);
}
export function netWin(odds) { return odds>0?odds/100:100/(-odds); }
const round = x => Number(x.toFixed(6));
export function validateHistoricalRow(r) {
  if (!r || typeof r !== 'object') return 'INVALID_ROW';
  if (!['NBA','NFL'].includes(r.sport)) return 'SPORT_NOT_SUPPORTED';
  if (!r.eventId || !r.playerId || !r.market || !r.book || !['over','under'].includes(r.side)) return 'IDENTITY_OR_MARKET_MISSING';
  if (!Number.isInteger(r.season) || r.season<2000 || r.season>2100) return 'SEASON_INVALID';
  if (![r.line,r.actualValue,r.predictedProbability].every(num) || r.line<0 || r.actualValue<0 ||
      r.predictedProbability<=0 || r.predictedProbability>=1 || breakEven(r.americanOdds)===null) return 'MARKET_VALUE_INVALID';
  const [start,pred,quote,settled] = [r.startsAt,r.predictionAt,r.quoteAt,r.settledAt].map(stamp);
  if (![start,pred,quote,settled].every(Number.isFinite)) return 'TIMESTAMPS_MISSING';
  if (pred>=start || quote>=start || settled<=start) return 'POINT_IN_TIME_VIOLATION';
  // Prevent using a later quote to justify an earlier model-generated selection.
  if (quote>pred) return 'QUOTE_POSTDATES_PREDICTION';
  if (start-pred>7*86400000) return 'PREDICTION_TOO_EARLY';
  if (pred-quote>15*60000) return 'QUOTE_TOO_STALE';
  if (r.predictionSource !== 'IMMUTABLE_PREGAME_SNAPSHOT') return 'PREDICTION_PROVENANCE_UNVERIFIED';
  if (r.quoteSource !== 'ARCHIVED_PREGAME_BOOK') return 'ODDS_PROVENANCE_UNVERIFIED';
  if (r.outcomeSource !== 'OFFICIAL_FINAL_BOX_SCORE') return 'OUTCOME_PROVENANCE_UNVERIFIED';
  return null;
}
export function prepareHistory(rows) {
  const rejects={},accepted=[],keys=new Set();
  for(const r of rows){
    let error=validateHistoricalRow(r);
    // One outcome per player-game-market: correlated books, sides and alternate lines do NOT count as independent samples.
    const key=[r.sport,r.market,r.eventId,r.playerId].join('|');
    if (!error && keys.has(key)) error='CORRELATED_DUPLICATE_PLAYER_GAME_MARKET';
    if(error){rejects[error]=(rejects[error]||0)+1;continue;}
    keys.add(key);
    // Numeric line push cannot count as either a win or a loss.
    const y=r.side==='over'?Number(r.actualValue>r.line):Number(r.actualValue<r.line);
    if(r.actualValue===r.line){rejects.PUSH_EXCLUDED=(rejects.PUSH_EXCLUDED||0)+1;continue;}
    accepted.push({...r,y,baselineProbability:breakEven(r.americanOdds)});
  }
  return {accepted,rejects};
}
export function fitPlatt(train) {
  // Ridge-regularized logistic slope + intercept: x=logit(uncalibrated p).
  // Fit only on the chronological training period; never on holdout.
  let a=0,b=1;
  for(let iteration=0;iteration<1200;iteration++){
    let da=0,db=0;
    for(const r of train){const x=logit(r.predictedProbability),p=sigmoid(a+b*x);da+=p-r.y;db+=(p-r.y)*x;}
    const lr=0.08;
    a-=lr*(da/train.length+0.02*a);
    b-=lr*(db/train.length+0.05*(b-1));
    a=clamp(a,-6,6);b=clamp(b,-3,3);
  }
  return {intercept:round(a),slope:round(b),predict:p=>sigmoid(a+b*logit(p))};
}
export function score(rows, getP) {
  if(!rows.length)return null;
  const prob=rows.map(getP);
  const brier=avg(rows.map((r,i)=>(prob[i]-r.y)**2));
  const logLoss=avg(rows.map((r,i)=>-(r.y*Math.log(clamp(prob[i],1e-6,1-1e-6))+
                    (1-r.y)*Math.log(clamp(1-prob[i],1e-6,1-1e-6)))));
  const roi=avg(rows.map(r=>r.y?netWin(r.americanOdds):-1));
  const bins=Array.from({length:10},(_,i)=>{
    const selected=rows.map((r,j)=>({r,p:prob[j]})).filter(v=>Math.min(9,Math.floor(v.p*10))===i);
    return selected.length?{bin:i,n:selected.length,predicted:round(avg(selected.map(v=>v.p))),observed:round(avg(selected.map(v=>v.r.y)))}:null;
  }).filter(Boolean);
  return {n:rows.length,brier:round(brier),logLoss:round(logLoss),
    // Not a strategy ROI: includes all provided offers, not selected trades; fees omitted.
    unfilteredPaperReturnPerUnit:round(roi),bins};
}
export function calibrate(rows,{trainSeasons=[2024],holdoutSeasons=[2025],
    minTrain=300,minHoldout=150}={}){
  if(trainSeasons.some(s=>holdoutSeasons.includes(s)) || Math.max(...trainSeasons)>=Math.min(...holdoutSeasons))
    throw Error('Training seasons must precede and not overlap holdout seasons');
  const data=prepareHistory(rows);
  const groups=new Map();
  for(const r of data.accepted){const key=r.sport+'|'+r.market;if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(r);}
  const models=[];
  for(const [key,group] of groups){
    const train=group.filter(r=>trainSeasons.includes(r.season));
    const hold=group.filter(r=>holdoutSeasons.includes(r.season));
    const report={group:key,trainCount:train.length,holdoutCount:hold.length,promotionEligible:false};
    if(train.length<minTrain||hold.length<minHoldout ||
        new Set(train.map(r=>r.y)).size<2 || new Set(hold.map(r=>r.y)).size<2) {
      report.status='INSUFFICIENT_CHRONOLOGICAL_SAMPLE';models.push(report);continue;
    }
    const fitted=fitPlatt(train);
    const raw=score(hold,r=>r.predictedProbability);
    const cal=score(hold,r=>fitted.predict(r.predictedProbability));
    const market=score(hold,r=>r.baselineProbability);
    report.status='HOLDOUT_EVALUATED_NOT_PROMOTED';
    report.parameters={intercept:fitted.intercept,slope:fitted.slope};
    report.metrics={uncalibrated:raw,calibrated:cal,bookBreakEvenBaseline:market};
    report.deltaVsBook={brier:round(cal.brier-market.brier),logLoss:round(cal.logLoss-market.logLoss)};
    report.findings=cal.brier>=market.brier||cal.logLoss>=market.logLoss
      ? ['DOES_NOT_BEAT_BOOK_BASELINE'] : ['BEATS_PRICE_BASELINE_ON_THIS_HOLDOUT','PROMOTION_REQUIRES_INDEPENDENT_AUDIT_AND_FEE_AWARE_PAPER_BETS'];
    models.push(report);
  }
  return {
    version:CALIBRATION_VERSION,generatedAt:new Date().toISOString(),
    scope:'OFFLINE_RESEARCH_NO_AUTO_PROMOTION',trainSeasons,holdoutSeasons,
    inputRows:rows.length,acceptedRows:data.accepted.length,rejected:data.rejects,
    groupReports:models,uncoveredGroups:models.length===0?'NO_VALID_NBA_OR_NFL_GROUPS':null,
    productionEligible:false,productionWeight:0,
    nextRequirements:['Historical pregame NBA/NFL prop market snapshots with immutable prediction probabilities and official results',
      'Audit quote timestamp and no lookahead','Independent holdout vs book baseline',
      'Fee-aware BUY-strategy ROI, uncertainty and correlation validation']
  };
}
function main(){
  const input=process.argv.find(x=>x.startsWith('--input='))?.slice(8);
  if(!input){process.stderr.write('Usage: node scripts/calibrate-prop-probabilities.mjs --input=historical.jsonl\n');process.exitCode=2;return;}
  try {const rows=readFileSync(input,'utf8').split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
    process.stdout.write(JSON.stringify(calibrate(rows),null,2)+'\n');}
  catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=1;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main();
