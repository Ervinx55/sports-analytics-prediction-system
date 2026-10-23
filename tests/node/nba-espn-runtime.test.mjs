import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEspnNbaRuntime} from '../../supabase/functions/_shared/nba-espn-runtime.mjs';

const board=JSON.parse(readFileSync(new URL('../fixtures/performance/nba-scoreboard.json',import.meta.url)));
const final=JSON.parse(readFileSync(new URL('../fixtures/performance/nba-final-result.json',import.meta.url))).payload;
// The result fixture intentionally omits its event date; provide a synthetic past start for this runtime contract.
final.header.competitions[0].date='2024-11-03T00:00:00Z';
const now='2026-10-21T12:00:00.000Z';
const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const runtime=(fetchImpl,extra={})=>createEspnNbaRuntime({fetchImpl,clock:()=>now,...extra});

test('scoreboard retains numeric ESPN identities and final scores; live scores remain unknown',async()=>{
 const live=structuredClone(board.events[0]);live.id='401705279';live.uid='s:40~l:46~e:401705279';live.competitions[0].id=live.id;live.competitions[0].status.type={name:'STATUS_IN_PROGRESS',state:'in',completed:false};
 const data={...board,events:[board.events[0],live]};
 const r=await runtime(async()=>response(data)).scoreboard({date:'20241021',cutoffAt:now});
 assert.equal(r.ok,true);assert.equal(r.events[0].eventKey,'espn:nba:401705278');assert.equal(r.events[0].homeTeamId,'20');assert.equal(r.events[0].awayScore,116);
 assert.equal(r.events[1].status,'LIVE');assert.equal(r.events[1].homeScore,null);
});
test('completed summary reuses strict player normalizer and preserves missing values',async()=>{
 const r=await runtime(async()=>response(final)).completedGames({eventIds:['401705278'],cutoffAt:now});
 assert.equal(r[0].ok,true);assert.equal(r[0].result.eventKey,'espn:nba:401705278');
 assert.equal(r[0].result.players['espn:nba:4278049'].stats.points,12);
 assert.equal(r[0].result.sourceUpdatedAt,null);
 const missing=structuredClone(final);delete missing.boxscore;
 const m=await runtime(async()=>response(missing)).completedGames({eventIds:['401705278'],cutoffAt:now});
 assert.equal(m[0].reason,'INCOMPLETE_BOXSCORE');
});
test('historical cutoff and future result never become available',async()=>{
 let calls=0;const loader=runtime(async()=>{calls++;return response(final)});
 assert.equal((await loader.completedGames({eventIds:['401705278'],cutoffAt:'2026-10-20T00:00:00Z'}))[0].reason,'HISTORICAL_CUTOFF_UNVERIFIABLE');
 assert.equal((await loader.scoreboard({date:'20241021',cutoffAt:'2026-10-20T00:00:00Z'})).reason,'HISTORICAL_CUTOFF_UNVERIFIABLE');assert.equal(calls,0);
 const future=structuredClone(final);future.header.competitions[0].status.type={name:'STATUS_IN_PROGRESS',state:'in',completed:false};
 assert.equal((await runtime(async()=>response(future)).completedGames({eventIds:['401705278'],cutoffAt:now}))[0].reason,'RESULT_NOT_FINAL');
});
test('present retrieval works without an invented future cutoff, while a future final start is rejected',async()=>{
 let tick=0;const loader=createEspnNbaRuntime({fetchImpl:async()=>response(final),clock:()=>new Date(Date.parse(now)+tick++*1000).toISOString()});
 const current=await loader.completedGames({eventIds:['401705278']});
 assert.equal(current[0].ok,true);assert.ok(Date.parse(current[0].retrievedAt)>Date.parse(now));
 const future=structuredClone(final);future.header.competitions[0].date='2026-10-22T00:00:00Z';
 assert.equal((await runtime(async()=>response(future)).completedGames({eventIds:['401705278']}))[0].reason,'INVALID_EVENT_DATE');
 const undated=structuredClone(final);delete undated.header.competitions[0].date;
 assert.equal((await runtime(async()=>response(undated)).completedGames({eventIds:['401705278']}))[0].reason,'INVALID_EVENT_DATE');
});
test('mismatched identity, invalid scoreboard, HTTP failures and timeout are unavailable',async()=>{
 const wrong=structuredClone(final);wrong.header.id='999';
 assert.equal((await runtime(async()=>response(wrong)).completedGames({eventIds:['401705278'],cutoffAt:now}))[0].reason,'INVALID_RESULT_IDENTITY');
 const invalid=structuredClone(board);invalid.events[0].uid='wrong';
 assert.equal((await runtime(async()=>response(invalid)).scoreboard({date:'20241021',cutoffAt:now})).reason,'INVALID_SCOREBOARD');
 const impossible=structuredClone(board);impossible.events[0].competitions[0].date='2026-10-22T00:00:00Z';
 assert.equal((await runtime(async()=>response(impossible)).scoreboard({date:'20261022'})).reason,'INVALID_SCOREBOARD');
 assert.equal((await runtime(async()=>new Response('',{status:503})).scoreboard({date:'20241021',cutoffAt:now})).reason,'PROVIDER_HTTP_503');
 const timeout=runtime((_,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort')))),{timeoutMs:5});
 assert.equal((await timeout.scoreboard({date:'20241021',cutoffAt:now})).reason,'PROVIDER_TIMEOUT');
});
test('empty or one-sided final box scores and missing stats cannot masquerade as complete',async()=>{
 const oneSide=structuredClone(final);oneSide.boxscore.players=oneSide.boxscore.players.slice(0,1);
 assert.equal((await runtime(async()=>response(oneSide)).completedGames({eventIds:['401705278'],cutoffAt:now}))[0].reason,'INCOMPLETE_BOXSCORE');
 const empty=structuredClone(final);empty.boxscore.players[0].statistics=[];
 assert.equal((await runtime(async()=>response(empty)).completedGames({eventIds:['401705278'],cutoffAt:now}))[0].reason,'INCOMPLETE_BOXSCORE');
 const missing=structuredClone(final),group=missing.boxscore.players[0].statistics[0];
 group.athletes[0].stats[group.keys.indexOf('points')]='';
 const r=await runtime(async()=>response(missing)).completedGames({eventIds:['401705278'],cutoffAt:now});
 assert.equal(r[0].ok,true);assert.equal(r[0].result.players[`espn:nba:${group.athletes[0].athlete.id}`].stats.points,null);
});
test('synthetic or invalid athlete rows cannot make a completed box score available',async()=>{
 const both=structuredClone(final);
 for(const team of both.boxscore.players)for(const group of team.statistics)group.athletes=[{athlete:{id:'-1'},didNotPlay:false,stats:[]}];
 const bothResult=await runtime(async()=>response(both)).completedGames({eventIds:['401705278'],cutoffAt:now});
 assert.equal(bothResult[0].reason,'INCOMPLETE_BOXSCORE');
 const one=structuredClone(final);
 for(const group of one.boxscore.players[0].statistics)group.athletes=[{athlete:{id:'unknown'},didNotPlay:false,stats:[]}];
 const oneResult=await runtime(async()=>response(one)).completedGames({eventIds:['401705278'],cutoffAt:now});
 assert.equal(oneResult[0].reason,'INCOMPLETE_BOXSCORE');
});
test('bounded concurrency, input limit and same-key cache',async()=>{
 let active=0,peak=0,calls=0;const loader=runtime(async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,3));active--;return response(final)},{maxConcurrent:2});
 const ids=['401705278','401705279','401705280','401705281'];
 const r=await loader.completedGames({eventIds:ids,cutoffAt:now});assert.equal(r.length,4);assert.equal(peak,2);
 await loader.completedGames({eventIds:['401705278'],cutoffAt:now});assert.equal(calls,4);
 assert.equal((await loader.completedGames({eventIds:Array.from({length:21},(_,i)=>String(i+1)),cutoffAt:now}))[0].reason,'INVALID_REQUEST');
});
