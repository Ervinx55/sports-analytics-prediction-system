const finite=x=>typeof x==='number'&&Number.isFinite(x);
const at=x=>typeof x==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(x)?Date.parse(x):NaN;
export function probabilityForecast(artifact,market,mean,line,side,issuedAt){
 const policy=artifact?.policy,grid=artifact?.markets?.[market]?.residualQuantiles;
 if(policy?.version!=='nba-baseline-probability-v1'||policy.productionWeight!==0||policy.productionEligible!==false||policy.condition!=='POSITIVE_MINUTE_PARTICIPATION'||policy.meanModel!=='LAST_TEN_SAME_TEAM_BASELINE'||!Number.isFinite(at(issuedAt))||!Number.isFinite(at(policy.frozenAt))||!Number.isFinite(at(policy.trainedBefore))||at(policy.frozenAt)>at(issuedAt)||at(policy.trainedBefore)>at(issuedAt)||!Array.isArray(grid)||grid.length!==201||grid.some((z,i)=>!finite(z)||(i>0&&z<grid[i-1])))throw Error('INVALID_PROBABILITY_ARTIFACT');
 if(!finite(mean)||mean<0||mean>1000||!finite(line)||line<0||line>1000||!['OVER','UNDER'].includes(side))throw Error('INVALID_PROBABILITY_REQUEST');
 const scale=Math.sqrt(Math.max(mean,1)),counts={under:0,push:0,over:0};
 for(const z of grid){const value=Math.max(0,Math.floor(mean+scale*z+.5));counts[value<line?'under':value>line?'over':'push']++;}
 const under=counts.under/grid.length,push=counts.push/grid.length,over=counts.over/grid.length,win=side==='OVER'?over:under;
 return {version:policy.version,meanModel:policy.meanModel,condition:policy.condition,under,push,over,winProbability:win,modelProbability:push<1?win/(1-push):null,probabilityBasis:'CONDITIONAL_ON_PARTICIPATION_AND_NO_PUSH',status:'EXPERIMENTAL_UNVALIDATED',productionEligible:false,productionWeight:0};
}
