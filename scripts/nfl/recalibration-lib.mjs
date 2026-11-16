// Offline research only. Does not import or modify runtime calibration settings.
export const VERSION = 'nfl-props-recalibration-2026-11-16-v1';
const average = xs => xs.reduce((a,b)=>a+b,0)/xs.length;

export function gameMetrics(rows, predict=r=>r.prediction) {
  const games=new Map();
  for(const r of rows){
    const error=predict(r)-r.actual;
    if(!Number.isFinite(error)) throw new Error('Expected finite prediction and outcome');
    if(!games.has(r.gameId)) games.set(r.gameId,[]);
    games.get(r.gameId).push(error);
  }
  const errors=[...games.values()];
  return {rows:rows.length,games:games.size,
    mae:errors.length?average(errors.map(es=>average(es.map(Math.abs)))):null,
    bias:errors.length?average(errors.map(average)):null,
    rmse:errors.length?Math.sqrt(average(errors.map(es=>average(es.map(e=>e*e))))):null};
}

export function probabilityMetrics(rows){
  const games=new Map();
  for(const row of rows){
    if(!Number.isFinite(row.probability)||row.probability<0||row.probability>1||![0,1].includes(row.outcome)) throw new Error('Invalid probability or binary outcome');
    const p=Math.max(1e-6,Math.min(1-1e-6,row.probability));
    if(!games.has(row.gameId))games.set(row.gameId,[]);
    games.get(row.gameId).push({brier:(row.probability-row.outcome)**2,logloss:-(row.outcome*Math.log(p)+(1-row.outcome)*Math.log(1-p))});
  }
  return {rows:rows.length,games:games.size,brier:games.size?average([...games.values()].map(xs=>average(xs.map(x=>x.brier)))):null,
    logloss:games.size?average([...games.values()].map(xs=>average(xs.map(x=>x.logloss)))):null};
}

export function fitRecalibration(rows){
  const seen=new Set();
  for(const r of rows){
    if(r.season!==2024) throw new Error('Only declared 2024 development rows are allowed');
    if(!r.gameId||!r.playerID||!r.market) throw new Error('Missing event/player/market identity');
    if(!Number.isFinite(r.actual)||!Number.isFinite(r.prediction)||!Number.isInteger(r.week)||r.week<4||r.week>18) throw new Error('Expected finite outcomes/predictions and regular development week');
    const key=JSON.stringify([r.gameId,r.playerID,r.market]);
    if(seen.has(key)) throw new Error(`duplicate player-market ${key}`);
    seen.add(key);
  }
  const markets={};
  for(const market of [...new Set(rows.map(r=>r.market))].sort()){
    const subset=rows.filter(r=>r.market===market);
    const fit=subset.filter(r=>r.week<=10), confirm=subset.filter(r=>r.week>=11);
    const incumbent=gameMetrics(confirm);
    const rawBias=fit.length ? -gameMetrics(fit).bias:0;
    const grid=[0,.25,.5,1].map(shrink=>({shrink,bias:rawBias*shrink,metrics:gameMetrics(fit,r=>Math.max(0,r.prediction+rawBias*shrink))}));
    grid.sort((a,b)=>(a.metrics.mae??Infinity)-(b.metrics.mae??Infinity)||a.shrink-b.shrink);
    const selected=grid[0];
    const candidate=gameMetrics(confirm,r=>Math.max(0,r.prediction+selected.bias));
    const minimumImprovement=Math.max(.01,(incumbent.mae??Infinity)*.0025);
    const enough=fit.length>=25 && confirm.length>=25 && gameMetrics(fit).games>=10 && incumbent.games>=10;
    const accepted=enough && selected.shrink>0 && incumbent.mae-candidate.mae>=minimumImprovement;
    const bias=accepted?selected.bias:0;
    markets[market]={market,bias,accepted,selectedBias:selected.bias,selectedShrink:selected.shrink,
      minimumImprovement,selection:gameMetrics(fit),incumbentConfirmation:incumbent,candidateConfirmation:candidate,
      acceptedConfirmation:gameMetrics(confirm,r=>Math.max(0,r.prediction+bias)),
      // Residuals use early development only; later data never refit the candidate.
      residuals:fit.map(r=>r.actual-Math.max(0,r.prediction+bias)).sort((a,b)=>a-b),
      reason:accepted?'Improved later development MAE; requires new prospective price validation':'Retain incumbent location; selected adjustment did not pass later development gate'};
  }
  return {version:VERSION,developmentSeason:2024,selectionWeeks:[4,10],confirmationWeeks:[11,18],
    productionEligible:false,productionWeight:0,marketCalibrationAvailable:false,
    holdoutPolicy:'2025 was previously inspected; no untouched holdout was read or rerun. New candidate requires future registration.',markets};
}

export function candidateProbability(model,prediction,line,side){
  if(!model||![prediction,line,model.bias].every(Number.isFinite)||!['over','under'].includes(side)||!model.residuals?.length) return null;
  const counts=new Set(['passing_touchdowns','receiving_receptions']);
  const discrete=new Set([...counts,'passing_yards','rushing_yards','receiving_yards']);
  const values=model.residuals.map(e=>{
    const value=Math.max(0,prediction+model.bias)+e;
    const supported=discrete.has(model.market)?Math.round(value):value;
    return counts.has(model.market)?Math.max(0,supported):supported;
  });
  const nonpush=values.filter(v=>Math.abs(v-line)>1e-9);
  if(!nonpush.length) return null;
  return nonpush.filter(v=>side==='over'?v>line:v<line).length/nonpush.length;
}

export function kickoffIso(game){
  const date=String(game.gameday||'');
  const day=Date.parse(`${date}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==date) throw new Error('Invalid schedule date');
  const tm=/^(\d{1,2}):(\d{2})$/.exec(String(game.gametime||''));
  if(!tm) return new Date(day).toISOString();
  const h=Number(tm[1]),m=Number(tm[2]);
  if(h>23||m>59) throw new Error('Invalid schedule time');
  const wall=day+h*3600000+m*60000;
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let guess=wall;
  for(let i=0;i<3;i++){
    const p=Object.fromEntries(fmt.formatToParts(new Date(guess)).map(x=>[x.type,x.value]));
    const actual=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
    const diff=wall-actual;guess+=diff;if(!diff) break;
  }
  return new Date(guess).toISOString();
}
