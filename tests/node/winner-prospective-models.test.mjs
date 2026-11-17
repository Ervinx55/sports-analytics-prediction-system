import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createWinnerModelManifest, projectWinnerBaseline, canonicalHash} from '../../sharp-service/lib/winner-prospective-models.js';
import {projectNbaGames} from '../../sharp-service/lib/nba-vnext-baseline.js';
import {buildFeatureRows, predictCandidate, kickoffIso} from '../../scripts/evaluation/nfl-winner-validation.mjs';

const report=JSON.parse(fs.readFileSync(new URL('../../docs/evaluations/winner-validation-2026-11-17/nfl-report.json',import.meta.url)));
const nbaEvent={eventID:'espn:target',startsAt:'2026-11-18T01:00:00Z',home:{id:'1',abbreviation:'ATL'},away:{id:'2',abbreviation:'BOS'}};
function nbaHistory(){return {complete:true,games:Array.from({length:4},(_,i)=>({eventId:String(i),startsAt:`2026-11-${String(8+i*2).padStart(2,'0')}T23:00:00Z`,home:'ATL',away:'BOS',homeScore:105+i,awayScore:100,completed:true}))};}

test('NBA capture preserves the released formula and excludes target/current slate and out-of-window finals',()=>{
 const history=nbaHistory(),issuedAt='2026-11-17T20:00:00Z';
 const baseline=projectNbaGames({historicalGames:history.games,upcomingGames:[{...nbaEvent,eventId:nbaEvent.eventID,home:'ATL',away:'BOS'}],asOf:issuedAt,historyComplete:true});
 const expected=projectWinnerBaseline({sport:'NBA',event:nbaEvent,history,issuedAt});
 assert.equal(expected.homeProbability,baseline.rows[0].homeWinProbability);
 const poisoned={...history,games:[...history.games,{...history.games[0],eventId:'same-slate',startsAt:'2026-11-17T12:00:00Z',homeScore:250},
   {...history.games[0],eventId:'old',startsAt:'2026-10-01T00:00:00Z',homeScore:250},
   {...history.games[0],eventId:'future',startsAt:'2026-11-18T02:00:00Z',homeScore:250}]};
 assert.equal(projectWinnerBaseline({sport:'NBA',event:nbaEvent,history:poisoned,issuedAt}).homeProbability,expected.homeProbability);
 assert.equal(expected.featureEvidence.gameIds.length,4);
 assert.throws(()=>projectWinnerBaseline({sport:'NBA',event:nbaEvent,history:{...history,complete:false},issuedAt}),/HISTORY_INCOMPLETE/);
});

function nflFixture(){
 const schedule=[],stats=[],matchups=[[['A','B'],['C','D']],[['A','C'],['B','D']],[['A','D'],['B','C']],[['A','B'],['C','D']]];
 for(const season of [2023,2024])for(let week=1;week<=4;week++)for(const [i,[home,away]] of matchups[week-1].entries()){
  const game_id=`${season}_${week}_${away}_${home}`;
  schedule.push({game_id,season:String(season),week:String(week),game_type:'REG',gameday:`${season}-09-${String(3+(week-1)*7).padStart(2,'0')}`,gametime:'13:00',home_team:home,away_team:away,home_score:String(week%2?24:17),away_score:String(i?14:21),location:'Home'});
  for(const [team,opponent_team] of [[home,away],[away,home]])stats.push({game_id,season:String(season),week:String(week),season_type:'REG',team,opponent_team,attempts:'20',sacks_suffered:'0',carries:'20',passing_epa:'4',rushing_epa:'0'});
 }
 const target=schedule.find(g=>g.game_id==='2024_4_B_A');
 const event={eventID:'nflverse:'+target.game_id,startsAt:kickoffIso(target),season:2024,week:4,gameDate:target.gameday,neutralSite:false,home:{id:'A',abbreviation:'A'},away:{id:'B',abbreviation:'B'},sourceIds:{nflverse:target.game_id}};
 return {schedule,stats,target,event};
}

test('NFL inference uses the exact 2023 frozen baseline coefficients and offline feature parity',()=>{
 const {schedule,stats,event}=nflFixture(),issuedAt='2024-09-24T15:00:00Z';
 const row=buildFeatureRows(schedule,stats).rows.find(r=>r.gameId===event.sourceIds.nflverse);
 const actual=projectWinnerBaseline({sport:'NFL',event,history:{complete:true,schedule,stats},issuedAt});
 for(const key of report.models.baseline.featureNames)assert.equal(actual.features[key],row.features[key]);
 assert.equal(actual.homeProbability,predictCandidate(report.models.baseline,row.features));
 assert.deepEqual(createWinnerModelManifest('NFL').model,report.models.baseline);
 const altered=structuredClone(schedule);
 for(const g of altered)if(g.gameday>=event.gameDate&&g.season==='2024'){g.home_score='999';g.away_score='0';g.home_qb_name='Future starter';g.home_moneyline='-9000';}
 assert.deepEqual(projectWinnerBaseline({sport:'NFL',event,history:{complete:true,schedule:altered},issuedAt}),actual);
});

test('frozen manifests have deterministic hashes and pin NBA implementation bytes',()=>{
 const manifest=createWinnerModelManifest('NBA');
 const bytes=fs.readFileSync(new URL('../../sharp-service/lib/nba-vnext-baseline.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
 assert.equal(manifest.sourceCodeSha256,createHash('sha256').update(bytes).digest('hex'));
 const {manifestHash,...body}=manifest;assert.equal(manifestHash,canonicalHash(body));
 assert.equal(manifest.productionWeight,0);assert.equal(manifest.productionEligible,false);
 assert.deepEqual(createWinnerModelManifest('NFL'),createWinnerModelManifest('NFL'));
});

test('duplicate conflicts and absent exact NFL schedule binding fail closed',()=>{
 const {schedule,event}=nflFixture(),issuedAt='2024-09-24T15:00:00Z';
 assert.throws(()=>projectWinnerBaseline({sport:'NFL',event:{...event,sourceIds:{nflverse:'other'}},history:{complete:true,schedule},issuedAt}),/TARGET_IDENTITY/);
 assert.throws(()=>projectWinnerBaseline({sport:'NFL',event,history:{complete:true,schedule:[...schedule,{...schedule[0],home_score:'999'}]},issuedAt}),/CONFLICTING_HISTORY/);
 assert.throws(()=>projectWinnerBaseline({sport:'NFL',event:{...event,startsAt:'2024-09-24T18:00:00Z'},history:{complete:true,schedule},issuedAt}),/TARGET_IDENTITY/);
});
