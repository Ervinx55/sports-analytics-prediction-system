import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fitRecalibration, candidateProbability, gameMetrics, kickoffIso, probabilityMetrics} from '../../scripts/nfl/recalibration-lib.mjs';

const rows = (week, delta=2) => Array.from({length:30},(_,i)=>({season:2024,week,gameId:`${week}-${i}`,playerID:`p${i}`,market:'receiving_yards',prediction:20,actual:20+delta}));
test('rejects holdout or prospective rows before any fitting',()=>{
  assert.throws(()=>fitRecalibration([...rows(5),{...rows(12)[0],season:2025}]),/2024/);
});
test('selects bias on early data and checks frozen candidate on later development',()=>{
  const fitted=fitRecalibration([...rows(5),...rows(12)]);
  assert.equal(fitted.markets.receiving_yards.bias,2);
  assert.equal(fitted.markets.receiving_yards.accepted,true);
  assert.equal(fitted.productionEligible,false);
  assert.equal(fitted.productionWeight,0);
  const failed=fitRecalibration([...rows(5),...rows(12,-2)]);
  assert.equal(failed.markets.receiving_yards.bias,0);
  assert.equal(failed.markets.receiving_yards.accepted,false);
});
test('weights games equally despite repeated player rows',()=>{
  const result=gameMetrics([{gameId:'a',prediction:0,actual:10},...Array.from({length:9},()=>({gameId:'b',prediction:0,actual:0}))]);
  assert.equal(result.mae,5);
});
test('rejects duplicate player market outcomes, null values and unsafe identities',()=>{
  assert.throws(()=>fitRecalibration([...rows(5),rows(5)[0]]),/duplicate/);
  assert.throws(()=>fitRecalibration([{...rows(5)[0],actual:null}]),/finite/);
  assert.throws(()=>fitRecalibration([{...rows(5)[0],playerID:null}]),/identity/);
});
test('empirical probability is conditional on nonpush and sums to one',()=>{
  const model={bias:0,residuals:[-1,0,1]};
  assert.equal(candidateProbability(model,20,20,'over'),0.5);
  assert.equal(candidateProbability(model,20,20,'under'),0.5);
  assert.equal(candidateProbability(model,20,20.5,'over'),1/3);
});
test('count distributions cannot predict negative touchdowns or receptions and respect pushes',()=>{
  for(const market of ['passing_touchdowns','receiving_receptions']){
    const model={market,bias:0,residuals:[-2.4,-.4,.6]};
    assert.equal(candidateProbability(model,.5,.5,'over'),1/3);
    assert.equal(candidateProbability(model,.5,0,'under'),0);
    assert.equal(candidateProbability(model,.5,0,'over'),1);
  }
  const yards={market:'rushing_yards',bias:0,residuals:[-2.4,-.4,.6]};
  assert.equal(candidateProbability(yards,.5,0,'under'),.5);
});
test('kickoff uses Eastern daylight/standard time and conservative missing time',()=>{
  assert.equal(kickoffIso({gameday:'2024-09-08',gametime:'13:00'}),'2024-09-08T17:00:00.000Z');
  assert.equal(kickoffIso({gameday:'2024-12-08',gametime:'13:00'}),'2024-12-08T18:00:00.000Z');
  assert.equal(kickoffIso({gameday:'2024-09-08'}),'2024-09-08T00:00:00.000Z');
  assert.throws(()=>kickoffIso({gameday:'2024-02-30'}),/date/);
});
test('probability diagnostics weight games equally and reject probabilities outside zero to one',()=>{
  assert.equal(probabilityMetrics([{gameId:'a',probability:0,outcome:1},{gameId:'b',probability:1,outcome:1},{gameId:'b',probability:1,outcome:1}]).brier,.5);
  assert.throws(()=>probabilityMetrics([{gameId:'a',probability:2,outcome:1}]),/probability/);
});
test('runner refuses to overwrite an existing candidate before accessing any data',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-candidate-test-'));
  const file=path.join(directory,'candidate.json');
  fs.writeFileSync(file,'{"frozen":true}');
  const result=spawnSync(process.execPath,['scripts/nfl/recalibrate-props.mjs',`--output-dir=${directory}`],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Refusing to overwrite/);
  assert.equal(fs.readFileSync(file,'utf8'),'{"frozen":true}');
  fs.unlinkSync(file);fs.rmdirSync(directory);
});
