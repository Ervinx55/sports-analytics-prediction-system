import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../sharp-service/api/dashboard.js';

test('Today excludes hidden analytics, while calibration reads them and reports failures honestly',async()=>{
 const original=globalThis.fetch,seen=[];
 globalThis.fetch=async url=>{const path=new URL(url).pathname.split('/').pop();seen.push(path);return new Response(JSON.stringify(path==='latest-model-audit'?{candidates:[{starts_at:new Date(Date.now()+3600000).toISOString()}]}:{}),{status:path==='decision-fusion-calibration'?503:200});};
 const invoke=async view=>{let body,code;await handler({method:'GET',query:{sport:'NBA',view}},{setHeader(){},status(n){code=n;return this;},json(j){body=j;return this;}});return {body,code};};
 try{
  const today=await invoke('today');assert.equal(today.code,200);
  assert.ok(seen.includes('market-card'));assert.ok(!seen.includes('model-calibration'));assert.ok(!seen.includes('decision-fusion-calibration'));
  assert.equal(today.body.system.sourceHealth.calibration,undefined);
  seen.length=0;const calibration=await invoke('calibration');assert.equal(calibration.code,200);assert.ok(seen.includes('decision-fusion-calibration'));assert.equal(calibration.body.system.sourceHealth.decisionFusionCalibration.ok,false);
  seen.length=0;const invalid=await invoke('invented');assert.equal(invalid.code,400);assert.deepEqual(seen,[]);
 }finally{globalThis.fetch=original;}
});
