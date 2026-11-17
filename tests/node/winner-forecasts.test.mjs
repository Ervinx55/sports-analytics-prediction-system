import test from 'node:test';
import assert from 'node:assert/strict';
import {createWinnerHandler,createWinnerSourceLoader,nflKickoff,parseWinnerScoreboard,parseWinnerNflSchedule,winnerOutcomeRevisions} from '../../sharp-service/handlers/winner-forecasts.js';
import {canonicalHash} from '../../sharp-service/lib/winner-prospective-models.js';
const env={SUPABASE_SERVICE_ROLE_KEY:'service-test-key'};
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});

test('winner writes require the service secret and reject caller-supplied sources or inference controls',async()=>{
 let calls=0;const handler=createWinnerHandler({env,store:{status:async()=>{calls++;return{};},append:async()=>{calls++;return{};}}});
 for(const [authorization,body,code] of [[undefined,{action:'refresh'},401],['Bearer wrong',{action:'settle'},401],['Bearer service-test-key',{action:'refresh',sourceUrl:'https://attacker.test'},400],['Bearer service-test-key',{action:'refresh',weights:{home:1}},400]]){
  const res=response();await handler({method:'POST',headers:{authorization},body},res);assert.equal(res.code,code);
 }
 assert.equal(calls,0);
});

test('public winner status exposes aggregate counts and never stored forecast documents',async()=>{
 const handler=createWinnerHandler({env,store:{status:async()=>({status:'COLLECTING',capturedForecasts:12,distinctGames:5,forecasts:[{secret:'private-source'}],sources:[{body:'raw'}]})}});
 const res=response();await handler({method:'GET',headers:{}},res);
 assert.equal(res.code,200);assert.equal(res.body.productionEligible,false);
 assert.equal(res.body.capturedForecasts,12);assert.equal(res.body.distinctGames,5);
 assert.equal(JSON.stringify(res.body).includes('private-source'),false);assert.equal('sources' in res.body,false);
});

test('NFL kickoff uses the exact Eastern calendar date across UTC midnight and DST',()=>{
 assert.equal(nflKickoff({gameday:'2026-11-19',gametime:'20:15'}),'2026-11-20T01:15:00.000Z');
 assert.equal(nflKickoff({gameday:'2026-09-10',gametime:'20:20'}),'2026-09-11T00:20:00.000Z');
 assert.equal(nflKickoff({gameday:'2026-11-19',gametime:''}),null);
});

test('NBA source rejects a repeated source ID with conflicting teams instead of choosing one',()=>{
 const team=(id,abbreviation,homeAway)=>({homeAway,team:{id,abbreviation},score:'100'});
 const game={id:'1',date:'2026-11-18T00:30:00Z',status:{type:{state:'pre',completed:false}},season:{year:2027},competitions:[{neutralSite:false,competitors:[team('1','BOS','home'),team('2','NY','away')]}]};
 const conflict=structuredClone(game);conflict.competitions[0].competitors[1].team.id='3';
 assert.throws(()=>parseWinnerScoreboard({events:[game,conflict]},'2026-11-17T16:00:00Z'),/CONFLICT/);
});

const sourceAt='2026-11-17T15:59:00Z',issueAt='2026-11-17T16:00:00Z',sourceHash='a'.repeat(64);
const sourceRow={source_hash:sourceHash,source_url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261117',fetched_at:sourceAt,body:{rawText:'fixture'}};
function collected(complete=true){
 const target={sport:'NBA',eventID:'espn:1',startsAt:'2026-11-18T00:30:00.000Z',season:2027,home:{id:'1',abbreviation:'BOS'},away:{id:'2',abbreviation:'NYK'},neutralSite:false,sourceIds:{espn:'1'},identityVerified:true,sourceFetchedAt:sourceAt,status:'SCHEDULED'};
 return {groups:{NBA:{events:[target],history:{complete,sourceSnapshots:[{sourceUrl:sourceRow.source_url,fetchedAt:sourceAt,sha256:sourceHash}],games:Array.from({length:4},(_,i)=>({eventId:'old'+i,startsAt:`2026-11-${String(10+i).padStart(2,'0')}T00:00:00Z`,home:'BOS',away:'NYK',homeScore:110+i,awayScore:100,completed:true}))}},NFL:{events:[],history:{schedule:[],sourceSnapshots:[],complete:false}}},sources:[structuredClone(sourceRow)],quotes:[],finals:[],coverage:{nbaHistoryComplete:complete,nflHistoryComplete:false}};
}

test('refresh atomically sends immutable forecast inputs with real receipt time and no lineup claims',async()=>{
 let saved;const handler=createWinnerHandler({env,now:()=>Date.parse(issueAt),loadSources:async()=>collected(),store:{pending:async()=>[],append:async p=>{saved=p;return {captured:p.p_forecasts.length,sourceCount:p.p_sources.length};}}});
 const res=response();await handler({method:'POST',headers:{authorization:'Bearer service-test-key'},body:{action:'refresh'}},res);
 assert.equal(res.code,200);assert.equal(res.body.captured,1);
 const candidate=saved.p_forecasts[0],input=saved.p_sources.find(s=>s.source_hash===candidate.input_hash);
 assert.equal(canonicalHash(input.body),candidate.input_hash);assert.equal(Date.parse(input.fetched_at),Date.parse(sourceAt));
 assert.equal(candidate.forecast.generatedAt,issueAt.replace('Z','.000Z'));
 assert.equal(candidate.forecast.lineup.verified,false);assert.equal(candidate.forecast.fullFeatureEligible,false);assert.equal(candidate.forecast.productionWeight,0);
 assert.equal(candidate.forecast.quoteComparison.pairs.length,0);assert.deepEqual(saved.p_status.checkedEvents,[]);
});

test('incomplete NBA history saves evidence but excludes prospective forecasts',async()=>{
 let saved;const handler=createWinnerHandler({env,now:()=>Date.parse(issueAt),loadSources:async()=>collected(false),store:{pending:async()=>[],append:async p=>{saved=p;return {captured:0};}}});
 const res=response();await handler({method:'POST',headers:{authorization:'Bearer service-test-key'},body:{action:'refresh'}},res);
 assert.equal(res.code,200);assert.equal(saved.p_forecasts.length,0);assert.equal(saved.p_status.excluded,1);assert.equal(saved.p_sources.length,1);
});

test('settlement preserves saved identity exactly and rejects changed teams or kickoff',()=>{
 const e={...collected().groups.NBA.events[0],status:'FINAL',homeScore:112,awayScore:105,sourceFetchedAt:'2026-11-18T04:00:00Z',sourceHash};
 const identity={eventID:e.eventID,startsAt:e.startsAt,home:e.home,away:e.away,sourceIds:e.sourceIds,season:2027,week:null,gameDate:null,neutralSite:false};
 const pending=[{sport:'NBA',event_id:e.eventID,forecast:{identity}}],sources=[{...sourceRow,fetched_at:e.sourceFetchedAt}];
 const result=winnerOutcomeRevisions(pending,[e],sources,e.sourceFetchedAt);
 assert.equal(result.rows.length,1);assert.deepEqual(result.rows[0].outcome.identity,identity);assert.equal(result.rows[0].outcome.status,'FINAL');assert.equal(result.rows[0].outcome.source,'ESPN_SCOREBOARD');
 assert.equal(result.rows[0].outcome.sourceAuthority,'PROVIDER_REPORTED_FINAL');assert.equal(result.rows[0].outcome.leagueOfficialVerified,false);
 const conflict=winnerOutcomeRevisions(pending,[{...e,away:{id:'3',abbreviation:'NYK'}}],sources,e.sourceFetchedAt);
 assert.equal(conflict.rows.length,0);assert.deepEqual(conflict.conflicts,['espn:1']);
 assert.equal(winnerOutcomeRevisions(pending,[{...e,startsAt:'2026-11-18T00:31:00Z'}],sources,e.sourceFetchedAt).rows.length,0);
 const later=winnerOutcomeRevisions(pending,[e],sources,'2026-11-19T04:00:00Z');
 assert.equal(later.rows[0].observed_at,e.sourceFetchedAt);
});

test('NBA source acquisition is bounded to 21 prior Eastern dates and two upcoming dates',async()=>{
 const urls=[];let active=0,peak=0;
 const load=createWinnerSourceLoader({env:{},now:()=>Date.parse(issueAt),fetchImpl:async url=>{
  urls.push(url);if(url.includes('/basketball/nba/')){active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;return new Response(JSON.stringify({events:[]}));}
  return new Response('game_id,season,week,game_type,gameday,gametime,home_team,away_team,home_score,away_score,result,location\n2026_12_IND_HOU,2026,12,REG,2026-11-19,20:15,HOU,IND,,,,Home\n');
 }});
 const result=await load({action:'refresh'});
 assert.equal(urls.filter(u=>u.includes('/basketball/nba/')).length,23);assert.ok(peak<=6);
 assert.equal(result.coverage.nbaHistoryDays,21);assert.equal(result.groups.NBA.history.complete,true);
 assert.equal(result.groups.NFL.events.length,1);assert.equal(result.groups.NFL.events[0].eventID,'nflverse:2026_12_IND_HOU');
 assert.equal(result.groups.NFL.events[0].startsAt,'2026-11-20T01:15:00.000Z');
 assert.equal(result.sources.length,24);assert.equal(new Set(result.sources.map(s=>s.source_hash)).size,24);
});

test('conflicting SGO event IDs cannot silently choose the first moneyline mapping',async()=>{
 const raw={leagueID:'NBA',type:'match',status:{startsAt:'2026-11-18T00:30:00Z'},teams:{home:{names:{short:'BOS'}},away:{names:{short:'NY'}}},odds:{'points-home-game-ml-home':{byBookmaker:{draftkings:{available:true,odds:-110,lastUpdatedAt:sourceAt}}},'points-away-game-ml-away':{byBookmaker:{draftkings:{available:true,odds:-110,lastUpdatedAt:sourceAt}}}}};
 const upcoming={id:'1',date:raw.status.startsAt,season:{year:2027},status:{type:{state:'pre'}},competitions:[{competitors:[{homeAway:'home',team:{id:'1',abbreviation:'BOS'}},{homeAway:'away',team:{id:'2',abbreviation:'NY'}}]}]};
 const load=createWinnerSourceLoader({env:{SPORTS_ODDS_API_KEY:'sgo-test'},now:()=>Date.parse(issueAt),optimize:async()=>({effectiveLimit:40}),providerFetch:async({url})=>({fetchedAt:Date.parse(sourceAt),payload:{data:new URL(url).searchParams.get('leagueID')==='NBA'?[{...raw,eventID:'first'},{...raw,eventID:'second'}]:[]}}),fetchImpl:async url=>url.includes('/basketball/nba/')?new Response(JSON.stringify({events:url.includes('dates=20261117')?[upcoming]:[]})):new Response('',{status:503})});
 const result=await load({action:'refresh'});
 assert.equal(result.quotes.length,0);assert.equal(result.groups.NBA.events[0].sourceIds.sgo,undefined);
});

test('collection deadline aborts source work without writing partial forecasts',async()=>{
 let writes=0,aborted=false;
 const handler=createWinnerHandler({env,collectionTimeoutMs:5,store:{pending:async()=>[],append:async()=>{writes++;}},loadSources:async({signal})=>new Promise(()=>signal.addEventListener('abort',()=>{aborted=true;}))});
 const res=response();await handler({method:'POST',headers:{authorization:'Bearer service-test-key'},body:{action:'refresh'}},res);
 assert.equal(res.code,503);assert.equal(writes,0);assert.equal(aborted,true);
});

test('identical content retains its content identity while preserving the later receipt timestamp',async()=>{
 let time=Date.parse(issueAt);
 const load=createWinnerSourceLoader({env:{},now:()=>time,fetchImpl:async url=>url.includes('/basketball/nba/')?new Response(JSON.stringify({events:[]})):new Response('game_id,season,week,game_type,gameday,gametime,home_team,away_team,home_score,away_score,result,location\n2026_12_IND_HOU,2026,12,REG,2026-11-19,20:15,HOU,IND,,,,Home\n')});
 const first=await load({action:'refresh'});time+=60000;const second=await load({action:'refresh'});
 const a=first.sources.find(s=>s.source_url.includes('raw.githubusercontent.com')),b=second.sources.find(s=>s.source_url===a.source_url);
 assert.equal(a.body.rawSha256,b.body.rawSha256);assert.notEqual(a.fetched_at,b.fetched_at);assert.equal(a.source_hash,b.source_hash);
});

test('conflicting NFL final score and result rows cannot enter model history',()=>{
 const csv='game_id,season,week,game_type,gameday,gametime,home_team,away_team,home_score,away_score,result,location\n2026_10_IND_HOU,2026,10,REG,2026-11-08,13:00,HOU,IND,21,10,-3,Home\n2026_12_IND_HOU,2026,12,REG,2026-11-19,20:15,HOU,IND,,,,Home\n';
 const parsed=parseWinnerNflSchedule(csv,sourceAt);
 assert.deepEqual(parsed.schedule.map(r=>r.game_id),['2026_12_IND_HOU']);
 assert.equal(parsed.rejectedHistoryRows.length,1);
});

test('a malformed historical response is retried instead of being cached for six hours',async()=>{
 let attempts=0;
 const load=createWinnerSourceLoader({env:{},now:()=>Date.parse(issueAt),fetchImpl:async url=>{
  if(!url.includes('/basketball/nba/'))return new Response('',{status:503});
  if(url.includes('dates=20261027')&&++attempts===1)return new Response('{invalid');
  return new Response(JSON.stringify({events:[]}));
 }});
 const first=await load({action:'refresh'}),second=await load({action:'refresh'});
 assert.equal(first.groups.NBA.history.complete,false);assert.equal(second.groups.NBA.history.complete,true);assert.equal(attempts,2);
});
