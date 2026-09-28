import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freezePolicy, readFrozenPolicy, summarizeFrozenProps, validateHoldoutInputs } from '../../scripts/nba/validate-nba-holdout.mjs';
import { SUPPORTED_STATS } from '../../sharp-service/lib/nba-player-props.js';

test('NBA freeze uses development acceptance and rejects changed model provenance',()=>{
  const markets=Object.fromEntries(SUPPORTED_STATS.map(stat=>[stat,{promotion:{accepted:false},contextPromotion:{accepted:true}}]));
  markets.points.promotion.accepted=true;
  const policy=freezePolicy({season:2024,gamesEvaluated:100,minimumPriorGames:4},
    {season:2024,holdoutTouched:false,minimumPriorGames:4,markets},{season:2024,games:1230,holdoutTouched:false,sha256:{}});
  assert.equal(policy.propPredictors.points,'contextModel');
  assert.equal(policy.propPredictors.rebounds,'baseline');
  assert.equal(policy.productionWeight,0);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nba-freeze-')),file=path.join(dir,'policy.json');
  try {
    fs.writeFileSync(file,JSON.stringify(policy));
    assert.equal(readFrozenPolicy(file).policy.holdoutSeason,2025);
    policy.modelHashes['sharp-service/lib/nba-model.js']='changed';
    fs.writeFileSync(file,JSON.stringify(policy));
    assert.throws(()=>readFrozenPolicy(file),/model changed/);
  } finally {fs.unlinkSync(file);fs.rmdirSync(dir);}
});

test('NBA holdout reports the frozen selected predictor rather than choosing its best result',()=>{
  const rows={points:[{actual:10,model:10,contextModel:20,baseline:8}]};
  const result=summarizeFrozenProps(rows,{points:'baseline'});
  assert.equal(result.points.selected.mae,2);
  assert.equal(result.points.baseline.mae,2);
  assert.equal(result.points.productionEligible,false);
  assert.throws(()=>summarizeFrozenProps({points:[]},{points:'model'}),/Incomplete/);
  assert.throws(()=>summarizeFrozenProps({points:[{actual:10,baseline:8}]},{points:'model'}),/Incomplete/);
});

function completeHoldoutFixture() {
  const team=id=>({id,full_name:`Team ${id}`,abbreviation:`T${id}`});
  const games=Array.from({length:1230},(_,index)=>{
    const datetime=new Date(Date.UTC(2025,9,21+Math.floor(index/15),23)).toISOString();
    const home_team=team(2*(index%15)+1),visitor_team=team(2*(index%15)+2);
    return {id:index+1,season:2025,datetime,date:datetime.slice(0,10),status:'Final',status_state:'final',postseason:false,
      home_team,visitor_team,home_team_id:home_team.id,visitor_team_id:visitor_team.id,home_team_score:100,visitor_team_score:90};
  });
  const rows=games.flatMap(game=>[game.home_team,game.visitor_team].map(team=>({game,team,
    player:{id:team.id,first_name:'Player',last_name:String(team.id)},min:'48',
    pts:team.id===game.home_team_id?100:90,reb:10,ast:10,turnover:0,stl:0,blk:0,oreb:2,dreb:8,fgm:40,fga:80,fg3m:10,fg3a:20,ftm:0,fta:0})));
  return {games,rows};
}

test('NBA holdout requires complete unique games and reconciled player boxscores',()=>{
  const {games,rows}=completeHoldoutFixture();
  assert.doesNotThrow(()=>validateHoldoutInputs(games,rows));
  assert.throws(()=>validateHoldoutInputs(games.slice(1),rows),/Incomplete/);
  assert.throws(()=>validateHoldoutInputs(games,rows.slice(1)),/boxscores/);
  assert.throws(()=>validateHoldoutInputs(games,[...rows,rows[0]]),/duplicate/);
  assert.throws(()=>validateHoldoutInputs([...games.slice(1),games[1]],rows),/Incomplete/);
});

test('NBA holdout rejects missing chronology and divergent embedded game data',()=>{
  for(const field of ['datetime','date','home_team_score','visitor_team_id']) {
    const {games,rows}=completeHoldoutFixture();
    rows[0].game={...rows[0].game,[field]:field==='datetime'?'2030-01-01T00:00:00Z':null};
    assert.throws(()=>validateHoldoutInputs(games,rows),/canonical schedule/);
  }
  const {games,rows}=completeHoldoutFixture();
  delete games[0].datetime;
  assert.throws(()=>validateHoldoutInputs(games,rows),/chronology/);
  games[0].datetime='invalid';
  assert.throws(()=>validateHoldoutInputs(games,rows),/chronology/);
});

test('NBA holdout rejects incomplete identities and stats before evaluation',()=>{
  for(const id of [undefined,null,NaN,0,'12']) {
    const {games,rows}=completeHoldoutFixture();
    rows[0].player.id=id;
    assert.throws(()=>validateHoldoutInputs(games,rows),/player row/);
  }
  for(const field of ['reb','ast','turnover','stl','blk','oreb','dreb','fgm','fga','fg3m','fg3a','ftm','fta','min']) {
    const {games,rows}=completeHoldoutFixture();
    rows[0][field]=null;
    assert.throws(()=>validateHoldoutInputs(games,rows),/statistics/);
  }
  const {games,rows}=completeHoldoutFixture();
  rows[0].team={...rows[0].team,abbreviation:'WRONG'};
  assert.throws(()=>validateHoldoutInputs(games,rows),/canonical schedule/);
});
