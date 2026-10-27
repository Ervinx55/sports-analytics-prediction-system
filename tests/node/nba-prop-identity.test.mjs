import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyNbaPropRosters} from '../../sharp-service/lib/nba-prop-identity.js';
const event={matchup:{home:{name:'Boston Celtics'},away:{name:'Brooklyn Nets'}},players:[{prop:{playerName:'Verified Player'},candidates:[]},{prop:{playerName:'Wrong Player'},candidates:[]}]};
const directory={sports:[{leagues:[{teams:[{team:{id:'2',displayName:'Boston Celtics'}},{team:{id:'17',displayName:'Brooklyn Nets'}}]}]}]};
const fetchImpl=async url=>({ok:true,json:async()=>url.includes('?')?directory:{team:{id:url.includes('/2/')?'2':'17',displayName:url.includes('/2/')?'Boston Celtics':'Brooklyn Nets'},athletes:[{id:url.includes('/2/')?'123':'456',displayName:url.includes('/2/')?'Verified Player':'Other Player'}]}});
test('roster matching retains exact players and quarantines unrelated names without creating predictions',async()=>{
 const result=await verifyNbaPropRosters([event],{fetchImpl});
 assert.equal(result.events[0].players.length,1);
 assert.equal(result.events[0].players[0].prop.espnPlayerID,'123');
 assert.equal(result.events[0].players[0].prop.identityStatus,'ROSTER_MATCHED');
 assert.deepEqual(result.events[0].players[0].candidates,[]);
 assert.equal(result.health.excluded,1);
 assert.equal(event.players.length,2);
});
test('roster outage preserves quote-only rows but never claims verification',async()=>{
 const result=await verifyNbaPropRosters([event],{fetchImpl:async()=>{throw Error('offline')}});
 assert.equal(result.events[0].players.length,2);
 assert.equal(result.health.status,'UNAVAILABLE');
 assert.equal(result.events[0].players[0].prop.identityStatus,'UNVERIFIED');
});
test('ambiguous names across opposing rosters are quarantined',async()=>{
 const result=await verifyNbaPropRosters([event],{fetchImpl:async url=>({ok:true,json:async()=>url.includes('?')?directory:{team:{id:url.includes('/2/')?'2':'17',displayName:url.includes('/2/')?'Boston Celtics':'Brooklyn Nets'},athletes:[{id:url.includes('/2/')?'123':'456',displayName:'Verified Player'}]}})});
 assert.equal(result.health.matched,0);assert.equal(result.health.excluded,2);
});
