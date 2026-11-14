import test from 'node:test';
import assert from 'node:assert/strict';
import {propsResponse as response} from '../../sharp-service/api/nbaprops.js';
const propsResponse=options=>response({optimize:async()=>({effectiveLimit:16,blocked:false}),...options});
const now=Date.parse('2026-11-13T12:00:00Z');
const event=i=>({eventID:`event-${i}`,leagueID:'NBA',type:'match',status:{startsAt:'2026-11-14T01:00:00Z'},teams:{home:{teamID:'A_NBA'},away:{teamID:'B_NBA'}},players:{p:{playerID:'p',name:'Player',teamID:'A_NBA'}},odds:{x:{playerID:'p',sideID:'over',statID:'points',periodID:'game',betTypeID:'ou',oddID:'points-p-game-ou-over',byBookmaker:{draftkings:{overUnder:20.5,odds:-110,lastUpdatedAt:'2026-11-13T11:59:00Z'}}}}});
// Reproduces the omitted ninth game when the provider honors the requested limit.
test('all nine NBA games reach the prop evaluator',async()=>{
 const slate=Array.from({length:9},(_,i)=>event(i));
 const result=await propsResponse({now,key:'test',fetchPage:async({url})=>{
  const q=new URL(url).searchParams,start=Number(q.get('cursor')||0),end=start+Number(q.get('limit'));
  return {payload:{success:true,data:slate.slice(start,end),nextCursor:end<slate.length?String(end):null},fetchedAt:now,cacheStatus:'HIT'};
 }});
 assert.equal(result.status,200);assert.equal(result.body.events.length,9);
 assert.equal(result.body.events.at(-1).eventID,'sgo:event-8');
 assert.equal(result.body.coverage.eventsComplete,true);
 assert.equal(result.body.productionEligible,false);
});
test('pagination preserves original timestamps and deduplicates overlapping events',async()=>{
 const result=await propsResponse({now,key:'test',fetchPage:async({url})=>{
  const second=new URL(url).searchParams.has('cursor');
  return {payload:{success:true,data:second?[event(1),event(2)]:[event(0),event(1)],nextCursor:second?null:'page2'},fetchedAt:now-(second?120000:60000),cacheStatus:'HIT'};
 }});
 assert.equal(result.body.events.length,3);assert.equal(result.body.generatedAt,'2026-11-13T11:58:00.000Z');
 assert.equal(result.body.coverage.pagesFetched,2);assert.equal(result.body.coverage.eventsComplete,true);
});
test('a later provider failure retains first-page quotes with incomplete coverage',async()=>{
 const result=await propsResponse({now,key:'test',fetchPage:async({url})=>{
  if(new URL(url).searchParams.has('cursor'))throw Error('private upstream failure');
  return {payload:{success:true,data:[event(0)],nextCursor:'page2'},fetchedAt:now,cacheStatus:'HIT'};
 }});
 assert.equal(result.status,200);assert.equal(result.body.events.length,1);
 assert.equal(result.body.coverage.eventsComplete,false);
 assert.ok(result.body.coverage.reasons.includes('PAGE_UNAVAILABLE'));
 assert.ok(!JSON.stringify(result).includes('private upstream'));
});
test('unbounded cursors cannot exhaust the provider budget',async()=>{
 let calls=0;
 const result=await propsResponse({now,key:'test',fetchPage:async()=>{
  calls++;return {payload:{success:true,data:[event(calls)],nextCursor:String(calls)},fetchedAt:now,cacheStatus:'HIT'};
 }});
 assert.equal(calls,2);assert.equal(result.body.coverage.eventsComplete,false);
 assert.ok(result.body.coverage.reasons.includes('PAGE_LIMIT_REACHED'));
});
