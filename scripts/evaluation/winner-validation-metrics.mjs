// Offline binary winner evaluation. No application imports this research module.
const EPSILON=1e-12;
function score(probability,outcome) {
 if(typeof probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1||![0,1].includes(outcome)) throw new Error('Expected finite probability in [0,1] and a binary outcome; handle ties explicitly');
 const p=Math.max(EPSILON,Math.min(1-EPSILON,probability));
 return {brier:(probability-outcome)**2,logloss:-outcome*Math.log(p)-(1-outcome)*Math.log1p(-p)};
}
export function metrics(predictions) {
 const calibration=Array.from({length:10},(_,i)=>({lower:i/10,upper:(i+1)/10,n:0,mean:null,observed:null}));
 let brier=0,logloss=0,correct=0;
 for(const {probability,outcome} of predictions){
  const s=score(probability,outcome);brier+=s.brier;logloss+=s.logloss;
  correct+=probability===.5?.5:Number((probability>.5)===Boolean(outcome));
  const bin=calibration[Math.min(9,Math.floor(probability*10))];
  bin.n++;bin.mean=(bin.mean??0)+probability;bin.observed=(bin.observed??0)+outcome;
 }
 for(const bin of calibration)if(bin.n){bin.mean/=bin.n;bin.observed/=bin.n;}
 const n=predictions.length;
 return {n,brier:n?brier/n:null,logloss:n?logloss/n:null,accuracy:n?correct/n:null,
  expectedCalibrationError:n?calibration.reduce((sum,b)=>sum+b.n*(b.n?Math.abs(b.mean-b.observed):0),0)/n:null,calibration};
}
function rng(seed){let value=seed>>>0;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
function quantile(sorted,p){const index=(sorted.length-1)*p,lo=Math.floor(index),hi=Math.ceil(index);return sorted[lo]+(sorted[hi]-sorted[lo])*(index-lo);}
// Resample entire dates/weeks with replacement, preserving paired models and
// within-block dependence. Score game-weighted, not an unweighted mean of dates.
// Intervals are descriptive development uncertainty, not promotion tests.
export function pairedBlockBootstrap(rows,candidateKey,baselineKey='baseline',{iterations=2000,seed=20261117}={}) {
 if(!Number.isInteger(iterations)||iterations<100||!Number.isInteger(seed)) throw new Error('Invalid bootstrap parameters');
 const blocks=new Map();let totalBrier=0,totalLogloss=0;
 for(const row of rows){
  if(row.block===null||row.block===undefined||row.block==='')throw new Error('Every row needs a date/week block');
  const a=score(row[candidateKey],row.outcome),b=score(row[baselineKey],row.outcome);
  const block=blocks.get(row.block)||{n:0,brier:0,logloss:0};
  block.n++;block.brier+=a.brier-b.brier;block.logloss+=a.logloss-b.logloss;
  totalBrier+=a.brier-b.brier;totalLogloss+=a.logloss-b.logloss;blocks.set(row.block,block);
 }
 const n=rows.length,result={n,blocks:blocks.size,iterations,seed,confidence:.95,
  brier:{delta:n?totalBrier/n:null,lower:null,upper:null},logloss:{delta:n?totalLogloss/n:null,lower:null,upper:null}};
 if(blocks.size<2)return result;
 const samples={brier:[],logloss:[]},values=[...blocks.values()],random=rng(seed);
 for(let i=0;i<iterations;i++){
  let count=0,brier=0,logloss=0;
  for(let k=0;k<values.length;k++){const selected=values[Math.floor(random()*values.length)];count+=selected.n;brier+=selected.brier;logloss+=selected.logloss;}
  samples.brier.push(brier/count);samples.logloss.push(logloss/count);
 }
 for(const key of ['brier','logloss']){samples[key].sort((a,b)=>a-b);result[key].lower=quantile(samples[key],.025);result[key].upper=quantile(samples[key],.975);}
 return result;
}
