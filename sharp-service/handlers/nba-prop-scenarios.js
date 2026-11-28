import {explanationSnapshot} from '../lib/nba-explanation-snapshot.js';
import {nbaScenarioTargets,nbaScenarioHistory} from '../lib/nba-scenario-history.js';
import {buildNbaJointScenarios} from '../lib/nba-joint-scenarios.js';

const MARKETS=new Set(['points','rebounds','assists','points_assists','points_rebounds',
  'rebounds_assists','points_rebounds_assists']);
const DIRECTIONS=new Set(['over','under','at_least','at_most']);
function numbers(value,limit){
  if(typeof value!=='string'||value.length>180)return null;
  const entries=value.split(',').map(x=>x.trim());
  if(!entries.length||entries.length>limit||entries.some(x=>!/^\d+(?:\.\d+)?$/.test(x)))return null;
  return entries.map(Number);
}

export function createNbaPropScenariosHandler({readSnapshot=explanationSnapshot,clock=()=>new Date().toISOString()}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store');
    const send=(code,data)=>res.status(code).json(data);
    if(req.method!=='GET'){res.setHeader('Allow','GET');return send(405,{error:'GET only'});}
    if(req.query?.live!=='1')return send(200,{status:'NOT_REQUESTED',productionEligible:false,
      message:'Load player history to calculate joint statistics and playing-time scenarios.'});
    const query=req.query??{},eventID=query.eventId,playerID=query.playerId;
    const catalogOnly=eventID===undefined&&playerID===undefined;
    if(!catalogOnly&&(![eventID,playerID].every(x=>typeof x==='string'&&x.length>0&&x.length<=180)))
      return send(400,{error:'An exact eventId and playerId are required.'});
    let thresholds=[],minutesScenarios=[],market,direction;
    if(!catalogOnly){
      market=query.market??'points';direction=query.direction??'at_least';
      const values=numbers(query.thresholds,12);
      const minutes=query.minutes===undefined||query.minutes===''?[]:numbers(query.minutes,5);
      if(!MARKETS.has(market)||!DIRECTIONS.has(direction)||!values||
         values.some(x=>x<0||x>300)||new Set(values).size!==values.length||!minutes||
         minutes.some(x=>x<=0||x>48)||new Set(minutes).size!==minutes.length)
        return send(400,{error:'Provide a supported statistic, 1–12 distinct thresholds (0–300), and optionally 1–5 distinct minutes assumptions (above 0 and at most 48).'});
      thresholds=values.map(threshold=>({threshold,direction}));minutesScenarios=minutes;
    }
    let snapshot;
    try{snapshot=await readSnapshot();}catch{return send(503,{status:'SOURCE_UNAVAILABLE',productionEligible:false,error:'Matched player history is temporarily unavailable.'});}
    const asOf=clock();
    if(catalogOnly){
      const catalog=nbaScenarioTargets(snapshot,asOf);
      return send(catalog.status==='SOURCE_UNAVAILABLE'?503:200,{...catalog,asOf,
        contract:'nba-scenario-targets-v1',productionEligible:false});
    }
    let inputs;
    try{inputs=nbaScenarioHistory(snapshot,{eventID,playerID,asOf});}
    catch{return send(503,{status:'SOURCE_UNAVAILABLE',productionEligible:false,error:'Matched player history could not be verified.'});}
    if(inputs.status!=='AVAILABLE')return send(inputs.status==='TARGET_UNAVAILABLE'?404:503,
      {status:inputs.status,productionEligible:false,error:inputs.status==='TARGET_UNAVAILABLE'?
        'This player and upcoming game do not have a unique current roster match.':'Matched player history is temporarily unavailable.'});
    const report=buildNbaJointScenarios({rows:inputs.rows,target:inputs.target,asOf,
      market,thresholds,minutesScenarios});
    return send(report.status==='INVALID_INPUT'?400:200,{...report,sourceValidation:inputs.sourceValidation});
  };
}
export default createNbaPropScenariosHandler();
