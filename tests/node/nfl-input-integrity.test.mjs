import test from 'node:test';
import assert from 'node:assert/strict';
import {qbAvailabilityContext} from '../../sharp-service/lib/nfl-model.js';
const base={schedule:[],season:2026,team:'SEA',game:{gameday:'2026-10-11',home_qb_name:'Listed QB'},side:'home',forecastAt:'2026-10-11T12:00:00Z'};
const chart=(dt,name='Listed QB')=>({team:'SEA',pos_abb:'QB',pos_rank:'1',dt,player_name:name});
test('future, undated and invalid charts cannot provide QB evidence',()=>{
 for(const dt of ['2026-10-12','', 'invalid']) {
  const result=qbAvailabilityContext({...base,depthCharts:[chart(dt)]});
  assert.equal(result.depthChartQb1,null);
  assert.equal(result.status,'UNRESOLVED');
  assert.equal(result.adjustmentPoints,0);
 }
});
test('conflicting QB names remain unresolved without directional penalty',()=>{
 const result=qbAvailabilityContext({...base,depthCharts:[chart('2026-10-10','Other QB')]});
 assert.equal(result.expected,null);assert.equal(result.status,'CONFLICTING');assert.equal(result.adjustmentPoints,0);
});
test('agreeing valid chart is usable as of explicit cutoff',()=>{
 const result=qbAvailabilityContext({...base,depthCharts:[chart('2026-10-10'),chart('2026-10-12','Future QB')]});
 assert.equal(result.depthChartQb1,'Listed QB');assert.equal(result.status,'AGREEING');
});
test('missing forecast time never defaults to current wall clock',()=>{
 const result=qbAvailabilityContext({...base,forecastAt:null,depthCharts:[chart('2026-10-10')]});
 assert.equal(result.depthChartQb1,null);assert.equal(result.status,'UNRESOLVED');
});
import {projectEvent,teamSnapshot,leagueBaselines} from '../../sharp-service/lib/nfl-model.js';
function projectionOptions() {
 const snapshots=new Map(['SEA','SF'].map(team=>[team,{...teamSnapshot([],[],2026,team),currentSeasonGames:10,statGames:10}]));
 const market=(line=null)=>({consensus:{odds:-110,line},books:{a:{odds:110,line},b:{odds:110,line},c:{odds:110,line},d:{odds:110,line}}});
 return {event:{eventID:'integrity',startsAt:'2026-10-11T20:00:00Z',matchup:{home:{name:'Seattle Seahawks'},away:{name:'San Francisco 49ers'}},markets:{moneyline:{home:market(),away:market()},total:{over:market(20.5),under:market(20.5)}}},schedule:[{season:'2026',gameday:'2026-10-11',home_team:'SEA',away_team:'SF',home_qb_name:'Listed QB',away_qb_name:'Away QB',home_rest:'7',away_rest:'7'}],stats:[],snapshots,baseline:leagueBaselines([...snapshots.values()]),season:2026,forecastAt:base.forecastAt,simulationIterations:10,depthCharts:[chart('2026-10-10'),{...chart('2026-10-10','Away QB'),team:'SF'}]};
}
test('strong shadow edge is blocked by unresolved QB evidence with a displayed reason',()=>{
 const opts=projectionOptions();
 const agreeing=projectEvent(opts);assert.ok(agreeing.markets.some(row=>row.shadowStatus==='PLAY'));
 for(const depthCharts of [[],[chart('2026-10-10','Other QB')]]) {
  const unresolved=projectEvent({...opts,depthCharts});
  assert.ok(unresolved.model.dataQuality>=.68);
  assert.ok(unresolved.markets.every(row=>row.shadowStatus==='PASS' && /QB evidence/.test(row.reason)));
  assert.equal(unresolved.model.qbAdjustmentPoints,0);
  const ml=unresolved.markets.find(row=>row.marketType==='moneyline');assert.equal(ml.modelProbability,ml.marketFairProbability);
 }
});
test('historical availability disable flag preserves no adjustment even for agreeing changed QB',()=>{
 const opts=projectionOptions();opts.schedule.unshift({season:'2026',game_type:'REG',gameday:'2026-10-04',home_team:'SEA',away_team:'SF',home_score:'21',away_score:'20',home_qb_name:'Previous QB'});
 const result=projectEvent({...opts,disableAvailabilityAdjustments:true});
 assert.equal(result.gameContext.availability.home.changedFromPrior,true);
 assert.equal(result.model.qbAdjustmentPoints,0);assert.equal(result.model.availabilityAdjustmentsDisabled,true);
});
test('date-only chart is withheld until its conservatively assumed publication time',()=>{
 assert.equal(qbAvailabilityContext({...base,depthCharts:[chart('2026-10-11')]}).depthChartQb1,null);
 assert.equal(qbAvailabilityContext({...base,depthCharts:[chart('2026-10-11T11:00:00Z')]}).depthChartQb1,'Listed QB');
 for(const dt of ['2026-02-30','2026-10-10T99:00:00Z']) assert.equal(qbAvailabilityContext({...base,depthCharts:[chart(dt)]}).depthChartQb1,null);
});
test('equal-ranked contradictory chart rows are unresolved rather than chosen by row order',()=>{
 assert.equal(qbAvailabilityContext({...base,depthCharts:[chart('2026-10-10'),chart('2026-10-10','Other QB')]}).status,'CONFLICTING');
});

test('postgame capture cannot supply live QB evidence to a historical projection',()=>{
 const result=projectEvent({...projectionOptions(),forecastAt:'2026-10-13T12:00:00Z'});
 assert.equal(result.gameContext.availability.home.status,'UNRESOLVED');
 assert.equal(result.model.qbAdjustmentPoints,0);
});
const invalidRanks=['2','',undefined,null,'not-a-rank','Infinity',Infinity,NaN,'0','-1','1.5','0x1','1e0'];
for(const rank of invalidRanks) test(`nonstarter or invalid rank ${String(rank)} cannot corroborate a QB1`,()=>{
 const row={...chart('2026-10-10'),pos_rank:rank};
 if(rank===undefined) delete row.pos_rank;
 const result=qbAvailabilityContext({...base,depthCharts:[row]});
 assert.equal(result.depthChartQb1,null);assert.equal(result.expected,null);
 assert.equal(result.status,'UNRESOLVED');assert.equal(result.adjustmentPoints,0);
});
test('newest eligible chart without QB1 cannot fall back to older starter',()=>{
 const result=qbAvailabilityContext({...base,depthCharts:[chart('2026-10-09'),{...chart('2026-10-10'),pos_rank:'2'}]});
 assert.equal(result.depthChartTimestamp,'2026-10-10');assert.equal(result.depthChartQb1,null);
 assert.equal(result.expected,null);assert.equal(result.status,'UNRESOLVED');assert.equal(result.adjustmentPoints,0);
});
test('invalid starter ranks block high-edge shadow plays while the other team agrees',()=>{
 const opts=projectionOptions();assert.ok(projectEvent(opts).markets.some(row=>row.shadowStatus==='PLAY'));
 for(const rank of invalidRanks) {
  const result=projectEvent({...opts,depthCharts:[{...chart('2026-10-10'),pos_rank:rank},opts.depthCharts[1]]});
  assert.equal(result.gameContext.availability.away.status,'AGREEING');
  assert.ok(result.markets.every(row=>row.shadowStatus==='PASS' && /QB evidence/.test(row.reason)));
  assert.equal(result.model.qbAdjustmentPoints,0);
 }
});
