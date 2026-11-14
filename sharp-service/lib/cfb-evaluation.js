import {createHash} from 'node:crypto';
import {forecastGames,scoreForecasts,MODEL_FAMILY} from './cfb-model.js';
export const CFB_MANIFEST=Object.freeze({family:MODEL_FAMILY,warmupSeason:2024,developmentSeason:2025,holdoutSeason:2026,holdoutEndExclusive:'2026-11-14T06:00:00.000Z',availabilityRule:'next UTC midnight after kickoff plus 12 hours',minimumGames:8,historyMonths:18,snapshotRule:'first valid 24h to 30m pregame',grid:[16,24,32].flatMap(k=>[0,35,65].flatMap(homeAdvantage=>[0.5,0.75].map(carry=>({k,homeAdvantage,carry}))))});
export const contentHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function evaluateCandidates(source){
 const common={manifest:CFB_MANIFEST,productionEligible:false,mode:'RESEARCH',marketComparison:{n:0,status:'MISSING_TIMESTAMPED_HISTORICAL_PRICES'},roi:null};
 if(source.complete!==true||![2024,2025,2026].every(s=>source.membership?.[s]?.length&&source.games?.some(g=>g.season===s)))return {...common,status:'BLOCKED',reasons:['INCOMPLETE_HISTORY_COVERAGE']};
 const games=[...source.games].sort((a,b)=>a.id.localeCompare(b.id));
 const development=games.filter(g=>g.season===2025&&g.completed&&Number.isInteger(g.homeScore)&&Number.isInteger(g.awayScore)&&g.homeScore!==g.awayScore&&!g.cancelled);
 const holdout=games.filter(g=>g.season===2026&&Date.parse(g.startsAt)<Date.parse(CFB_MANIFEST.holdoutEndExclusive)&&g.completed&&Number.isInteger(g.homeScore)&&Number.isInteger(g.awayScore)&&g.homeScore!==g.awayScore&&!g.cancelled);
 const outcomes=new Map(games.map(g=>[g.id,g.homeScore>g.awayScore?1:0]));
 const evaluate=(targets,config)=>{const result=forecastGames(games,targets,config);const rows=result.forecasts.map(f=>({eventID:f.espnEventID,probability:f.homeProbability,outcome:outcomes.get(f.espnEventID)}));return {...scoreForecasts(rows),rows,excluded:result.excluded,distinctTeams:new Set(targets.filter(g=>rows.some(r=>r.eventID===g.id)).flatMap(g=>[g.homeID,g.awayID])).size};};
 const candidates=CFB_MANIFEST.grid.map(config=>({config,result:evaluate(development,config)}));
 candidates.sort((a,b)=>(a.result.logLoss??Infinity)-(b.result.logLoss??Infinity)||a.config.homeAdvantage-b.config.homeAdvantage||a.config.k-b.config.k||a.config.carry-b.config.carry);
 const best=candidates[0];if(!best.result.n||!holdout.length)return {...common,status:'BLOCKED',reasons:['INSUFFICIENT_EVALUATION_GAMES']};
 const developmentHash=contentHash(games.filter(g=>g.season<=2025).map(({fetchedAt,...g})=>g));
 const modelVersion=MODEL_FAMILY+'-'+contentHash({manifest:CFB_MANIFEST,config:best.config,developmentHash}).slice(0,16);
 const report=evaluate(holdout,best.config),homeRate=best.result.rows.reduce((s,r)=>s+r.outcome,0)/best.result.n;
 return {...common,status:'RETROSPECTIVE_COMPLETE_NOT_APPROVED',modelVersion,config:best.config,developmentHash,holdoutHash:contentHash(holdout),sourceHash:contentHash(games),development:best.result,holdout:report,baselines:{coinFlip:scoreForecasts(report.rows.map(r=>({...r,probability:0.5}))),developmentHomeRate:{probability:homeRate,...scoreForecasts(report.rows.map(r=>({...r,probability:homeRate})))}},candidates:candidates.map(c=>({config:c.config,n:c.result.n,brier:c.result.brier,logLoss:c.result.logLoss})),limitations:['Retrospective reconstruction; original pregame source snapshots unavailable.','No verified historical book-price benchmark or betting ROI.','No quarterback, injury, weather or separate defensive-efficiency features.','Prospective evidence and explicit model approval remain required.']};
}
