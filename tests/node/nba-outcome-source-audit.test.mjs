import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const moduleUrl=new URL('../../scripts/nba/outcome-source-audit.mjs',import.meta.url);
const now='2026-11-16T18:00:00.000Z';
const eventID='BDgz9hcfzcEGwQDlPcLM';
const secret='private-provider-key-test';
const auth=role=>'Bearer '+btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({role}))+'.signature';
const fixture=()=>({success:true,data:[{eventID,leagueID:'NBA',type:'match',status:{completed:true},teams:{home:{teamID:'ATL'}},players:{PLAYER_A:{name:'Example Player'}},results:{'points-PLAYER_A-game':27},info:{season:2026},odds:{private:'omit'},metadata:{trace:'omit'}}],metadata:{apiKey:secret}});
async function implementation(){assert.equal(existsSync(moduleUrl),true,'Read-only NBA evidence audit is not implemented');return import(moduleUrl.href);}
const request=(body=JSON.stringify({eventID}),authorization=auth('service_role'),method='POST')=>new Request('https://example.test/functions/v1/audit-nba-outcome-sources',{method,headers:{authorization},...(method==='GET'?{}:{body})});

test('collects only the explicitly selected allowlisted event with raw-byte receipt/hash',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();
 const raw=JSON.stringify(fixture());let calls=0;
 const response=await handleNbaOutcomeSourceRequest(request(),{apiKey:secret,clock:()=>now,fetchImpl:async(url,options)=>{
  calls++;const parsed=new URL(url);
  assert.equal(parsed.origin,'https://api.sportsgameodds.com');assert.equal(parsed.pathname,'/v2/events');
  assert.deepEqual([...parsed.searchParams.keys()].sort(),['eventIDs','expandResults','leagueID','limit','oddID','type']);
  assert.equal(parsed.searchParams.get('eventIDs'),'BDgz9hcfzcEGwQDlPcLM');
  assert.equal(parsed.searchParams.get('leagueID'),'NBA');assert.equal(parsed.searchParams.get('limit'),'1');assert.equal(parsed.searchParams.get('expandResults'),'true');
  assert.equal(parsed.searchParams.get('type'),'match');assert.equal(parsed.searchParams.get('oddID'),'points-home-game-ml-home');
  assert.equal(options.method,'GET');assert.equal(options.headers['x-api-key'],secret);assert.equal(options.redirect,'error');assert.ok(options.signal);
  return new Response(raw);
 }});
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.json();
 assert.equal(calls,1);assert.equal(body.source.receivedAt,now);assert.equal(body.source.rawSha256,createHash('sha256').update(raw).digest('hex'));assert.equal(body.source.rawBytes,Buffer.byteLength(raw));
 assert.deepEqual(Object.keys(body.events[0]).sort(),['eventID','info','leagueID','players','results','status','teams','type']);
 assert.equal(body.events[0].results['points-PLAYER_A-game'],27);assert.equal(JSON.stringify(body).includes(secret),false);assert.equal(body.events[0].odds,undefined);
 assert.equal(body.source.eventCount,1);assert.deepEqual(body.source.requestedEventIDs,[eventID]);assert.deepEqual(body.source.missingEventIDs,[]);
});

test('rejects malformed authorization and non-service roles before any provider call',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();let calls=0;const deps={apiKey:secret,fetchImpl:async()=>{calls++;throw Error('must not fetch');}};
 for(const token of ['', 'Bearer bad',auth('anon'),auth('authenticated'),'Basic '+auth('service_role'),'Bearer a.'+btoa('not-json')+'.b','Bearer a.'+btoa(JSON.stringify({role:'service_role'}))]) {
  const response=await handleNbaOutcomeSourceRequest(request('{}',token),deps);assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 assert.equal(calls,0);
});

test('rejects methods, invalid bodies and body size over 256 bytes without fetching',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();let calls=0;const deps={apiKey:secret,fetchImpl:async()=>{calls++;return Response.json(fixture());},clock:()=>now};
 assert.equal((await handleNbaOutcomeSourceRequest(request(undefined,auth('service_role'),'GET'),deps)).status,405);
 for(const body of ['', '{}', '{','null','[]','true','{"eventID":"attacker"}','{"eventIDs":["BDgz9hcfzcEGwQDlPcLM"]}','{"action":"audit-fixed-events"}',JSON.stringify({eventID,extra:true}),JSON.stringify({eventID,oddID:'attacker'}),' '.repeat(257)]){
  assert.equal((await handleNbaOutcomeSourceRequest(request(body),deps)).status,400);
 }
 assert.equal(calls,0);
 assert.equal((await handleNbaOutcomeSourceRequest(request(),deps)).status,200);
 assert.equal(calls,1);
});

test('accepts each fixed event separately and reports only its own absence',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();
 for(const id of ['BDgz9hcfzcEGwQDlPcLM','Vr1VbRYZaiOVKjBTTK6W','lifymi4jrXCpckkBVDDC','eZJHrEb25QaGPXmVUaF0','OeymLe7wQY2zwKedvCrU','P85upZIi5P758SI7lZPk','ViYMGlG1xRWQ2J4jAhph']){
  const response=await handleNbaOutcomeSourceRequest(request(JSON.stringify({eventID:id})),{apiKey:secret,fetchImpl:async url=>{
   assert.equal(new URL(url).searchParams.get('eventIDs'),id);return Response.json({success:true,data:[]});
  },clock:()=>now});
  assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.source.requestedEventIDs,[id]);assert.deepEqual(body.source.missingEventIDs,[id]);
 }
});

test('audits only the two additional reviewed history conflicts with the same bounded source contract',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();
 for(const id of ['RI94CiYdJuFOefB25PwX','vF7mrlCAIjmb7rtvfi4s']){
  let calls=0;const event={...fixture().data[0],eventID:id};
  const response=await handleNbaOutcomeSourceRequest(request(JSON.stringify({eventID:id})),{apiKey:secret,clock:()=>now,fetchImpl:async(url,options)=>{
   calls++;const parsed=new URL(url);assert.equal(parsed.searchParams.get('eventIDs'),id);assert.equal(parsed.searchParams.get('limit'),'1');assert.equal(options.redirect,'error');return Response.json({success:true,data:[event]});
  }});
  assert.equal(response.status,200);const body=await response.json();assert.equal(calls,1);assert.deepEqual(body.source.requestedEventIDs,[id]);assert.equal(body.events[0].eventID,id);assert.equal(body.source.receivedAt,now);
 }
});

test('refuses unrequested, duplicate, wrong-league and excessive provider events',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();
 const good=fixture().data[0];
 for(const [data,want] of [
  [[{...good,eventID:'unknown'}],'NBA_SOURCE_UNEXPECTED_ID'],
  [[{...good,eventID:'Vr1VbRYZaiOVKjBTTK6W'}],'NBA_SOURCE_UNEXPECTED_ID'],
  [[good,good],'NBA_SOURCE_DUPLICATE_ID'],
  [[{...good,leagueID:'NFL'}],'NBA_SOURCE_INVALID_LEAGUE'],
  [Array.from({length:8},()=>good),'NBA_SOURCE_DUPLICATE_ID']
 ]){
  const response=await handleNbaOutcomeSourceRequest(request(),{apiKey:secret,fetchImpl:async()=>Response.json({success:true,data}),clock:()=>now});
  assert.equal(response.status,502);assert.equal((await response.json()).error,want);
 }
});

test('requires an explicit successful provider envelope',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();
 for(const success of [undefined,null,'true',1]){
  const body={...fixture(),success};
  const response=await handleNbaOutcomeSourceRequest(request(),{apiKey:secret,fetchImpl:async()=>Response.json(body),clock:()=>now});
  assert.equal(response.status,502);assert.equal((await response.json()).error,'NBA_SOURCE_INVALID_SUCCESS');
 }
});

test('allows a cursor only after the selected event is present exactly once',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();
 for(const nextCursor of [undefined,null,'','another-page']){
  const response=await handleNbaOutcomeSourceRequest(request(),{apiKey:secret,fetchImpl:async()=>Response.json({...fixture(),nextCursor}),clock:()=>now});
  assert.equal(response.status,200);assert.equal((await response.json()).source.paginationCursorPresent,nextCursor==='another-page');
 }
 for(const [data,want] of [[[],'NBA_SOURCE_PAGINATED_MISSING_EVENT'],[[fixture().data[0],fixture().data[0]],'NBA_SOURCE_DUPLICATE_ID'],[[{...fixture().data[0],eventID:'unknown'}],'NBA_SOURCE_UNEXPECTED_ID']]){
  const response=await handleNbaOutcomeSourceRequest(request(),{apiKey:secret,fetchImpl:async()=>Response.json({success:true,data,nextCursor:'another-page'}),clock:()=>now});
  assert.equal(response.status,502);assert.equal((await response.json()).error,want);
 }
 for(const nextCursor of [{},1]){
  const response=await handleNbaOutcomeSourceRequest(request(),{apiKey:secret,fetchImpl:async()=>Response.json({...fixture(),nextCursor}),clock:()=>now});
  assert.equal(response.status,502);assert.equal((await response.json()).error,'NBA_SOURCE_INVALID_EVENTS');
 }
});

test('recursively removes odds, metadata, auth fields and credential echoes from source evidence',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();const body=fixture();
 body.data[0].info={ok:'preserved',odds:{a:1},metadata:{key:secret},headers:{authorization:secret},note:'credential='+secret,api_key:secret,nested:{Authorization:secret,normal:'value'}};
 body.data[0].players.PLAYER_A.metadata={sensitive:true};
 const response=await handleNbaOutcomeSourceRequest(request(),{apiKey:secret,fetchImpl:async()=>Response.json(body),clock:()=>now});
 const output=await response.json();assert.equal(response.status,200);
 assert.deepEqual(output.events[0].info,{ok:'preserved',note:'credential=[REDACTED]',nested:{normal:'value'}});
 assert.equal(output.events[0].players.PLAYER_A.metadata,undefined);assert.equal(JSON.stringify(output).includes(secret),false);
});

test('sanitizes provider, JSON, UTF-8, configuration and network failures',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();
 for(const [factory,want] of [
  [()=>new Response(secret,{status:429}),'NBA_SOURCE_HTTP_429'],
  [()=>new Response('{'+secret),'NBA_SOURCE_INVALID_JSON'],
  [()=>new Response(new Uint8Array([0xff])),'NBA_SOURCE_INVALID_JSON'],
  [()=>Response.json({success:false,error:secret}),'NBA_SOURCE_INVALID_SUCCESS'],
  [()=>{throw Error(secret);},'NBA_SOURCE_FETCH_FAILED']
 ]){
  const response=await handleNbaOutcomeSourceRequest(request(),{apiKey:secret,fetchImpl:async()=>factory(),clock:()=>now});
  const output=await response.json();assert.equal(response.status,502);assert.equal(output.error,want);assert.equal(JSON.stringify(output).includes(secret),false);
 }
 const missing=await handleNbaOutcomeSourceRequest(request(),{apiKey:'',fetchImpl:async()=>{throw Error('must not fetch');}});
 assert.equal(missing.status,503);assert.equal((await missing.json()).error,'NBA_SOURCE_CONFIGURATION');
});

test('rejects advertised and streamed bodies over four MiB',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();
 for(const response of [new Response('{}',{headers:{'content-length':String(4*1024*1024+1)}}),new Response('x'.repeat(4*1024*1024+1))]){
  const output=await handleNbaOutcomeSourceRequest(request(),{apiKey:secret,fetchImpl:async()=>response,clock:()=>now});
  assert.equal(output.status,502);assert.equal((await output.json()).error,'NBA_SOURCE_TOO_LARGE');
 }
});

test('aborts an unresponsive provider within the twelve-second request deadline',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();let signal;
 const started=Date.now();const response=await handleNbaOutcomeSourceRequest(request(),{apiKey:secret,fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
 assert.equal(response.status,502);assert.equal((await response.json()).error,'NBA_SOURCE_TIMEOUT');assert.equal(signal.aborted,true);
 assert.ok(Date.now()-started<14000,'Request must not exceed its bounded deadline');
});

test('edge entrypoint supplies only the server-side provider key and uses fallback env name',async()=>{
 const {handleNbaOutcomeSourceRequest}=await implementation();
 const path=new URL('../../supabase/functions/audit-nba-outcome-sources/index.ts',import.meta.url);assert.equal(existsSync(path),true);
 const source=readFileSync(path,'utf8').replace(/^import[^\n]+\n/,'');let handler,seenKey;
 Function('Deno','handleNbaOutcomeSourceRequest',source)({serve:fn=>{handler=fn;},env:{get:key=>key==='Sports_Game_Odds_API'?secret:undefined}},async(req,options)=>{seenKey=options.apiKey;return handleNbaOutcomeSourceRequest(req,{...options,fetchImpl:async()=>Response.json(fixture()),clock:()=>now});});
 assert.equal((await handler(request())).status,200);assert.equal(seenKey,secret);
});

