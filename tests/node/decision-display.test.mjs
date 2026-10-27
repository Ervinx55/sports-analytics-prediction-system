import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionPresentation} from '../../sharp-service/decision-display.js';
const now=Date.parse('2026-10-27T18:00:00Z');
const data={forecastAt:'2026-10-27T17:59:00Z',productionEligible:false};
test('production PASS stays PASS even when shadow says PLAY',()=>{
 const d=decisionPresentation({status:'PASS',shadowStatus:'PLAY'},data,now);
 assert.equal(d.title,'PASS — do not play');
 assert.equal(d.issuedAt,null);
 assert.equal(d.evaluatedAt,data.forecastAt);
});
test('shadow or unavailable rows never become cleared plays',()=>{
 for(const row of [{status:'PLAY'},{status:'SHADOW'},{}])
 assert.equal(decisionPresentation(row,data,now).title,'NOT CLEARED — do not play');
});
test('only an explicitly eligible fresh production PLAY is cleared',()=>{
 const row={status:'PLAY',productionEligible:true,productionWeight:1};
 assert.equal(decisionPresentation(row,{...data,productionEligible:true},now).kind,'play');
 assert.equal(decisionPresentation(row,{forecastAt:'2026-10-27T17:00:00Z'},now).kind,'unavailable');
});
test('refresh and quote timestamps cannot masquerade as decision times',()=>{
 const d=decisionPresentation({status:'PASS',updatedAt:data.forecastAt,issuedAt:'invalid'},{generatedAt:data.forecastAt},now);
 assert.equal(d.issuedAt,null);assert.equal(d.evaluatedAt,null);
 const future=decisionPresentation({decisionAt:'2026-10-28T18:00:00Z'},data,now);
 assert.equal(future.issuedAt,null);
});
