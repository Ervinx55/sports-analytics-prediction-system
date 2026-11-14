export function attachCfbForecasts(rows,payload,now=Date.now()){
 const age=now-Date.parse(payload?.generatedAt);
 if(payload?.contract!=='cfb-research-v1'||payload.status!=='RESEARCH_NOT_CLEARED'||!Number.isFinite(age)||age<0||age>30*60000||!Array.isArray(payload.forecasts))return rows;
 const byID=new Map(),duplicates=new Set();for(const f of payload.forecasts){if(byID.has(f.eventID))duplicates.add(f.eventID);byID.set(f.eventID,f);}
 return rows.map(row=>{
  const f=byID.get(row.eventID),side=row.side==='HOME'?'home':row.side==='AWAY'?'away':null;
  if(!f||duplicates.has(row.eventID)||row.kind!=='games'||row.league!=='NCAAF'||row.provider!=='SportsGameOdds'||row.marketType!=='moneyline'||row.period!=='game'||!side||f.marketType!=='moneyline'||f.period!=='game'||row.homeID!==f.homeID||row.awayID!==f.awayID||row.participant!==f[side+'ID']||Date.parse(row.startsAt)!==Date.parse(f.startsAt)||Date.parse(f.startsAt)<=now||f.modelVersion!==payload.modelVersion||f.productionEligible!==false||!(f.homeProbability>0&&f.homeProbability<1&&f.awayProbability>0&&f.awayProbability<1)||Math.abs(f.homeProbability+f.awayProbability-1)>1e-9||!Number.isFinite(Date.parse(f.inputCutoff))||Date.parse(f.inputCutoff)>Date.parse(payload.generatedAt)||!Number.isFinite(Date.parse(f.generatedAt))||Date.parse(f.generatedAt)>Date.parse(payload.generatedAt)||now-Date.parse(f.generatedAt)>30*60000)return row;
  return {...row,model:f[side+'Probability'],status:'RESEARCH',productionEligible:false,cfbForecast:f,reason:'Independent CFB winner estimate. Research only; not approved for PLAY.'};
 });
}
