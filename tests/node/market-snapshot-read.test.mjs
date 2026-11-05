import test from 'node:test';
import assert from 'node:assert/strict';
import {readMarketSnapshots} from '../../supabase/functions/_shared/market-snapshot-read.mjs';
test('market snapshot reader rejects unsafe filters and bounds query',async()=>{
 const calls=[];const sql={begin:async(mode,fn)=>{assert.equal(mode,'read only');return fn({unsafe:async(q,args)=>{calls.push([q,args]);return [];}})}};
 await assert.rejects(readMarketSnapshots(sql,'MLB','invalid'));
 await readMarketSnapshots(sql,'MLB','2026-10-28T00:00:00Z');
 assert.deepEqual(calls.at(-1)[1],['MLB','2026-10-28T00:00:00Z']);assert.match(calls.at(-1)[0],/limit 12001/);
});
