import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeEspnGame, normalizeEspnSummary, repairEspnIdentity } from '../../scripts/nba/import-espn-history.mjs';
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/espn-nba-summary.json','utf8'));
test('ESPN final boxscore maps to NBA backtest schema and reconciles scores',()=>{
  const {game,rows}=normalizeEspnSummary(fixture,2024);
  assert.equal(game.home_team.abbreviation,'BOS');
  assert.equal(game.visitor_team.abbreviation,'NYK');
  assert.equal(game.home_team_score,132);
  assert.equal(game.visitor_team_score,109);
  assert.equal(game.datetime,'2024-10-22T23:30:00.000Z');
  const tatum=rows.find(r=>r.player.last_name==='Tatum');
  assert.equal(tatum.pts,37);
  assert.equal(tatum.fg3m,8);
  assert.equal(tatum.ast,10);
  assert.equal(tatum.game.season,2024);
});
test('ESPN importer rejects another season and incomplete or nonfinal games',()=>{
  assert.equal(normalizeEspnGame(fixture.header,2025),null);
  const future=structuredClone(fixture.header);
  future.competitions[0].status.type.completed=false;
  assert.equal(normalizeEspnGame(future,2024),null);
  const broken=structuredClone(fixture);
  broken.boxscore.players[0].statistics[0].athletes[0].stats[1]='999';
  assert.throws(()=>normalizeEspnSummary(broken,2024),/reconcile/);
});


test('ESPN zero-minute nonparticipants do not create fake player observations',()=>{
  const data=structuredClone(fixture);
  const group=data.boxscore.players[0].statistics[0];
  group.athletes.push({athlete:{id:'999',displayName:'No Appearance'},didNotPlay:false,
    stats:group.labels.map(label=>label==='MIN'?'--':['FG','3PT','FT'].includes(label)?'0-0':'0')});
  assert.ok(!normalizeEspnSummary(data,2024).rows.some(row=>row.player.id===999));
});


test('NBA Cup championship is excluded even when ESPN labels it regular season',()=>{
  const event=structuredClone(fixture.header);
  event.competitions[0].type={type:'commissioners-cup'};
  assert.equal(normalizeEspnGame(event,2024),null);
});

test('ESPN missing non-scoring stats or player identities cannot silently alter the sample',()=>{
  const missing=structuredClone(fixture);
  const group=missing.boxscore.players[0].statistics[0];
  group.athletes[0].stats[group.labels.indexOf('REB')]='';
  assert.throws(()=>normalizeEspnSummary(missing,2024),/Invalid ESPN player stats/);
  const identity=structuredClone(fixture);
  delete identity.boxscore.players[0].statistics[0].athletes[0].athlete.id;
  assert.throws(()=>normalizeEspnSummary(identity,2024),/identity/);
  const duplicate=structuredClone(fixture);
  duplicate.boxscore.players[0].statistics[0].athletes.push(duplicate.boxscore.players[0].statistics[0].athletes[0]);
  assert.throws(()=>normalizeEspnSummary(duplicate,2024),/Duplicate/);
});

test('ESPN obsolete identity repair uses canonical game stats and retains correction provenance',async()=>{
  const raw=JSON.parse(fs.readFileSync('tests/fixtures/espn-nba-identity-stats.json','utf8'));
  const labels=['MIN','PTS','FG','3PT','FT','REB','AST','TO','STL','BLK','OREB','DREB','PF','+/-'];
  const input={header:{id:'401810150'},boxscore:{players:[{team:{id:'4'},statistics:[{labels,athletes:[{athlete:{shortName:'Olbrich'},didNotPlay:false,stats:[]}]}]}]}};
  const request=async url=>url.includes('/roster/')?raw:{id:'5107156',displayName:'Lachlan Olbrich'};
  const result=await repairEspnIdentity(input,2025,request);
  const entry=result.payload.boxscore.players[0].statistics[0].athletes[0];
  assert.equal(entry.athlete.id,'5107156');
  assert.deepEqual(entry.stats.slice(0,3),['11','2','1-3']);
  assert.equal(result.corrections.length,1);
  assert.equal(input.boxscore.players[0].statistics[0].athletes[0].athlete.id,undefined);
  await assert.rejects(()=>repairEspnIdentity(input,2025,async()=>({id:'wrong'})),/provenance/);
});
