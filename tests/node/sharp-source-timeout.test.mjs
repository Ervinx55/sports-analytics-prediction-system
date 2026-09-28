import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSourceText } from '../../supabase/functions/_shared/source-fetch.mjs';

test('sharp source deadlines cover both stalled connection and stalled response body',async()=>{
  for(const bodyStalls of [false,true]) {
    let signal;
    const fetchImpl=async(_url,options)=>{
      signal=options.signal;
      if(bodyStalls) return {ok:true,text:()=>new Promise(()=>{})};
      return new Promise(()=>{});
    };
    await assert.rejects(()=>fetchSourceText('https://example.test',{}, {timeoutMs:10,fetchImpl}),/exceeded/);
    assert.equal(signal.aborted,true);
  }
});
test('sharp source fetch preserves valid responses and rejects HTTP errors',async()=>{
  assert.equal(await fetchSourceText('https://example.test',{}, {fetchImpl:async()=>({ok:true,text:async()=>'quotes'})}),'quotes');
  await assert.rejects(()=>fetchSourceText('https://example.test',{}, {fetchImpl:async()=>({ok:false,status:429})}),/HTTP 429/);
});
