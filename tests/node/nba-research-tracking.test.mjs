import test from 'node:test';
import assert from 'node:assert/strict';
import {researchOutcome,runNbaResearch} from '../../supabase/functions/_shared/nba-research-tracking.mjs';
const p={id:'p',sport:'NBA',modelMode:'SHADOW',capturedAt:'2026-10-29T18:00:00Z',startsAt:'2026-10-30T00:10:00Z',marketType:'moneyline',side:'home',line:null,provenance:{receivedAt:'2026-10-29T18:00:01Z',productionWeight:0,raw:{home:'Toronto Raptors',away:'Orlando Magic'}}};
const event={id:'4011',uid:'s:40~l:46~e:4011',competitions:[{id:'4011',date:'2026-10-30T00:00:00Z',status:{period:4,type:{completed:true,state:'post',name:'STATUS_FINAL'}},competitors:[{homeAway:'home',id:'28',score:'110',team:{id:'28',displayName:'Toronto Raptors'}},{homeAway:'away',id:'19',score:'100',team:{id:'19',displayName:'Orlando Magic'}}]}]};
test('research outcomes use unique final identities and remain explicitly non-wager results',()=>{
 const r=researchOutcome(p,[event],'2026-10-30T04:00:00Z');assert.equal(r.outcome,'WIN');assert.equal(r.reason,'RESEARCH_DIRECTION_ONLY');assert.equal(r.researchOnly,true);assert.equal(r.sourceUpdatedAt,null);
 assert.equal(researchOutcome({...p,side:'away'},[event]).outcome,'LOSS');
 assert.equal(researchOutcome({...p,marketType:'spread',line:-10},[event]).outcome,'PUSH');
 assert.equal(researchOutcome({...p,marketType:'total',side:'under',line:211},[event]).outcome,'WIN');
});
test('live, ambiguous, malformed, post-start receipt and wrong side do not become wins',()=>{
 const live=structuredClone(event);live.competitions[0].status.type.completed=false;
 assert.equal(researchOutcome(p,[live]),null);assert.equal(researchOutcome(p,[event,event]),null);
 assert.equal(researchOutcome({...p,side:'over'},[event]),null);
 assert.equal(researchOutcome({...p,capturedAt:'2026-10-30T00:05:00Z'},[event]),null);
 assert.equal(researchOutcome({...p,provenance:{...p.provenance,receivedAt:'2026-10-30T00:05:00Z'}},[event]),null);
 const bad=structuredClone(event);bad.competitions[0].competitors[0].score='';assert.equal(researchOutcome(p,[bad]),null);
 const tied=structuredClone(event);tied.competitions[0].competitors[0].score='100';assert.equal(researchOutcome(p,[tied]),null);
});

test('runner grades prior snapshots even when current model fails, and never clears plays',async()=>{
 const saved=[];const repo={pending:async()=>[p],cooldown:async()=>false,cool:async()=>{},capture:async()=>{throw Error('unexpected capture');},settle:async s=>{saved.push(s);return true;}};
 const r=await runNbaResearch(repo,{clock:()=> '2026-10-30T04:00:00Z',fetchImpl:async url=>url.includes('nbamodel')?new Response('unavailable',{status:503}):Response.json({events:[event]})});
 assert.equal(r.settled,1);assert.equal(r.ok,false);assert.equal(saved[0].reason,'RESEARCH_DIRECTION_ONLY');assert.equal(r.productionWeight,0);
});
test('scoreboard quota response records cooldown and produces no fabricated outcome',async()=>{
 let blocked=false,calls=0;const repo={pending:async()=>[p],cooldown:async provider=>provider==='espn'&&blocked,cool:async()=>{blocked=true;},settle:async()=>{throw Error('unexpected settlement');}};
 const r=await runNbaResearch(repo,{clock:()=> '2026-10-30T04:00:00Z',fetchImpl:async url=>{if(url.includes('nbamodel'))return new Response('',{status:503});calls++;return new Response('',{status:429,headers:{'retry-after':'600'}});}});
 assert.equal(calls,1);assert.equal(r.settled,0);assert.equal(r.unresolved,1);assert.ok(r.faults.includes('PROVIDER_HTTP_429'));
});
