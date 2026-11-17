import test from 'node:test';
import assert from 'node:assert/strict';
import {metrics, pairedBlockBootstrap} from '../../scripts/evaluation/winner-validation-metrics.mjs';

test('proper scores, accuracy and calibration retain the binary denominator', () => {
 const result=metrics([{probability:.8,outcome:1},{probability:.4,outcome:0}]);
 assert.equal(result.n,2);
 assert.ok(Math.abs(result.brier-.1)<1e-12);
 assert.ok(Math.abs(result.logloss-(-Math.log(.8)-Math.log(.6))/2)<1e-12);
 assert.equal(result.accuracy,1);
 assert.equal(result.calibration.reduce((sum,b)=>sum+b.n,0),2);
 assert.equal(result.calibration[4].observed,0);
 assert.equal(result.calibration[8].observed,1);
});
test('empty sample is unavailable; invalid values and ties must not silently change cohort', () => {
 assert.equal(metrics([]).brier,null);
 for(const row of [{probability:null,outcome:1},{probability:.6,outcome:null},{probability:.6,outcome:.5},{probability:NaN,outcome:1},{probability:1.1,outcome:0}]) assert.throws(()=>metrics([row]));
});
test('exact zero/one probabilities have finite clipped logloss, no spurious accuracy', () => {
 const r=metrics([{probability:0,outcome:1},{probability:1,outcome:0}]);
 assert.equal(r.brier,1);assert.equal(r.accuracy,0);assert.ok(Number.isFinite(r.logloss));
 assert.equal(metrics([{probability:.5,outcome:1},{probability:.5,outcome:0}]).accuracy,.5);
});
test('paired block resampling preserves identical predictions and deterministic seed', () => {
 const rows=[{block:'a',outcome:1,baseline:.7,candidate:.7},{block:'a',outcome:0,baseline:.3,candidate:.3},{block:'b',outcome:1,baseline:.8,candidate:.8}];
 const r=pairedBlockBootstrap(rows,'candidate','baseline',{iterations:100,seed:42});
 assert.equal(r.blocks,2); assert.equal(r.n,3);
 assert.deepEqual(r.brier,{delta:0,lower:0,upper:0});
 assert.deepEqual(r.logloss,{delta:0,lower:0,upper:0});
 assert.deepEqual(r,pairedBlockBootstrap(rows,'candidate','baseline',{iterations:100,seed:42}));
});
test('negative delta means improvement, and one block cannot establish interval', () => {
 const rows=[{block:'a',outcome:1,baseline:.5,candidate:.9}];
 const r=pairedBlockBootstrap(rows,'candidate');
 assert.ok(Math.abs(r.brier.delta+.24)<1e-12);
 assert.equal(r.brier.lower,null);assert.equal(r.brier.upper,null);
 assert.throws(()=>pairedBlockBootstrap([{outcome:1,baseline:.5,candidate:.9}],'candidate'));
 assert.throws(()=>pairedBlockBootstrap([{block:'a',outcome:1,baseline:.5,candidate:null}],'candidate'));
});
