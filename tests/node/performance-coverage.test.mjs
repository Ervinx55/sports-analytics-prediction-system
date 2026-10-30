import test from 'node:test';
import assert from 'node:assert/strict';
import {explainCoverage} from '../../supabase/functions/_shared/performance-coverage.mjs';
test('MLB history is distinguished from empty current filters',()=>{
 const r={coverage:{sports:[{sport:'MLB',samples:0,modelAvailability:'SAVED_SOURCE_CONTRACT_ONLY'}]},history:{summary:{grades:550,auditRows:558,latestAuditAt:'2026-10-11T08:20:00Z'}}};
 explainCoverage(r);assert.match(r.coverage.sports[0].message,/550 graded/);assert.match(r.coverage.sports[0].message,/No predictions match/);assert.equal(r.coverage.sports[0].modelAvailability,'HISTORICAL_RECORDS_AVAILABLE');assert.doesNotMatch(r.coverage.sports[0].providerCoverage,/UNVERIFIED/);
});
test('missing saved evidence does not claim that a model or provider is unavailable',()=>{
 const r={coverage:{sports:[{sport:'NFL',samples:0,modelAvailability:'SAVED_SOURCE_CONTRACT_ONLY'},{sport:'NBA',samples:0,modelAvailability:'UNAVAILABLE'}]}};explainCoverage(r);
 for(const s of r.coverage.sports){assert.equal(s.modelAvailability,'NO_SAVED_MODEL_EVIDENCE');assert.match(s.message,/No predictions match/);assert.match(s.providerCoverage,/not checked/);}
});
