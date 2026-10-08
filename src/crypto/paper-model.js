// Research-only baseline. Probabilities are NOT calibrated; never label these as a betting edge.
function normalCdf(x) {
  const t=1/(1+0.2316419*Math.abs(x));
  const d=0.3989422804014327*Math.exp(-x*x/2);
  const p=1-d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x>=0?p:1-p;
}
function evaluate({candles,target,secondsRemaining,yesAsk,noAsk,fee=0}) {
  if (!Array.isArray(candles)||candles.length<15||!Number.isFinite(target)||target<=0||!Number.isFinite(secondsRemaining)||secondsRemaining<=0) return {grade:"PASS",reason:"Insufficient or invalid data"};
  const rows=[...candles].sort((a,b)=>a.time-b.time);
  const returns=rows.slice(1).map((c,i)=>Math.log(c.close/rows[i].close));
  if(returns.some(x=>!Number.isFinite(x))) return {grade:"PASS",reason:"Invalid prices"};
  const mu=returns.reduce((a,b)=>a+b,0)/returns.length;
  const variance=returns.reduce((a,b)=>a+(b-mu)**2,0)/Math.max(1,returns.length-1);
  const sigma=Math.sqrt(variance);
  if(sigma<1e-8) return {grade:"PASS",reason:"Insufficient measured volatility"};
  const minutes=secondsRemaining/60;
  const z=(Math.log(rows.at(-1).close/target)+mu*minutes)/(sigma*Math.sqrt(minutes));
  const yesProbability=normalCdf(z);
  const noProbability=1-yesProbability;
  // Estimates are exploratory only. Block paper signals until validated on held-out rounds.
  return {grade:"PASS",reason:"Uncalibrated baseline; paper observation only",yesProbability,noProbability,yesAsk,noAsk,fee,model:"log-return-normal-v0",validated:false};
}
module.exports={evaluate,normalCdf};
