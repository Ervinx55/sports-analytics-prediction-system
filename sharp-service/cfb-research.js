// Research forecasts and executable book comparisons have separate eligibility.
export function currentCfbForecasts(payload,now=Date.now()){
 const age=now-Date.parse(payload?.generatedAt);
 if(payload?.contract!=='cfb-research-v1'||payload.status!=='RESEARCH_NOT_CLEARED'||!Number.isFinite(age)||age<0||age>30*60000||!Array.isArray(payload.forecasts))return [];
 const ids=new Set(),duplicates=new Set();for(const f of payload.forecasts){if(ids.has(f.eventID))duplicates.add(f.eventID);ids.add(f.eventID);}
 return payload.forecasts.filter(f=>{
  const generated=Date.parse(f.generatedAt),cutoff=Date.parse(f.inputCutoff);
  return f.eventID&&f.homeID&&f.awayID&&f.homeID!==f.awayID&&!duplicates.has(f.eventID)&&f.marketType==='moneyline'&&f.period==='game'&&Date.parse(f.startsAt)>now&&f.modelVersion===payload.modelVersion&&f.productionEligible===false&&f.homeProbability>0&&f.homeProbability<1&&f.awayProbability>0&&f.awayProbability<1&&Math.abs(f.homeProbability+f.awayProbability-1)<=1e-9&&Number.isFinite(cutoff)&&cutoff<=generated&&Number.isFinite(generated)&&generated<=Date.parse(payload.generatedAt)&&now-generated>=0&&now-generated<=30*60000;
 });
}
export function attachCfbForecasts(rows,payload,now=Date.now()){
 const byID=new Map(currentCfbForecasts(payload,now).map(f=>[f.eventID,f]));
 return rows.map(row=>{
  const f=byID.get(row.eventID),side=row.side==='HOME'?'home':row.side==='AWAY'?'away':null;
  if(!f||f.quoteComparisonEligible===false||row.kind!=='games'||row.league!=='NCAAF'||row.provider!=='SportsGameOdds'||row.marketType!=='moneyline'||row.period!=='game'||!side||row.homeID!==f.homeID||row.awayID!==f.awayID||row.participant!==f[side+'ID']||Date.parse(row.startsAt)!==Date.parse(f.startsAt))return row;
  return {...row,model:f[side+'Probability'],status:'RESEARCH',productionEligible:false,cfbForecast:f,reason:'Independent CFB winner estimate. Research only; not approved for PLAY.'};
 });
}
