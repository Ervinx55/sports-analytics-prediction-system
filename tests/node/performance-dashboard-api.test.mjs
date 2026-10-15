import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../sharp-service/api/dashboard.js';
test('existing dashboard performance branch forwards filters and preserves safe explicit errors',async()=>{
 const original=globalThis.fetch;
 const invoke=async(response)=>{globalThis.fetch=async url=>{assert.ok(url.includes('/prediction-performance?'));assert.ok(url.includes('cohort=PLAY'));return response;};let status,body;const res={setHeader(){},status(code){status=code;return this;},json(value){body=value;return this;}};await handler({method:'GET',query:{view:'performance',sport:'NFL',cohort:'PLAY'}},res);return {status,body};};
 try{
  const data={summary:{wins:2},rows:[],coverage:{complete:false}};assert.deepEqual(await invoke({ok:true,json:async()=>data}),{status:200,body:data});
  assert.equal((await invoke({ok:false,status:400})).status,400);assert.equal((await invoke({ok:false,status:422})).body.error,'PERFORMANCE_READ_LIMIT_EXCEEDED');
  assert.equal((await invoke({ok:false,status:500})).status,503);assert.equal((await invoke({ok:true,json:async()=>({})})).status,503);
 }finally{globalThis.fetch=original;}
});
