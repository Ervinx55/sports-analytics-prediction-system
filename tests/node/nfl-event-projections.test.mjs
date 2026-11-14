import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventOpportunityProjector, loadEventWeatherContexts } from '../../sharp-service/lib/nfl-event-projections.js';

test('repeated player markets reuse a projection only within the same event context', () => {
  let calls = 0;
  const project = (options) => ({ call: ++calls, ...options });
  const common = { event: { eventID: 'one', startsAt: '2026-09-27T17:00:00Z' }, weatherContext: { windMph: 4 } };
  const calculate = createEventOpportunityProjector(common, project);
  const player = { playerName: 'Receiver', preferredTeam: 'GB', preferredPosition: 'WR', opponentSnapshot: { defYppAllowed: 5.6 } };
  const first = calculate(player);
  assert.equal(calculate({ ...player, opponentSnapshot: { defYppAllowed: 5.6 } }), first);
  assert.equal(calls, 1);
  for (const change of [{ playerName: 'Other' }, { preferredTeam: 'MIN' }, { preferredPosition: 'TE' }, { opponentSnapshot: { defYppAllowed: 6 } }]) {
    assert.notEqual(calculate({ ...player, ...change }), first);
  }
  const nextEvent = createEventOpportunityProjector({ ...common, event: { eventID: 'two' } }, project);
  assert.notEqual(nextEvent(player), first);
  assert.equal(calls, 6);
  assert.equal(first.event, common.event);
  assert.equal(first.weatherContext, common.weatherContext);
});
test('event weather loads in bounded parallel batches and stays bound to its event',async()=>{
 const events=Array.from({length:9},(_,i)=>({eventID:String(i),matchup:{home:{name:'Green Bay Packers'}}}));
 let active=0,maxActive=0;
 const contexts=await loadEventWeatherContexts(events,{schedule:[],season:2026},async({event,homeTeam})=>{
  active++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>setImmediate(resolve));active--;
  assert.equal(homeTeam,'GB');
  return {available:true,windMph:Number(event.eventID)};
 });
 assert.equal(maxActive,4);
 assert.deepEqual(events.map(e=>contexts.get(e)),events.map((e,i)=>({available:true,windMph:i})));
});
