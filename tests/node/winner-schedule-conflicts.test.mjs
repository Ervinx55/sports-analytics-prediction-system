import test from 'node:test';
import assert from 'node:assert/strict';
import {createWinnerHandler,createWinnerSourceLoader} from '../../sharp-service/handlers/winner-forecasts.js';

const issueAt='2026-11-17T16:00:00Z',sourceAt='2026-11-17T15:59:00Z';
const env={SUPABASE_SERVICE_ROLE_KEY:'test-service-key',SPORTS_ODDS_API_KEY:'test-provider-key'};
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});

test('same teams and date with conflicting source kickoffs quarantine future captures without rewriting schedule identity',async()=>{
 const csv='game_id,season,week,game_type,gameday,gametime,home_team,away_team,home_score,away_score,result,location\n2026_11_JAX_NYG,2026,11,REG,2026-11-22,13:00,NYG,JAX,,,,Home\n2026_11_PIT_PHI,2026,11,REG,2026-11-22,16:25,PHI,PIT,,,,Home\n2026_11_IND_HOU,2026,11,REG,2026-11-22,13:00,HOU,IND,,,,Home\n';
 const quote=(eventID,home,away,startsAt)=>({eventID,leagueID:'NFL',type:'match',status:{startsAt},teams:{home:{names:{short:home}},away:{names:{short:away}}},odds:{'points-home-game-ml-home':{byBookmaker:{draftkings:{available:true,odds:-110,lastUpdatedAt:sourceAt}}},'points-away-game-ml-away':{byBookmaker:{draftkings:{available:true,odds:-110,lastUpdatedAt:sourceAt}}}}});
 const raw=[quote('jags','NYG','JAX','2026-11-22T21:25:00Z'),quote('steelers','PHI','PIT','2026-11-22T18:00:00Z'),quote('colts','HOU','IND','2026-11-22T18:00:00Z')];
 const load=createWinnerSourceLoader({env,now:()=>Date.parse(issueAt),optimize:async()=>({effectiveLimit:40}),providerFetch:async({url})=>({fetchedAt:Date.parse(sourceAt),payload:{data:new URL(url).searchParams.get('leagueID')==='NFL'?raw:[]}}),fetchImpl:async url=>new Response(url.includes('/basketball/nba/')?JSON.stringify({events:[]}):csv)});
 const source=await load({action:'refresh'}),events=source.groups.NFL.events;
 assert.equal(source.coverage.scheduleSourceConflictCount,2);
 assert.deepEqual(source.coverage.scheduleSourceConflicts.map(c=>c.eventID),['nflverse:2026_11_JAX_NYG','nflverse:2026_11_PIT_PHI']);
 for(const conflict of source.coverage.scheduleSourceConflicts){assert.equal(conflict.reason,'SCHEDULE_SOURCE_CONFLICT');assert.notEqual(conflict.scheduleStartsAt,conflict.providerStartsAt);assert.match(conflict.scheduleSourceHash,/^[a-f0-9]{64}$/);assert.match(conflict.providerSourceHash,/^[a-f0-9]{64}$/);}
 assert.equal(events[0].identityVerified,false);assert.equal(events[1].identityVerified,false);assert.equal(events[2].identityVerified,true);
 assert.equal(events[0].startsAt,'2026-11-22T18:00:00.000Z');assert.equal(events[1].startsAt,'2026-11-22T21:25:00.000Z');
 assert.deepEqual(source.quotes.map(q=>q.eventID),['nflverse:2026_11_IND_HOU']);
 let saved;const handler=createWinnerHandler({env,now:()=>Date.parse(issueAt),loadSources:async()=>source,store:{pending:async()=>[],append:async p=>{saved=p;return {captured:p.p_forecasts.length};}}});
 const res=response();await handler({method:'POST',headers:{authorization:'Bearer test-service-key'},body:{action:'refresh'}},res);
 assert.equal(res.code,200);assert.equal(saved.p_status.scheduleSourceConflicts,2);
 assert.ok(saved.p_forecasts.every(f=>!['nflverse:2026_11_JAX_NYG','nflverse:2026_11_PIT_PHI'].includes(f.event_id)));
});

test('public status exposes the aggregate schedule conflict count without source documents or event lists',async()=>{
 const handler=createWinnerHandler({env,store:{status:async()=>({quarantined_games:2,quality_flagged_events:2,cohorts:[{sport:'NFL',capture_window:'EARLY',games:13,eligible_games:11,quarantined_games:2}],latest:{generatedAt:issueAt,coverage:{scheduleSourceConflictCount:2,scheduleSourceConflicts:[{eventID:'private-identity'}]}}})}});
 const res=response();await handler({method:'GET'},res);
 assert.equal(res.code,200);assert.equal(res.body.latest.schedule_source_conflicts,2);assert.equal(JSON.stringify(res.body).includes('private-identity'),false);
 assert.equal(res.body.quarantined_games,2);assert.equal(res.body.quality_flagged_events,2);assert.equal(res.body.cohorts[0].eligible_games,11);assert.equal(res.body.cohorts[0].quarantined_games,2);
});
