import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const moduleUrl=new URL('../../scripts/nfl/hosted-price-collector.mjs',import.meta.url);
const now='2026-11-16T17:00:00Z';
function fixture(){return {league:'NFL',version:'v2.1',generatedAt:now,oddsProvider:'SportsGameOdds',events:[{eventID:'g1',startsAt:'2026-11-16T23:00:00Z',players:[{prop:{playerID:'p1',statID:'receiving_yards',over:{side:'over',oddID:'receiving_yards-p1-game-ou-over',books:{draftkings:{line:45.5,odds:-110,available:true,updatedAt:now}}},under:{side:'under',oddID:'receiving_yards-p1-game-ou-under',books:{draftkings:{line:45.5,odds:-110,available:true,updatedAt:now}}}}}]}]};}
async function implementation(){let exists=true;try{readFileSync(moduleUrl);}catch{exists=false;}assert.equal(exists,true,'Hosted NFL collector is not implemented');return import(moduleUrl.href);}
function memoryStore(){const tables=new Map();return {tables,async append(table,rows){if(!tables.has(table))tables.set(table,new Map());let count=0;for(const row of rows)if(!tables.get(table).has(row.id)){tables.get(table).set(row.id,structuredClone(row));count++;}return count;}};}

test('repeated raw response is append-only, captures receipt after download, and never authorizes plays',async()=>{
 const {runNflPriceCollector,NFL_PRICE_URL}=await implementation(),store=memoryStore();let downloaded=false,receipt=now,calls=0;
 const fetchImpl=async(url,options)=>{calls++;assert.equal(url,NFL_PRICE_URL);assert.equal(options.redirect,'error');assert.ok(options.signal);downloaded=true;return Response.json(fixture());};
 const clock=()=>{if(downloaded)return receipt;return '2026-11-16T16:59:59Z';};
 const a=await runNflPriceCollector({fetchImpl,clock,store});receipt='2026-11-16T17:01:00Z';const b=await runNflPriceCollector({fetchImpl,clock,store});
 assert.equal(calls,2);assert.equal(a.ok,true);assert.equal(a.records,1);assert.equal(a.inserted,1);assert.equal(b.inserted,0);assert.equal(a.rawResponseSha256,b.rawResponseSha256);
 assert.equal(store.tables.get('nfl_price_observations_v1').size,1);assert.equal(store.tables.get('nfl_price_responses_v1').size,1);assert.equal(store.tables.get('nfl_price_collection_runs_v1').size,2);
 const saved=[...store.tables.get('nfl_price_observations_v1').values()][0];assert.equal(saved.payload.receivedAt,now);assert.equal(saved.payload.productionEligible,false);assert.equal(saved.payload.validationEligible,false);assert.equal(saved.payload.productionWeight,0);assert.equal(saved.id.length,64);
});

test('stale feed is archived with rejections but creates no eligible observation',async()=>{
 const {runNflPriceCollector}=await implementation(),store=memoryStore();const body=fixture();body.generatedAt='2026-11-16T16:00:00Z';
 const result=await runNflPriceCollector({fetchImpl:async()=>Response.json(body),clock:()=>now,store});assert.equal(result.records,0);assert.equal(result.rejected.STALE_RESPONSE,1);assert.equal(store.tables.has('nfl_price_observations_v1'),false);assert.equal(store.tables.get('nfl_price_responses_v1').size,1);
});

test('HTTP, invalid JSON and oversized streams fail closed with sanitized errors',async()=>{
 const {runNflPriceCollector}=await implementation();
 for(const [response,error] of [[new Response('private details',{status:503}),'NFL_SOURCE_HTTP_503'],[new Response('{bad'),'NFL_SOURCE_INVALID_JSON'],[new Response('x'.repeat(5*1024*1024+1)),'NFL_SOURCE_TOO_LARGE']]){
  const store=memoryStore();const result=await runNflPriceCollector({fetchImpl:async()=>response,clock:()=>now,store});assert.equal(result.ok,false);assert.equal(result.error,error);assert.equal(store.tables.has('nfl_price_observations_v1'),false);assert.ok(!JSON.stringify(result).includes('private details'));
 }
});

test('REST store uses ignore-duplicates and fails on database errors without leaking bodies',async()=>{
 const {createRestPriceStore}=await implementation();const seen=[];
 const store=createRestPriceStore({url:'https://example.supabase.co',authorization:'Bearer test-key',fetchImpl:async(url,options)=>{seen.push({url,options});return Response.json([{id:'a'}],{status:201});}});
 assert.equal(await store.append('nfl_price_observations_v1',[{id:'a',payload:{}}]),1);assert.match(seen[0].url,/nfl_price_observations_v1\?on_conflict=id&select=id$/);assert.equal(seen[0].options.headers.Prefer,'resolution=ignore-duplicates,return=representation');assert.equal(seen[0].options.headers.apikey,'test-key');assert.equal(seen[0].options.headers.Authorization,'Bearer test-key');
 await assert.rejects(()=>store.append('nba_prop_outcomes_v1',[]),/DATABASE_TABLE_NOT_ALLOWED/);
 const bad=createRestPriceStore({url:'https://example.supabase.co',authorization:'Bearer test-key',fetchImpl:async()=>new Response('secret',{status:401})});await assert.rejects(()=>bad.append('nfl_price_observations_v1',[{id:'a'}]),/^Error: DATABASE_HTTP_401$/);
});

test('database failure is reported, never a successful collection',async()=>{
 const {runNflPriceCollector}=await implementation();const result=await runNflPriceCollector({fetchImpl:async()=>Response.json(fixture()),clock:()=>now,store:{append:async()=>{throw Error('DATABASE_HTTP_503');}}});assert.equal(result.ok,false);assert.equal(result.error,'DATABASE_HTTP_503');
});

test('unrelated response metadata does not duplicate an exact quote identity',async()=>{
 const {runNflPriceCollector}=await implementation(),store=memoryStore();let body=fixture();
 const args={fetchImpl:async()=>Response.json(body),clock:()=>now,store};
 const first=await runNflPriceCollector(args);body={...fixture(),diagnostic:'new metadata'};const second=await runNflPriceCollector(args);
 assert.notEqual(first.rawResponseSha256,second.rawResponseSha256);assert.equal(second.inserted,0);assert.equal(store.tables.get('nfl_price_responses_v1').size,2);
 const record=[...store.tables.get('nfl_price_observations_v1').values()][0];assert.equal(record.payload.sourceHash,first.rawResponseSha256);
});

test('HTTP entrypoint rejects methods and non-service roles before collection',async()=>{
 const source=readFileSync(new URL('../../supabase/functions/collect-nfl-prices/index.ts',import.meta.url),'utf8');
 let handler,calls=0;
 Function('Deno','createRestPriceStore','runNflPriceCollector',source.replace(/^import[^\n]+\n/,''))({serve:fn=>{handler=fn;},env:{get:()=> 'https://example.supabase.co'}},()=>({}),async()=>{calls++;return {ok:true};});
 assert.equal((await handler(new Request('https://example.test',{method:'GET'}))).status,405);
 assert.equal((await handler(new Request('https://example.test',{method:'POST'}))).status,401);
 const encoded=role=>'Bearer a.'+btoa(JSON.stringify({role}))+'.b';
 assert.equal((await handler(new Request('https://example.test',{method:'POST',headers:{authorization:encoded('anon')}}))).status,401);assert.equal(calls,0);
 // Signature verification itself belongs to the Supabase gateway, not this role check.
 assert.equal((await handler(new Request('https://example.test',{method:'POST',headers:{authorization:encoded('service_role')}}))).status,200);assert.equal(calls,1);
});
