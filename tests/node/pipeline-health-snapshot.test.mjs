import test from 'node:test';
import assert from 'node:assert/strict';
import { readHealthSnapshot } from '../../supabase/functions/pipeline-health-status/snapshot.mjs';
const now=Date.parse('2026-11-10T20:30:00Z');
test('health snapshot preserves rows and reports its age',()=>{
 const rows=[{component_key:'collector',health_status:'CRON_FAILED'}];
 const result=readHealthSnapshot({observed_at:'2026-11-10T20:29:00Z',data:rows},now);
 assert.deepEqual(result.rows,rows); assert.equal(result.ageSeconds,60);
});
test('missing, stale, future and malformed health snapshots fail closed',()=>{
 for(const row of [null,{}, {observed_at:'bad',data:[]},{observed_at:'2026-11-10T20:27:59Z',data:[]},{observed_at:'2026-11-10T20:31:00Z',data:[]},{observed_at:'2026-11-10T20:30:00Z',data:null}])
 assert.throws(()=>readHealthSnapshot(row,now),/snapshot/i);
});

