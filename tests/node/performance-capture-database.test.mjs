import test from 'node:test';
import assert from 'node:assert/strict';
import {performanceCaptureDatabase} from '../../supabase/functions/_shared/performance-capture-database.mjs';
test('capture uses bounded database transactions and only approved ledger functions',async()=>{
 const calls=[];const sql={begin:async(mode,fn)=>{calls.push(mode);return fn({unsafe:async(q,args)=>{calls.push([q,args]);return q.startsWith('select public.')?[{data:{id:'receipt'}}]:[];}});}};
 const db=performanceCaptureDatabase(sql);
 assert.deepEqual(await db.rpc('ingest_sport_prediction_v1',{payload:{sport:'NFL'}}),{data:{id:'receipt'},error:null});
 assert.ok(calls.some(x=>x[0]==='set local role service_role'));
 assert.ok(calls.some(x=>x[0]==="set local statement_timeout = '8s'"));
 await assert.rejects(db.rpc('delete_everything',{payload:{}}),/Unsupported/);
 assert.throws(()=>db.from('private_accounts'),/Unsupported/);
});
test('MLB capture binds cursor and restricts source to MLB',async()=>{
 const calls=[];const db=performanceCaptureDatabase({begin:async(mode,fn)=>fn({unsafe:async(q,args)=>{calls.push([q,args]);return q.startsWith('select to_jsonb')?[{row:{id:5,sport:'MLB'}}]:[];}})});
 const r=await db.from('market_grade_observations').select('*').gt('id',4).order('id',{ascending:true}).limit(500);
 assert.equal(r.data[0].id,5);assert.match(calls.at(-1)[0],/sport='MLB'/);assert.deepEqual(calls.at(-1)[1],[4]);
 assert.throws(()=>db.from('market_grade_observations').select('*').gt('id',-1),/Invalid/);
});
