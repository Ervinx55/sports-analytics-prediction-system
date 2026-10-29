import test from 'node:test';
import assert from 'node:assert/strict';
import {gradingRepository} from '../../supabase/functions/_shared/grading-database.mjs';
test('grading repository rejects unknown tables and binds data',async()=>{
 const calls=[];const sql={begin:async(mode,fn)=>fn({unsafe:async(q,args)=>{calls.push([q,args]);return [];}})};
 const r=gradingRepository(sql);
 await assert.rejects(r.observations('accounts','2026-10-01','2026-10-02'));
 await r.observations('prop','2026-10-01','2026-10-02');
 assert.deepEqual(calls.at(-1)[1],['2026-10-01','2026-10-02']);
 await r.save('prop',[{observation_id:1,outcome:'W'}]);assert.match(calls.at(-1)[0],/on conflict \(observation_id\) do nothing/i);assert.equal(calls.at(-1)[1][0],'[{"observation_id":1,"outcome":"W"}]');
});
test('pipeline authorization rejects missing and nonmatching credentials',async()=>{
 const r=gradingRepository({begin:async(mode,fn)=>fn({unsafe:async()=>[{allowed:false}]})});
 assert.equal(await r.authorized(null),false);assert.equal(await r.authorized('Bearer bad'),false);
});
