import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateContext, datasetDigest} from '../../scripts/props/evaluate-context.mjs';
const row={id:'1',gameId:'g1',playerId:'p1',sport:'NBA',market:'points',variant:'team-form',forecastAt:'2025-01-01T18:00:00Z',startsAt:'2025-01-01T20:00:00Z',completedAt:'2025-01-01T23:00:00Z',featuresAvailableAt:'2025-01-01T17:00:00Z',actual:20,baseline:16,prediction:19};
const manifest=rows=>({version:1,modelVersion:'test-v1',frozenAt:'2024-12-31T00:00:00Z',development:{start:'2025-01-01T00:00:00Z',end:'2025-02-01T00:00:00Z'},holdout:{start:'2025-02-01T00:00:00Z',end:'2025-03-01T00:00:00Z'},datasetSha256:datasetDigest(rows),holdoutAudit:{status:'UNTOUCHED',evidence:'fixture audit'},acceptancePolicy:{minimumGames:100}});
test('paired ablations compare identical rows and never authorize promotion',()=>{
 const r=evaluateContext([row],manifest([row]),{phase:'development'});
 assert.equal(r.groups[0].projection.mae,1);assert.equal(r.groups[0].projection.baselineMae,4);assert.equal(r.productionEligible,false);
});
test('future features and changed frozen datasets are rejected',()=>{
 const bad={...row,featuresAvailableAt:'2025-01-01T21:00:00Z'};
 assert.throws(()=>evaluateContext([bad],manifest([bad]),{phase:'development'}),/cutoff/);
 assert.throws(()=>evaluateContext([{...row,actual:22}],manifest([row]),{phase:'development'}),/digest/);
});
test('repeated books do not inflate projection sample or game count',()=>{
 const rows=[{...row,id:'a',book:'A'},{...row,id:'b',book:'B'}];
 const r=evaluateContext(rows,manifest(rows),{phase:'development'}).groups[0];
 assert.equal(r.projection.samples,1);assert.equal(r.games,1);
});
test('holdout evaluation requires unused audited split and cannot leak development rows',()=>{
 assert.throws(()=>evaluateContext([row],{...manifest([row]),holdoutAudit:{status:'USED'}},{phase:'holdout'}),/untouched/i);
 const r=evaluateContext([row],manifest([row]),{phase:'holdout'});
 assert.equal(r.selectedRows,0);
});
test('market scores require paired price evidence and handle pushes',()=>{
 const prices={book:'A',line:19.5,side:'OVER',odds:-110,quoteAt:'2025-01-01T17:59:00Z',modelProbability:.6,baselineProbability:.5,marketProbability:.52,probabilityBasis:'CONDITIONAL_NO_PUSH'};
 const rows=[{...row,...prices}];
 const r=evaluateContext(rows,manifest(rows),{phase:'development'}).groups[0];
 assert.ok(Math.abs(r.probability.brier-.16)<1e-12);
 const push=[{...row,...prices,line:20}];
 assert.equal(evaluateContext(push,manifest(push),{phase:'development'}).groups[0].probability.samples,0);
});

test('ablation variants must share exact cohorts and baseline outcomes',()=>{
 for(const patch of [{gameId:'g2'},{baseline:14},{actual:22}]){
  const rows=[row,{...row,id:'2',variant:'position',...patch}];
  assert.throws(()=>evaluateContext(rows,manifest(rows)),/ablation|canonical/i);
 }
 const rows=[row,{...row,id:'2',variant:'position',prediction:18}];
 assert.equal(evaluateContext(rows,manifest(rows)).groups.length,2);
});

test('canonical games and outcomes cannot change across forecasts or split windows',()=>{
 for(const patch of [{startsAt:'2025-02-02T20:00:00Z',completedAt:'2025-02-02T23:00:00Z'},{forecastAt:'2025-01-01T19:00:00Z',actual:21}]){
  const rows=[row,{...row,id:'2',...patch}];
  assert.throws(()=>evaluateContext(rows,manifest(rows)),/canonical/i);
 }
});
test('partially supplied probability evidence cannot silently remove hard observations',()=>{
 const rows=[{...row,modelProbability:null,baselineProbability:.5,marketProbability:.5}];
 assert.throws(()=>evaluateContext(rows,manifest(rows)),/probability/i);
});
