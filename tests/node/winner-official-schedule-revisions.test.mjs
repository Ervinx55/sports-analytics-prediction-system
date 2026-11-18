import test from 'node:test';
import assert from 'node:assert/strict';
import {NFL_SCHEDULE_REVISIONS,validScheduleRevision,scheduleRevisionHash,applyOfficialScheduleRevision,cloneScheduleForRevision,resolveOfficialScheduleFinal} from '../../sharp-service/lib/winner-schedule-revisions.js';
import {createWinnerSourceLoader,winnerOutcomeRevisions} from '../../sharp-service/handlers/winner-forecasts.js';
import {buildWinnerCandidates} from '../../sharp-service/lib/winner-capture-policy.js';
import {createWinnerModelManifest,projectWinnerBaseline} from '../../sharp-service/lib/winner-prospective-models.js';
const issuedAt='2026-11-17T18:00:00.000Z',receipt='2026-11-17T17:59:45.000Z';
const source={source_hash:'a'.repeat(64),fetched_at:receipt};
const event=r=>({sport:'NFL',eventID:r.baseEventID,startsAt:r.oldStartsAt,season:r.season,week:r.week,gameDate:r.gameDate,home:{id:r.home,abbreviation:r.home},away:{id:r.away,abbreviation:r.away},neutralSite:false,sourceIds:{nflverse:r.providerGameID},identityVerified:true,sourceFetchedAt:receipt,status:'SCHEDULED'});
const provider=r=>({eventID:r.sourceEventId,leagueID:'NFL',type:'match',status:{startsAt:r.startsAt},home:r.home,away:r.away});
const priorRows=r=>[8,9,10].map(week=>({game_id:`2026_${String(week).padStart(2,'0')}_${r.away}_${r.home}`,season:'2026',week:String(week),game_type:'REG',gameday:`2026-11-${String(1+(week-8)*7).padStart(2,'0')}`,gametime:'13:00',home_team:r.home,away_team:r.away,home_score:'24',away_score:'20',result:'4',location:'Home'}));
const targetRow=r=>({game_id:r.providerGameID,season:'2026',week:'11',game_type:'REG',gameday:r.gameDate,gametime:r.home==='NYG'?'13:00':'16:25',home_team:r.home,away_team:r.away,home_score:'',away_score:'',result:'',location:'Home'});

test('official revisions bind exact source receipts and require new kickoff agreement without mutating original identity',()=>{
 for(const r of NFL_SCHEDULE_REVISIONS){const e=event(r),before=structuredClone(e);assert.equal(validScheduleRevision(r,issuedAt),true);assert.equal(r.revisionHash,scheduleRevisionHash(r));
  const revised=applyOfficialScheduleRevision({event:e,provider:provider(r),providerSource:source,issuedAt});
  assert.equal(revised.eventID,r.eventID);assert.equal(revised.providerEventID,r.baseEventID);assert.equal(revised.startsAt,r.startsAt);assert.deepEqual(e,before);
  for(const change of [p=>p.home='DAL',p=>p.eventID='wrong',p=>p.status.startsAt=r.oldStartsAt,p=>p.status.started=true]){const p=provider(r);change(p);assert.equal(applyOfficialScheduleRevision({event:e,provider:p,providerSource:source,issuedAt}),null);}
  assert.equal(applyOfficialScheduleRevision({event:e,provider:provider(r),providerSource:{...source,fetched_at:r.startsAt},issuedAt:r.startsAt}),null);
  assert.equal(applyOfficialScheduleRevision({event:e,provider:provider(r),providerSource:{...source,fetched_at:'2026-11-17T17:58:59.000Z'},issuedAt}),null);
  const forged={...r,home:'DAL'};forged.revisionHash=scheduleRevisionHash(forged);forged.eventID=forged.baseEventID+':schedule:'+forged.revisionHash;assert.equal(validScheduleRevision(forged,issuedAt),false);
  assert.equal(validScheduleRevision({...r,announcementFetchedAt:r.startsAt},issuedAt),false);
 }
});

test('only target kickoff is cloned and frozen NFL inference is identical',()=>{
 for(const r of NFL_SCHEDULE_REVISIONS){const original=event(r),schedule=[...priorRows(r),targetRow(r)],before=structuredClone(schedule),history={complete:true,schedule};
  const revised=applyOfficialScheduleRevision({event:original,provider:provider(r),providerSource:source,issuedAt}),corrected=cloneScheduleForRevision(schedule,revised);
  assert.deepEqual(schedule,before);assert.deepEqual(corrected.slice(0,3),schedule.slice(0,3));assert.notEqual(corrected[3].gametime,schedule[3].gametime);
  assert.deepEqual(projectWinnerBaseline({sport:'NFL',event:original,history,issuedAt}),projectWinnerBaseline({sport:'NFL',event:revised,history:{...history,schedule:corrected},issuedAt}));
  assert.equal(createWinnerModelManifest('NFL').productionWeight,0);
 }
});

test('loader restores both evidence-qualified games with exact paired quotes and unchanged raw schedule source',async()=>{
 const all=NFL_SCHEDULE_REVISIONS.flatMap(r=>[...priorRows(r),targetRow(r)]),fields=Object.keys(all[0]),csv=fields.join(',')+'\n'+all.map(r=>fields.map(k=>r[k]).join(',')).join('\n');
 const raw=NFL_SCHEDULE_REVISIONS.map(r=>({...provider(r),teams:{home:{names:{short:r.home}},away:{names:{short:r.away}}},odds:{'points-home-game-ml-home':{byBookmaker:{draftkings:{available:true,odds:-110,lastUpdatedAt:receipt}}},'points-away-game-ml-away':{byBookmaker:{draftkings:{available:true,odds:-110,lastUpdatedAt:receipt}}}}}));
 const load=createWinnerSourceLoader({now:()=>Date.parse(issuedAt),env:{SPORTS_ODDS_API_KEY:'fixture'},optimize:async()=>({effectiveLimit:40}),providerFetch:async({url})=>{await new Promise(resolve=>setTimeout(resolve,5));return {fetchedAt:Date.parse(receipt),payload:{data:new URL(url).searchParams.get('leagueID')==='NFL'?raw:[]}};},fetchImpl:async url=>new Response(url.includes('/basketball/nba/')?' {"events":[]}':csv)});
 const data=await load({action:'refresh'});assert.equal(data.coverage.scheduleSourceConflictCount,0);assert.equal(data.coverage.scheduleRevisionsApplied.length,2);
 assert.equal(data.sources.find(s=>s.source_url.includes('nflverse')).body.rawText,csv);
 assert.deepEqual(data.coverage.lineups.readiness.map(r=>[r.eventID,r.startsAt]),NFL_SCHEDULE_REVISIONS.map(r=>[r.eventID,r.startsAt]));
 const modelManifest=createWinnerModelManifest('NFL');
 const built=buildWinnerCandidates({sport:'NFL',...data.groups.NFL,quotes:data.quotes,observedAt:issuedAt,issuedAt,modelManifest});assert.equal(built.excluded.length,0,JSON.stringify(built.excluded));assert.equal(built.candidates.length,2);
 for(const c of built.candidates){assert.equal(c.forecast.quoteComparisonEligible,true);assert.equal(c.forecast.productionWeight,0);assert.match(c.event_id,/:schedule:[a-f0-9]{64}$/);assert.ok(c.forecast.identity.providerEventID);}
 const noQuotes=buildWinnerCandidates({sport:'NFL',...data.groups.NFL,quotes:[],observedAt:issuedAt,issuedAt,modelManifest});assert.equal(noQuotes.candidates.length,0);assert.ok(noQuotes.excluded.every(x=>x.reason==='SCHEDULE_REVISION_PAIRED_PRICE_REQUIRED'));
});

test('finals resolve only the exact corrected identity and never settle excluded original captures',()=>{
 const r=NFL_SCHEDULE_REVISIONS[0],received='2026-11-23T01:00:00.000Z',e={...event(r),status:'FINAL',homeScore:24,awayScore:20,sourceFetchedAt:received,sourceHash:'b'.repeat(64)};
 const resolved=resolveOfficialScheduleFinal(e,received);assert.equal(resolved.eventID,r.eventID);assert.equal(resolved.startsAt,r.startsAt);
 const identity={eventID:r.eventID,providerEventID:r.baseEventID,scheduleRevisionHash:r.revisionHash,startsAt:r.startsAt,home:e.home,away:e.away,sourceIds:e.sourceIds};
 const snapshots=[{source_hash:e.sourceHash,source_url:'https://example.invalid/final',fetched_at:received}];
 const pending=[{sport:'NFL',event_id:r.baseEventID,forecast:{identity:{...identity,eventID:r.baseEventID,startsAt:r.oldStartsAt}}},{sport:'NFL',event_id:r.eventID,forecast:{identity}}];
 const result=winnerOutcomeRevisions(pending,[resolved],snapshots,received);assert.equal(result.rows.length,1);assert.equal(result.rows[0].event_id,r.eventID);assert.deepEqual(result.rows[0].outcome.identity,identity);
 assert.equal(resolveOfficialScheduleFinal({...e,home:{id:'DAL',abbreviation:'DAL'}},received).status,'UNAVAILABLE');
 assert.equal(resolveOfficialScheduleFinal({...e,startsAt:'2026-11-22T20:00:00.000Z'},received).status,'UNAVAILABLE');
});
