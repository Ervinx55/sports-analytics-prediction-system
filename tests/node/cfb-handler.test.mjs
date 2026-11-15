import test from 'node:test';import assert from 'node:assert/strict';
import {createCfbHandler} from '../../sharp-service/handlers/cfb-forecasts.js';
import {normalizeEspnGame} from '../../sharp-service/lib/cfb-sources.js';
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.data=data;return this;}});
test('CFB private collection rejects missing/wrong auth before any upstream calls',async()=>{
 let calls=0;const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'server-key'},fetchImpl:async()=>{calls++;throw Error('never');}});
 for(const authorization of [undefined,'Bearer fake']){const r=response();await handler({method:'POST',headers:{authorization},body:{action:'refresh'}},r);assert.equal(r.code,401);}
 assert.equal(calls,0);
});
test('CFB public read returns explicit uninitialized state and never leaks private source records',async()=>{
 const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'server-key'},fetchImpl:async()=>({ok:true,json:async()=>[]})});const r=response();await handler({method:'GET'},r);assert.equal(r.code,200);assert.deepEqual(r.data.forecasts,[]);assert.equal(r.data.status,'AWAITING_COLLECTION');
});
test('CFB admin rejects arbitrary provider URLs, unknown actions and invalid season',async()=>{
 let calls=0;const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'server-key'},fetchImpl:async()=>{calls++;throw Error('never');}});
 for(const body of [{action:'fetch',url:'https://evil.example'},{action:'history',season:1800}]){const r=response();await handler({method:'POST',headers:{authorization:'Bearer server-key'},body},r);assert.equal(r.code,400);}
 assert.equal(calls,0);
});
test('CFB successful minimal database inserts do not cause a JSON parsing 503',async()=>{
 let providerCalls=0;const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'server-key',SPORTS_ODDS_API_KEY:'provider-key'},now:()=>Date.parse('2026-11-14T16:00:00Z'),optimize:async()=>({blocked:false,effectiveLimit:100}),providerFetch:async({url})=>{providerCalls++;assert.match(url,/finalized=true/);assert.doesNotMatch(url,/oddsAvailable/);return {payload:{data:[],nextCursor:null},fetchedAt:Date.parse('2026-11-14T16:00:00Z'),ageMs:0};},fetchImpl:async(url,options)=>url.includes('/rpc/')?{ok:true,status:200,text:async()=>'true'}:{ok:true,status:options.method==='DELETE'?204:201,text:async()=>''}});
 const r=response();await handler({method:'POST',headers:{authorization:'Bearer server-key'},body:{action:'history',season:2025}},r);assert.equal(r.code,200);assert.equal(r.data.status,'COLLECTED');assert.equal(providerCalls,1);
});
test('CFB refresh resumes pages, merges postseason, batches settlement and delegates capture time to database',async()=>{
 let clock=Date.parse('2026-11-14T16:29:50Z');const starts='2026-11-14T17:00:00Z',fetched='2026-11-14T15:00:00Z';
 const event=(id,date,final)=>({id,date,season:{year:2026},competitions:[{neutralSite:false,status:{type:{completed:final}},competitors:[{homeAway:'home',team:{id:'1',displayName:'Home',location:'Home'},score:final?'20':'0'},{homeAway:'away',team:{id:'2',displayName:'Away',location:'Away'},score:final?'10':'0'}]}]});
 const events=[...Array.from({length:8},(_,i)=>event('h'+i,`2026-09-${String(i+1).padStart(2,'0')}T17:00Z`,true)),event('espn-game',starts,false)];
 const games=events.map(e=>({...normalizeEspnGame(e,fetched),fbsVerified:true}));
 const source={membership:{2026:['1','2']},schedules:['1','2'].map(teamID=>({teamID,season:2026,fetchedAt:fetched,games})),games,complete:true,conflicts:[]};
 const docs=new Map([['source-current',source],['frozen-model',{modelVersion:'v1',config:{k:24,homeAdvantage:35,carry:.75}}]]),urls=[],calls=[];
 const json=(body,status=200)=>({ok:true,status,text:async()=>body===null?'':JSON.stringify(body),json:async()=>body});
 const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'server-key',SPORTS_ODDS_API_KEY:'provider'},now:()=>clock,optimize:async()=>({effectiveLimit:100}),providerFetch:async({url})=>{urls.push(url);clock+=10000;return {ageMs:0,fetchedAt:clock,payload:{data:urls.length===1?[{eventID:'sgo-game',leagueID:'NCAAF',status:{startsAt:starts},teams:{home:{teamID:'H',names:{long:'Home'}},away:{teamID:'A',names:{long:'Away'}}}}]:[],nextCursor:urls.length===1?'page-two':'page-three'}};},fetchImpl:async(url,options)=>{
  calls.push({url,options});const u=new URL(url),body=options.body?JSON.parse(options.body):null;
  if(u.hostname==='site.api.espn.com'){const id=u.pathname.split('/').at(-2),post=u.searchParams.get('seasontype')==='3';return json({team:{id},status:'success',requestedSeason:{year:2026,type:post?3:2},events:post?[]:events});}
  if(u.pathname.endsWith('/claim_cfb_collection'))return json(true);
  if(u.pathname.endsWith('/capture_cfb_forecasts')){assert.equal(body.p_rows.length,1);assert.equal(Object.hasOwn(body.p_rows[0],'captured_at'),false);assert.ok(Date.parse(starts)-clock<30*60000);return json([]);}
  if(u.pathname.endsWith('/record_cfb_capture_scope'))return json(null);
  if(u.pathname.endsWith('/cfb_research_performance'))return json({captured:0,n:0,capturedEspnIDs:[]});
  if(u.pathname.endsWith('/cfb_prospective_forecasts')){assert.equal(u.searchParams.get('limit'),'40');assert.equal(u.searchParams.get('order'),'starts_at.asc,event_id.asc');return json([]);}
  if(options.method==='DELETE')return json(null,204);
  if(options.method==='POST'){docs.set(body.doc_key,body.body);return json(null,201);}
  const key=u.searchParams.get('doc_key')?.slice(3);return json(docs.has(key)?[{body:docs.get(key)}]:[]);
 }});
 const r=response();await handler({method:'POST',headers:{authorization:'Bearer server-key'},body:{action:'refresh'}},r);
 assert.equal(r.code,200);assert.equal(r.data.captured,0);assert.equal(r.data.forecasts.length,1);assert.match(urls[1],/cursor=page-two/);assert.equal(docs.get('provider-pagination').cursor,'page-three');assert.equal(calls.filter(c=>c.url.includes('seasontype=3')).length,2);
 assert.equal(calls.filter(c=>c.url.includes('/cfb_outcome_revisions')).length,0);
});

test('CFB refresh settles agreed finals during a partial rotation and excludes an unrelated score conflict',async()=>{
 const stamp='2026-11-15T05:00:00.000Z',ids=Array.from({length:10},(_,i)=>String(i+1));
 const game=(id,homeID,awayID,homeScore=20)=>({id,source:'ESPN',season:2026,startsAt:'2026-11-14T17:00:00.000Z',homeID,awayID,homeName:'Home '+homeID,awayName:'Away '+awayID,homeScore,awayScore:10,completed:true,cancelled:false,neutralSite:false,fetchedAt:stamp});
 const good=game('agreed','1','2'),bad=game('conflict','3','4');
 const schedules=ids.map(teamID=>({teamID,season:2026,fetchedAt:stamp,games:teamID==='1'||teamID==='2'?[good]:teamID==='3'?[bad]:teamID==='4'?[{...bad,homeScore:24}]:[]}));
 const source={membership:{2026:ids},schedules:schedules.map(s=>({...s,games:s.games.map(g=>({...g,completed:false,homeScore:null,awayScore:null}))})),games:[good,bad].map(g=>({...g,completed:false,homeScore:null,awayScore:null})),complete:true,conflicts:[]};
 const original=JSON.stringify(source),frozen={modelVersion:'frozen',config:{k:24,homeAdvantage:35,carry:.75}};
 const docs=new Map([['source-current',structuredClone(source)],['source-staging',{...structuredClone(source),schedules,refreshOffset:0}],['frozen-model',frozen]]),writes=[];
 const json=(body,status=200)=>({ok:true,status,text:async()=>body===null?'':JSON.stringify(body),json:async()=>body});
 const handler=createCfbHandler({env:{SUPABASE_SERVICE_ROLE_KEY:'key',SPORTS_ODDS_API_KEY:'provider'},now:()=>Date.parse(stamp),optimize:async()=>({effectiveLimit:100}),providerFetch:async()=>({payload:{data:[]},fetchedAt:Date.parse(stamp),ageMs:0}),fetchImpl:async(url,options)=>{
  const u=new URL(url),body=options.body?JSON.parse(options.body):null;
  if(u.hostname==='site.api.espn.com'){
   const teamID=u.pathname.split('/').at(-2),post=u.searchParams.get('seasontype')==='3';
   const events=post?[]:schedules.find(s=>s.teamID===teamID).games.map(g=>({id:g.id,date:g.startsAt,season:{year:2026},competitions:[{neutralSite:false,status:{type:{completed:true}},competitors:[{homeAway:'home',team:{id:g.homeID,displayName:g.homeName},score:String(g.homeScore)},{homeAway:'away',team:{id:g.awayID,displayName:g.awayName},score:String(g.awayScore)}]}]}));
   return json({team:{id:teamID},status:'success',requestedSeason:{year:2026,type:post?3:2},events});
  }
  if(u.pathname.endsWith('/claim_cfb_collection'))return json(true);
  if(u.pathname.endsWith('/cfb_prospective_forecasts'))return json([good,bad].map(g=>({event_id:'sgo-'+g.id,starts_at:g.startsAt,forecast:{espnEventID:g.id}})));
  if(u.pathname.endsWith('/cfb_outcome_revisions')){writes.push(...body);return json(null,201);}
  if(u.pathname.endsWith('/record_cfb_capture_scope'))return json(null);
  if(u.pathname.endsWith('/cfb_research_performance'))return json({captured:2,n:1,capturedEspnIDs:[]});
  if(options.method==='DELETE')return json(null,204);
  if(options.method==='POST'){docs.set(body.doc_key,body.body);return json(null,201);}
  const key=u.searchParams.get('doc_key')?.slice(3);return json(docs.has(key)?[{body:docs.get(key)}]:[]);
 }});
 const r=response();await handler({method:'POST',headers:{authorization:'Bearer key'},body:{action:'refresh'}},r);
 assert.equal(r.code,200);assert.equal(writes.find(x=>x.event_id==='sgo-agreed')?.outcome.valid,true);
 assert.equal(writes.find(x=>x.event_id==='sgo-agreed').outcome.homeScore,20);
 assert.equal(writes.find(x=>x.event_id==='sgo-conflict')?.outcome.valid,false);
 assert.equal(writes.find(x=>x.event_id==='sgo-conflict').outcome.reason,'SCHEDULE_OBSERVATIONS_CONFLICT');
 assert.equal(r.data.coverage.outcomeSourceConflicts,1);
 assert.equal(JSON.stringify(docs.get('source-current')),original);assert.deepEqual(docs.get('frozen-model'),frozen);
 assert.equal(docs.get('source-staging').refreshOffset,8);
});
