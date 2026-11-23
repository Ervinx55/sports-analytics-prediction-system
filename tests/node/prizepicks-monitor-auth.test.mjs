import test, {beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import diagnostic from '../../sharp-service/api/nbaprops.js';
import board from '../../sharp-service/api/board.js';
import sharp from '../../sharp-service/api/sharp.js';
import {resetProviderProtectionForTests} from '../../sharp-service/lib/provider-protection.js';

const token='fixture-prizepicks-monitor',legacyToken='fixture-board-monitor';
const names=['PRIZEPICKS_MONITOR_TOKEN','SHARP_MONITOR_TOKEN','SPORTS_ODDS_API_KEY','Sports_Game_Odds_API',
 'SHARPAPI_KEY','THE_ODDS_API_KEY','SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY',
 'SPORTS_ODDS_REQUESTS_PER_MINUTE','SPORTS_ODDS_CRITICAL_RESERVE','SPORTS_ODDS_NORMAL_RESERVE','SPORTS_ODDS_OBJECT_OPTIMIZATION'];
const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const previousFetch=globalThis.fetch;
let providerCalls=0;

beforeEach(()=>{
 resetProviderProtectionForTests();providerCalls=0;
 for(const name of names)delete process.env[name];
 process.env.SPORTS_ODDS_API_KEY='fixture-provider';
 process.env.SPORTS_ODDS_REQUESTS_PER_MINUTE='300';
 process.env.SPORTS_ODDS_OBJECT_OPTIMIZATION='0';
 globalThis.fetch=async(url,options)=>{
  assert.equal(new URL(url).origin,'https://api.sportsgameodds.com');
  assert.equal(new URL(url).pathname,'/v2/events');
  assert.equal(options.headers['x-api-key'],'fixture-provider');
  providerCalls++;
  return new Response(JSON.stringify({success:true,data:[]}),{status:200,headers:{'content-type':'application/json'}});
 };
});
afterEach(()=>{
 globalThis.fetch=previousFetch;resetProviderProtectionForTests();
 for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];
});
async function invoke(handler=diagnostic,{headers={},query={view:'prizepicks'}}={}){
 const res={headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
 await handler({method:'GET',headers,query},res);return res;
}

test('missing dedicated configuration names the required variable before any provider access',async()=>{
 for(const value of [undefined,'']){
  if(value===undefined)delete process.env.PRIZEPICKS_MONITOR_TOKEN;else process.env.PRIZEPICKS_MONITOR_TOKEN=value;
  const result=await invoke();
  assert.equal(result.statusCode,503);
  assert.equal(result.body.reason,'MONITOR_AUTH_UNAVAILABLE');
  assert.equal(result.body.requiredEnvironmentVariable,'PRIZEPICKS_MONITOR_TOKEN');
  assert.equal(result.body.quoteCount,0);
  assert.equal(result.body.productionEligible,false);
  assert.equal(result.body.productionWeight,0);
  assert.equal(result.headers['Cache-Control'],'private, no-store');
 }
 assert.equal(providerCalls,0);
});

test('a legacy board credential alone cannot configure or authorize the private diagnostic',async()=>{
 process.env.SHARP_MONITOR_TOKEN=legacyToken;
 const result=await invoke(diagnostic,{headers:{'x-monitor-token':legacyToken}});
 assert.equal(result.statusCode,503);
 assert.equal(result.body.reason,'MONITOR_AUTH_UNAVAILABLE');
 assert.equal(result.body.requiredEnvironmentVariable,'PRIZEPICKS_MONITOR_TOKEN');
 assert.equal(result.headers['Cache-Control'],'private, no-store');
 assert.equal(JSON.stringify(result.body).includes(legacyToken),false);
 assert.equal(providerCalls,0);
});

test('the dedicated credential alone authorizes the deployed PrizePicks diagnostic',async()=>{
 process.env.PRIZEPICKS_MONITOR_TOKEN=token;
 const result=await invoke(diagnostic,{headers:{'x-monitor-token':token}});
 assert.equal(result.statusCode,200);
 assert.equal(result.body.contract,'nba-prizepicks-diagnostic-v1');
 assert.equal(result.body.status,'NO_QUOTES_RETURNED');
 assert.equal(result.body.productionEligible,false);
 assert.equal(result.body.productionWeight,0);
 assert.equal(result.body.requiredEnvironmentVariable,undefined);
 assert.equal(result.headers['Cache-Control'],'private, no-store');
 assert.equal(JSON.stringify(result.body).includes(token),false);
 assert.equal(providerCalls,1);
});

test('invalid credentials cannot access provider data or reuse an authenticated diagnostic cache',async()=>{
 process.env.PRIZEPICKS_MONITOR_TOKEN=token;process.env.SHARP_MONITOR_TOKEN=legacyToken;
 const cases=[
  {name:'missing header',headers:{}},
  {name:'wrong same-length header',headers:{'x-monitor-token':'fixture-prizepicks-monitox'}},
  {name:'wrong-length header',headers:{'x-monitor-token':'wrong'}},
  {name:'repeated header array',headers:{'x-monitor-token':[token,token]}},
  {name:'repeated joined headers',headers:{'x-monitor-token':token+', '+token}},
  {name:'query credential only',headers:{},query:{view:'prizepicks',token}},
  {name:'legacy credential',headers:{'x-monitor-token':legacyToken}}
 ];
 for(const warm of [false,true]){
  if(warm){
   const allowed=await invoke(diagnostic,{headers:{'x-monitor-token':token}});
   assert.equal(allowed.statusCode,200);
   assert.equal(allowed.body.cache.statuses[0],'MISS');
   const cached=await invoke(diagnostic,{headers:{'x-monitor-token':token}});
   assert.equal(cached.statusCode,200);assert.equal(cached.body.cache.statuses[0],'HIT');
  }
  for(const example of cases){
   const result=await invoke(diagnostic,example);
   assert.equal(result.statusCode,401,example.name);
   assert.deepEqual(result.body,{error:'Unauthorized',productionEligible:false,productionWeight:0},example.name);
   assert.equal(result.headers['Cache-Control'],'private, no-store',example.name);
  }
  assert.equal(providerCalls,warm?1:0);
 }
});

test('a dedicated PrizePicks credential leaves actual board and sharp handlers usable without credentials',async()=>{
 process.env.PRIZEPICKS_MONITOR_TOKEN=token;
 for(const handler of [board,sharp]){
  resetProviderProtectionForTests();
  const result=await invoke(handler,{query:{leagues:'NBA',books:'draftkings'}});
  assert.equal(result.statusCode,200);
  assert.deepEqual(result.body.requestedLeagues,['NBA']);
  assert.equal(JSON.stringify(result.body).includes(token),false);
 }
 assert.equal(providerCalls,2);
});

test('the dedicated diagnostic credential does not bypass existing legacy board and sharp protection',async()=>{
 process.env.PRIZEPICKS_MONITOR_TOKEN=token;process.env.SHARP_MONITOR_TOKEN=legacyToken;
 for(const handler of [board,sharp]){
  resetProviderProtectionForTests();
  const query={leagues:'NBA',books:'draftkings'},before=providerCalls;
  for(const headers of [{},{'x-monitor-token':token}]){
   const denied=await invoke(handler,{headers,query});
   assert.equal(denied.statusCode,401);
   assert.deepEqual(denied.body,{error:'Unauthorized'});
  }
  assert.equal(providerCalls,before);
  const allowed=await invoke(handler,{headers:{'x-monitor-token':legacyToken},query});
  assert.equal(allowed.statusCode,200);
  assert.deepEqual(allowed.body.requestedLeagues,['NBA']);
 }
 assert.equal(providerCalls,2);
});
