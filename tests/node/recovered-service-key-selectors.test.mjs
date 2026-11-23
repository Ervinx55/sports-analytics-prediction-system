import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import vm from 'node:vm';

const definitions=[
 {slug:'capture-pitchmix-features',version:8,method:'POST',successCache:'no-store',errorCache:'no-store',requiresServiceRole:true},
 {slug:'provider-health-status',version:10,method:'GET',successCache:'public, max-age=15',errorCache:null},
];
const override='synthetic-server-override',legacy='synthetic-legacy-key',modern=['sb','secret','synthetic-modern-key'].join('_');
const sourceRoot=new URL('../../supabase/functions/',import.meta.url);
function sourceFor(slug,name){return readFileSync(new URL(`${slug}/${name}`,sourceRoot),'utf8');}
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const fixtureClaims=`${encode({alg:'HS256',typ:'JWT'})}.${encode({role:'service_role',exp:4102444800,sub:'selector-test-caller'})}`;
const serviceCaller=`${fixtureClaims}.${createHmac('sha256','local-selector-fixture-only').update(fixtureClaims).digest('base64url')}`;
const requestAuthorization=definition=>`Bearer ${definition.requiresServiceRole?serviceCaller:override}`;

// Execute each actual Deno handler. Only imports and the few TypeScript
// annotations in these recovered files are removed. The SDK client boundary is
// captured, not emulated as an outgoing auth-header policy owned by this code.
// Empty query results guarantee that no provider fetch or write is performed.
function application({slug,requiresServiceRole},values){
 const source=sourceFor(slug,'index.ts')
  .replace(/^import .*;\n/gm,'')
  .replaceAll('Deno.env.get("SUPABASE_URL")!','Deno.env.get("SUPABASE_URL")')
  .replaceAll('new Set<number>()','new Set()')
  .replaceAll(': Record<string, Record<string, number>>','')
  .replaceAll(' as Record<string, number>','')
  .replaceAll(' as any[]','')
  .replace(/: (?:number|string|unknown|any)\b/g,'');
 const helper=sourceFor(slug,'service-role-key.mjs').replace(/^export /gm,'');
 const authHelper=requiresServiceRole?sourceFor(slug,'service-role-auth.mjs').replace(/^export /gm,''):'';
 const clients=[],queries=[],providers=[];let handler;
 const query=table=>{
  const result={data:[],error:null},chain={then(resolve,reject){return Promise.resolve(result).then(resolve,reject);}};
  for(const method of ['select','not','gte','lte','gt','order','limit','eq'])chain[method]=(...args)=>{queries.push({table,method,args});return chain;};
  chain.insert=()=>{throw Error('Unexpected test write');};return chain;
 };
 vm.runInNewContext(`${helper}\n${authHelper}\n${source}`,{
  Deno:{env:{get:name=>values[name]},serve:callback=>{handler=callback;}},
  Request,Response,URL,atob,
  createClient:(url,key,options)=>{clients.push({url,key,options});return {from:query};},
  fetch:async(...args)=>{providers.push(args);throw Error('Unexpected provider request');},
 });
 assert.equal(typeof handler,'function');
 return {clients,queries,providers,async invoke({method='GET',payload={},headers={}}={}){
  const callerHeaders={...(requiresServiceRole?{authorization:`Bearer ${serviceCaller}`}:{ }),...headers};
  const response=await handler(new Request('https://function.example.test/?apikey=request-key',{method,headers:callerHeaders,...(method==='POST'?{body:JSON.stringify(payload)}:{})}));
  return {status:response.status,headers:response.headers,body:await response.json()};
 }};
}
const env=extra=>({SUPABASE_URL:'https://backend.example.test',...extra});

for(const definition of definitions){
 const {slug,method,version}=definition;
 test(`${slug}: deployed override stays ahead of modern and legacy keys`,async()=>{
  const app=application(definition,env({EDGE_LAB_SERVICE_ROLE_KEY:` \t${override}\n`,SUPABASE_SECRET_KEYS:JSON.stringify({default:modern}),SUPABASE_SERVICE_ROLE_KEY:legacy}));
  const result=await app.invoke({method});assert.equal(result.status,200);
  assert.equal(app.clients.length,1);assert.deepEqual(app.clients[0],{url:'https://backend.example.test',key:override,options:undefined});
  assert.equal(app.providers.length,0);
 });
 test(`${slug}: a nonblank modern default is trimmed and precedes legacy`,async()=>{
  const app=application(definition,env({EDGE_LAB_SERVICE_ROLE_KEY:'  ',SUPABASE_SECRET_KEYS:JSON.stringify({default:` \t${modern}\n `}),SUPABASE_SERVICE_ROLE_KEY:legacy}));
  assert.equal((await app.invoke({method})).status,200);
  assert.equal(app.clients[0].key,modern);
 });
 test(`${slug}: malformed and nonstring modern defaults fall back to the trimmed legacy key`,async()=>{
  for(const config of [undefined,'{','{}',...([123,true,[],[modern],{},'', ' \t\n ',null,false,0].map(value=>JSON.stringify({default:value})))]){
   const app=application(definition,env({SUPABASE_SECRET_KEYS:config,SUPABASE_SERVICE_ROLE_KEY:` ${legacy} `}));
   assert.equal((await app.invoke({method})).status,200);
   assert.equal(app.clients[0].key,legacy,config);
  }
 });
 test(`${slug}: invalid modern values without fallback fail before any SDK or provider request`,async()=>{
  for(const value of [123,true,[modern],{},'', ' \t\n ',null]){
   const app=application(definition,env({SUPABASE_SECRET_KEYS:JSON.stringify({default:value})}));
   const result=await app.invoke({method,payload:{apikey:override,serviceRoleKey:override},headers:{apikey:override,authorization:requestAuthorization(definition)}});
   assert.equal(result.status,500,JSON.stringify(value));
   assert.equal(app.clients.length,0);assert.equal(app.providers.length,0);
   assert.equal(result.headers.get('cache-control'),definition.errorCache);
   assert.match(result.body.error,/credential.*not configured/);
   assert.ok(!JSON.stringify(result.body).includes(modern));assert.ok(!JSON.stringify(result.body).includes(override));assert.ok(!JSON.stringify(result.body).includes(serviceCaller));
  }
 });
 test(`${slug}: request credentials do not replace server configuration or appear in responses`,async()=>{
  const app=application(definition,env({SUPABASE_SECRET_KEYS:JSON.stringify({default:modern})}));
  const result=await app.invoke({method,payload:{apikey:override,serviceRoleKey:override},headers:{apikey:override,authorization:requestAuthorization(definition)}});
  assert.equal(result.status,200);assert.equal(app.clients[0].key,modern);assert.equal(app.providers.length,0);
  assert.equal(result.headers.get('cache-control'),definition.successCache);
  assert.ok(!JSON.stringify(result.body).includes(modern));assert.ok(!JSON.stringify(result.body).includes(override));assert.ok(!JSON.stringify(result.body).includes(serviceCaller));
 });
 test(`${slug}: existing method guard still precedes the credential selector`,async()=>{
  const app=application(definition,env({SUPABASE_SECRET_KEYS:'malformed'}));
  const result=await app.invoke({method:method==='POST'?'GET':'POST'});
  assert.equal(result.status,405);assert.equal(app.clients.length,0);assert.equal(app.providers.length,0);
 });
 test(`${slug}: recovered business source changes only at the authorized default check`,()=>{
  const base=new URL(`../../supabase/deployed-snapshots/${slug}/v${version}/`,import.meta.url);
  const observed=readFileSync(new URL('index.ts',base),'utf8');
  const old='if (parsed?.default) return String(parsed.default);';
  const replacement='if (typeof parsed?.default === "string" && parsed.default.trim()) return parsed.default.trim();';
  assert.equal(observed.split(old).length,2);
  let actual=sourceFor(slug,'index.ts');
  if(definition.requiresServiceRole){
   const authImport='import { isServiceRoleRequest } from "./service-role-auth.mjs";\n';
   const authGuard='    if (!isServiceRoleRequest(req)) {\n      return new Response(JSON.stringify({ error: "Service authentication required" }), {\n        status: 401,\n        headers: { "content-type": "application/json", "cache-control": "no-store" },\n      });\n    }\n\n';
   assert.equal(actual.split(authImport).length,2);assert.equal(actual.split(authGuard).length,2);
   actual=actual.replace(authImport,'').replace(authGuard,'');
  }
  assert.ok(actual===observed.replace(old,replacement),'Only the authorized modern-default check may alter the recovered business source; the separately tested role guard is exact');
  assert.equal(sourceFor(slug,'service-role-key.mjs'),readFileSync(new URL('service-role-key.mjs',base),'utf8'));
 });
}
