import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadScheduler} from '../../sharp-service/api/dashboard.js';
test('dashboard reads bound concurrency and preserve every result',async()=>{
 const schedule=createReadScheduler(4);let active=0,max=0;
 const values=await Promise.all(Array.from({length:35},(_,i)=>schedule(String(i),async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return i;})));
 assert.equal(max,4);assert.deepEqual(values,Array.from({length:35},(_,i)=>i));
});
test('concurrent identical reads share work, failures release slots and are not cached',async()=>{
 const schedule=createReadScheduler(1);let calls=0;
 const first=schedule('same',async()=>{calls++;throw Error('offline');});
 const second=schedule('same',()=>{calls++;return 2;});
 const good=schedule('other',()=>3);
 assert.equal(first,second);await assert.rejects(first,/offline/);assert.equal(await good,3);
 assert.equal(await schedule('same',()=>4),4);assert.equal(calls,1);
});

