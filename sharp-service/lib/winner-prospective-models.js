// Independent research inference only. Never fit, select or promote a model here.
import {createHash} from 'node:crypto';
import {projectNbaGames,NBA_BASELINE_VERSION} from './nba-vnext-baseline.js';

const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,ordered(value[key])])):value;
export const canonicalHash=value=>createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const NFL_MODEL={featureNames:['homeVenue','marginDifference','adjustedMarginDifference'],
 means:[0.9776785714285714,-0.16714391372058637,-0.21220019966236997],
 standardDeviations:[0.1477267152479851,9.055525379658706,9.447657723885273],
 coefficients:[0.32612524781818325,0.11333229022254943,0.4854586924086049,0.03815609313341046],
 trainingRows:224,trainingSeason:2023,ridgeLambda:1,steps:5,converged:true};
const NBA_MODEL={homeCourtPoints:2,minimumGames:4,iterations:18,ridgeGames:7,marginClamp:45,ratingClamp:18,logisticScale:7.45,probabilityBounds:[0.02,0.98]};
const NFL_FEATURES={maximumHistoryGames:12,minimumHistoryGames:3,minimumWeek:4,recencyDecay:0.16,previousSeasonWeight:0.45,
 cutoff:'Strictly earlier Eastern calendar date and earlier season-week; opponent strength measured before each prior game.',
 missingOpponentStrength:'Zero with explicit evidence count, identical to frozen development baseline.'};
export function createWinnerModelManifest(sport){
 if(!['NBA','NFL'].includes(sport))throw Error('UNSUPPORTED_SPORT');
 const body={contract:'winner-research-model-v1',sport,
  modelVersion:sport==='NBA'?NBA_BASELINE_VERSION:'nfl-independent-ridge-baseline-2023-frozen-v1',
  model:sport==='NBA'?NBA_MODEL:NFL_MODEL,
  featureDefinition:sport==='NBA'?{priorEasternSlates:21,excludeTargetSlate:true,minimumGames:4}:NFL_FEATURES,
  sourceCodeSha256:sport==='NBA'?'7cfb863955d99c655146214fa53acb8972d70948d1c8eafd8195eff99257077b':'c07c118ea6d72da8eebadcd1a429d2946429332d24c285e9ba96402ea191f160',
  sourceCodeHashNormalization:'UTF-8 with LF line endings',
  sourceArtifact:sport==='NBA'?'sharp-service/lib/nba-vnext-baseline.js':'docs/evaluations/winner-validation-2026-11-17/nfl-report.json#models.baseline',
  coefficientsHash:canonicalHash(sport==='NBA'?NBA_MODEL:NFL_MODEL),
  probabilityTarget:sport==='NFL'?'Home win conditional on a decisive full-game result; final ties excluded.':'Home full-game win including overtime.',
  productionWeight:0,productionEligible:false,validationState:'RESEARCH_NOT_VALIDATED',lineupAdjustmentApplied:false};
 return structuredClone({...body,manifestHash:canonicalHash(body)});
}
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const easternDay=iso=>dayFormat.format(new Date(iso));
const numeric=x=>x===null||x===undefined||String(x).trim()===''?null:Number.isFinite(Number(x))?Number(x):null;
const score=x=>Number.isInteger(numeric(x))&&numeric(x)>=0&&numeric(x)<=250?numeric(x):null;
function unique(rows,key){
 const map=new Map();
 for(const row of rows||[]){const id=row[key];if(!id)throw Error('MISSING_HISTORY_IDENTITY');
  if(map.has(id)&&canonicalHash(map.get(id))!==canonicalHash(row))throw Error('CONFLICTING_HISTORY');
  map.set(id,row);
 }return [...map.values()];
}
function nbaProjection(event,history,issuedAt){
 const targetDay=easternDay(event.startsAt),oldest=Date.parse(targetDay)-21*86400000;
 const games=unique(history.games,'eventId').filter(g=>g.completed===true&&Number.isFinite(Date.parse(g.startsAt))&&
  Date.parse(g.startsAt)<Date.parse(issuedAt)&&easternDay(g.startsAt)<targetDay&&Date.parse(easternDay(g.startsAt))>=oldest);
 if(games.some(g=>!g.home||!g.away||g.home===g.away||score(g.homeScore)===null||score(g.awayScore)===null||Number(g.homeScore)===Number(g.awayScore)))throw Error('INVALID_HISTORY_FINAL');
 const result=projectNbaGames({historicalGames:games,upcomingGames:[{eventId:event.eventID,startsAt:event.startsAt,home:event.home.abbreviation,away:event.away.abbreviation}],asOf:issuedAt,historyComplete:true}).rows[0];
 if(!result||!Number.isFinite(result.homeWinProbability))throw Error('INSUFFICIENT_PRIOR_HISTORY');
 return {homeProbability:result.homeWinProbability,features:{projectedHomeMargin:result.projectedHomeMargin},
  featureEvidence:{gameIds:games.map(g=>g.eventId).sort(),gamesSampled:result.gamesSampled,cutoffEasternDay:targetDay,historyCalendarDays:21}};
}
// nflverse stores game time in Eastern local time; verify the target instant exactly.
function nflKickoff(game){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(game.gameday||'')||!/^\d{2}:\d{2}$/.test(game.gametime||''))return null;
 const [year,month,day]=game.gameday.split('-').map(Number),[hour,minute]=game.gametime.split(':').map(Number);
 const desired=Date.UTC(year,month-1,day,hour,minute),format=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 let utc=desired;for(let i=0;i<3;i++){const p=Object.fromEntries(format.formatToParts(new Date(utc)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  const actual=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);if(actual===desired)return new Date(utc).toISOString();utc+=desired-actual;}return null;
}
function nflProjection(event,history){
 const schedule=unique(history.schedule,'game_id'),target=schedule.find(g=>g.game_id===event.sourceIds?.nflverse);
 const season=Number(event.season),week=Number(event.week),date=event.gameDate;
 if(!target||target.game_type!=='REG'||!Number.isInteger(season)||!Number.isInteger(week)||week<NFL_FEATURES.minimumWeek||
  Number(target.season)!==season||Number(target.week)!==week||target.gameday!==date||
  target.home_team!==event.home.abbreviation||target.away_team!==event.away.abbreviation||
  !['home','neutral'].includes(String(target.location).toLowerCase())||
  (String(target.location).toLowerCase()==='neutral')!==event.neutralSite||Date.parse(nflKickoff(target))!==Date.parse(event.startsAt))throw Error('TARGET_IDENTITY_UNVERIFIED');
 const completed=g=>score(g.home_score)!==null&&score(g.away_score)!==null;
 const prior=(team,s,d,w)=>schedule.filter(g=>g.game_type==='REG'&&[s,s-1].includes(Number(g.season))&&g.gameday<d&&completed(g)&&
  (Number(g.season)<s||Number(g.week)<w)&&[g.home_team,g.away_team].includes(team))
  .sort((a,b)=>b.gameday.localeCompare(a.gameday)||a.game_id.localeCompare(b.game_id)).slice(0,12);
 const weighted=(rows,value,s)=>{let total=0,weight=0;rows.forEach((g,i)=>{const w=Math.exp(-0.16*i)*(Number(g.season)===s?1:0.45);total+=w*value(g);weight+=w;});return weight?total/weight:null;};
 const margin=(g,t)=>(Number(g.home_score)-Number(g.away_score))*(g.home_team===t?1:-1);
 const home=prior(event.home.abbreviation,season,date,week),away=prior(event.away.abbreviation,season,date,week);
 if(Math.min(home.length,away.length)<3)throw Error('INSUFFICIENT_PRIOR_HISTORY');
 const strengthIds=new Set();let opponentStrengthMissing=0;
 const adjusted=(g,t)=>{const other=g.home_team===t?g.away_team:g.home_team,rows=prior(other,Number(g.season),g.gameday,Number(g.week));
  rows.forEach(row=>strengthIds.add(row.game_id));const strength=weighted(rows,row=>margin(row,other),Number(g.season));if(strength===null)opponentStrengthMissing++;return margin(g,t)+(strength??0);};
 const features={homeVenue:event.neutralSite?0:1,
  marginDifference:weighted(home,g=>margin(g,event.home.abbreviation),season)-weighted(away,g=>margin(g,event.away.abbreviation),season),
  adjustedMarginDifference:weighted(home,g=>adjusted(g,event.home.abbreviation),season)-weighted(away,g=>adjusted(g,event.away.abbreviation),season)};
 const x=[1,...NFL_MODEL.featureNames.map((key,i)=>(features[key]-NFL_MODEL.means[i])/NFL_MODEL.standardDeviations[i])];
 if(x.some(v=>!Number.isFinite(v)))throw Error('INVALID_FEATURES');
 const z=x.reduce((sum,value,i)=>sum+value*NFL_MODEL.coefficients[i],0),p=z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
 return {homeProbability:Math.max(1e-12,Math.min(1-1e-12,p)),features,
  featureEvidence:{scheduleGameIds:[...new Set([...home,...away].map(g=>g.game_id))].sort(),opponentStrengthGameIds:[...strengthIds].sort(),
   homeHistoryGames:home.length,awayHistoryGames:away.length,opponentStrengthMissing,cutoffEasternDay:date,cutoffWeek:week}};
}
export function projectWinnerBaseline({sport,event,history,issuedAt}){
 if(history?.complete!==true)throw Error('HISTORY_INCOMPLETE');
 if(!Number.isFinite(Date.parse(issuedAt))||!Number.isFinite(Date.parse(event?.startsAt))||Date.parse(issuedAt)>=Date.parse(event.startsAt))throw Error('NOT_PREGAME');
 if(sport==='NBA')return nbaProjection(event,history,issuedAt);
 if(sport==='NFL')return nflProjection(event,history);
 throw Error('UNSUPPORTED_SPORT');
}
