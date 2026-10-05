import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../supabase/functions/capture-model-audit/index.ts',import.meta.url),'utf8');
test('broad model capture includes evening markets and hot capture stays bounded',()=>{
 const declaration=source.match(/const horizonMinutes = .*;/)?.[0];assert.ok(declaration);
 for(const [body,expected] of [[{},1440],[{lookaheadMinutes:120},120],[{lookaheadMinutes:-1},1440],[{lookaheadMinutes:999999},1440]]){
  assert.equal(vm.runInNewContext(declaration+' horizonMinutes;',{body}),expected);
 }
 assert.match(source,/const startsAfter = new Date\(\)\.toISOString\(\)/);assert.match(source,/includeWatch: "true"/);
 assert.match(source,/horizonMinutes \* 60_000/);
});
