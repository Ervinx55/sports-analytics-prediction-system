import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistoricalFilters,readHistoricalResults} from '../../supabase/functions/_shared/historical-results-read.mjs';
test('historical filters reject invalid limits and unsafe sports before DB access',()=>{
 assert.deepEqual(parseHistoricalFilters({}),{sport:'MLB',limit:50});
 for(const input of [{limit:'NaN'},{limit:'1.5'},{sport:"MLB';drop"}])assert.throws(()=>parseHistoricalFilters(input));
 assert.equal(parseHistoricalFilters({sport:'nfl',limit:'999'}).limit,200);
});
test('historical read uses read-only service role and binds filters',async()=>{
 const calls=[];const sql={begin:async(mode,fn)=>{assert.equal(mode,'read only');return fn({unsafe:async(q,args)=>{calls.push([q,args]);return q.startsWith('select')?[{data:{grades:[],results:[],summary:{auditRows:0}}}]:[];}})}};
 const r=await readHistoricalResults(sql,{sport:'NFL',limit:'25'});
 assert.equal(r.sport,'NFL');assert.equal(r.historyKind,'LEGACY_DIAGNOSTIC');
 assert.match(calls[0][0],/set local role service_role/);assert.deepEqual(calls.at(-1)[1],['NFL',25]);
});
