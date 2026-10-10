import test from 'node:test';
import assert from 'node:assert/strict';
import {readPerformance} from '../../supabase/functions/_shared/performance-read.mjs';
test('aggregate every matched row before page and keep diagnostic payload sport separate',async()=>{
 const predictions=Array.from({length:250},(_,i)=>({id:String(i),sport:'NFL',eventKey:String(i),marketKey:String(i),modelMode:'LIVE',modelAvailable:true,valid:true,capturedAt:'2026-10-01T12:00:00Z',startsAt:'2026-10-01T14:00:00Z',quoteAt:'2026-10-01T12:00:00Z',modelProbability:.6,marketProbability:.5,probabilityBasis:'CONDITIONAL_NO_PUSH',odds:100,eligibilityReasons:[]}));
 predictions.push({...predictions[0],id:'bad',valid:false,eligibilityReasons:['QUOTE_LINE_MISMATCH']});
 const client={rpc:async()=>({data:{predictions,decisions:[],settlements:predictions.map(p=>({predictionId:p.id,outcome:'WIN',revision:1}))},error:null})};
 const r=await readPerformance(client,{sport:'NFL',from:'2026-10-01',to:'2026-10-03'});assert.equal(r.summary.wins,250);assert.equal(r.rows.length,100);assert.equal(r.nextCursor,'100');assert.equal(r.coverage.exclusions.QUOTE_LINE_MISMATCH,1);assert.equal(r.coverage.infrastructure,'UNVERIFIED_DISABLED_BY_DEFAULT');assert.equal(r.rows[0].provenance,undefined);
 const page=await readPerformance(client,{sport:'NFL',from:'2026-10-01',to:'2026-10-03',cursor:'200'});assert.equal(page.rows.length,50);assert.equal(page.summary.wins,250);
});
test('read fails explicitly for downstream errors or malformed/truncated response',async()=>{
 for(const data of [null,{}, {predictions:[],decisions:[]}])await assert.rejects(readPerformance({rpc:async()=>({data,error:null})},{}));
 await assert.rejects(readPerformance({rpc:async()=>({data:null,error:{message:'secret'}})},{}),/PERFORMANCE_READ_UNAVAILABLE/);
});
test('limit errors are actionable and public projection never exposes nested internal keys',async()=>{
 await assert.rejects(readPerformance({rpc:async()=>({data:{error:'PERFORMANCE_READ_LIMIT_EXCEEDED'},error:null})},{}),/PERFORMANCE_READ_LIMIT_EXCEEDED/);
 const row={id:'bad',sport:'NFL',valid:false,modelAvailable:false,capturedAt:'2026-10-01T12:00:00Z',startsAt:'2026-10-01T14:00:00Z',marketScope:{period:'REGULATION',secret:'never public'},eligibilityReasons:['MODEL_UNAVAILABLE',{secret:'never public'}],provenance:{secret:'never public'}};
 const r=await readPerformance({rpc:async()=>({data:{predictions:[row],decisions:[],settlements:[]},error:null})},{sport:'NFL',cohort:'DIAGNOSTIC',from:'2026-10-01',to:'2026-10-03'});
 assert.ok(!JSON.stringify(r).includes('never public'));assert.equal(r.summary.count,0);assert.equal(r.coverage.exclusionCategories.model.MODEL_UNAVAILABLE,1);
});
test('20MiB limit counts actual UTF8 bytes, accepts exact boundary and rejects multibyte overflow',async()=>{
 const bytes=20*1024*1024,data={predictions:[],decisions:[],settlements:[],padding:''},encoder=new TextEncoder(),overhead=encoder.encode(JSON.stringify(data)).byteLength;
 const remaining=bytes-overhead;data.padding='é'.repeat(Math.floor(remaining/2))+'a'.repeat(remaining%2);
 const client={rpc:async()=>({data,error:null})};assert.equal(encoder.encode(JSON.stringify(data)).byteLength,bytes);assert.equal((await readPerformance(client)).summary.count,0);
 data.padding+='é';assert.equal(encoder.encode(JSON.stringify(data)).byteLength,bytes+2);await assert.rejects(readPerformance(client),/PERFORMANCE_READ_LIMIT_EXCEEDED/);
 data.padding='';data.predictions=[{sourceKey:'界'.repeat(8*1024*1024)}];await assert.rejects(readPerformance(client),/PERFORMANCE_READ_LIMIT_EXCEEDED/);
});
