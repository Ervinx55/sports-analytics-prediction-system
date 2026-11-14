import test from 'node:test';import assert from 'node:assert/strict';
import {outcomeRevision,captureCandidate} from '../../sharp-service/lib/cfb-collection-policy.js';
test('CFB conflicting kickoff keeps the forecast but excludes the provider price snapshot',()=>{
 const f={eventID:'g',modelVersion:'v',startsAt:'2026-11-15T04:00Z',quoteComparisonEligible:false,providerStartsAt:'2026-11-15T03:00Z'},event={odds:{moneyline:{book:-110}}};
 const row=captureCandidate(f,event,'2026-11-14T18:00Z','hash');
 assert.deepEqual(row.forecast.entryQuotes,{});assert.equal(row.forecast.entryQuoteWithheldReason,'PROVIDER_KICKOFF_CONFLICT');assert.equal(row.starts_at,f.startsAt);assert.equal(row.forecast.providerStartsAt,f.providerStartsAt);
 assert.deepEqual(captureCandidate({...f,quoteComparisonEligible:true},event,'2026-11-14T18:00Z','hash').forecast.entryQuotes,event.odds);
});
test('CFB result A to B to A records the restoring observation and deduplicates its replay',()=>{
 const prediction={event_id:'sgo',starts_at:'2026-11-14T17:00Z'},a={id:'espn',startsAt:prediction.starts_at,completed:true,homeScore:20,awayScore:10,fetchedAt:'2026-11-14T22:00Z'};
 const first=outcomeRevision(prediction,a),second=outcomeRevision(prediction,{...a,homeScore:10,awayScore:20,fetchedAt:'2026-11-14T23:00Z'}),restored=outcomeRevision(prediction,{...a,fetchedAt:'2026-11-15T00:00Z'});
 assert.equal(new Set([first,second,restored].map(r=>r.evidence_hash)).size,3);
 assert.deepEqual(outcomeRevision(prediction,{...a,fetchedAt:'2026-11-15T00:00Z'}),restored);
 assert.equal(outcomeRevision(prediction,{...a,fetchedAt:null}),null);
});
import {providerWindow,mergeCurrentForecasts,mergeSeasonSchedules} from '../../sharp-service/lib/cfb-collection-policy.js';
test('CFB reviewed kickoff keeps the earlier provider event in the collection window until verified start',()=>{
 for(const time of ['2026-11-15T03:15Z','2026-11-15T03:45Z']){
  assert.ok(Date.parse(providerWindow(null,Date.parse(time)).startsAfter)<Date.parse('2026-11-15T03:00Z'));
  const stale={startsAfter:'2026-11-15T03:00Z',startsBefore:'2026-11-17T03:00Z',cursor:'later-page',pages:1};
  assert.equal(providerWindow(stale,Date.parse(time)).cursor,null);
 }
 assert.equal(providerWindow(null,Date.parse('2026-11-15T04:00Z')).startsAfter,'2026-11-15T04:00:00.000Z');
});
test('CFB resumes the bounded provider window and resets only an expired or completed walk',()=>{const now=Date.parse('2026-11-14T16:00Z'),first=providerWindow(null,now),next={...first,cursor:'page-two',pages:1};assert.deepEqual(providerWindow(next,now+900000),next);assert.equal(providerWindow(next,now+5*3600000).cursor,null);assert.equal(providerWindow({...next,cursor:null},now+3600000).startsAfter,'2026-11-14T17:00:00.000Z');});
test('CFB retains still-fresh earlier-page forecasts without retimestamping or keeping expired versions',()=>{const now=Date.parse('2026-11-14T16:00Z'),old={eventID:'old',modelVersion:'v1',generatedAt:'2026-11-14T15:45Z',startsAt:'2026-11-14T18:00Z'},fresh={...old,eventID:'new',generatedAt:'2026-11-14T16:00Z'};const rows=mergeCurrentForecasts([fresh],[old],'v1',now);assert.equal(rows.length,2);assert.equal(rows[0].generatedAt,old.generatedAt);assert.equal(mergeCurrentForecasts([],rows,'v2',now).length,0);assert.equal(mergeCurrentForecasts([],rows,'v1',now+1800001).length,0);});
test('CFB current-season postseason extends rather than replaces regular history',()=>{const r={teamID:'1',season:2026,games:[{id:'regular'}]},p={teamID:'1',season:2026,games:[{id:'bowl'}]};assert.equal(mergeSeasonSchedules(r,p).games.length,2);assert.throws(()=>mergeSeasonSchedules(r,{...p,teamID:'2'}));assert.throws(()=>mergeSeasonSchedules(r,{...p,games:[{id:'regular'}]}));});
