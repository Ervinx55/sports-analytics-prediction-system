import test from 'node:test';
import assert from 'node:assert/strict';
import {matchNbaEvent} from '../../supabase/functions/_shared/nba-event-match.mjs';
const p={startsAt:'2026-10-30T00:10:00Z',home:'Toronto Raptors',away:'Orlando Magic'};
const event={id:'4011',uid:'s:40~l:46~e:4011',competitions:[{id:'4011',date:p.startsAt,competitors:[{homeAway:'home',id:'28',team:{id:'28',displayName:p.home}},{homeAway:'away',id:'19',team:{id:'19',displayName:p.away}}]}]};
test('NBA requires unique home/away identity and close scheduled start',()=>{
 assert.equal(matchNbaEvent(p,[event]).eventId,'4011');
 assert.equal(matchNbaEvent(p,[event,event]).reason,'AMBIGUOUS_EVENT_MATCH');
 assert.equal(matchNbaEvent({...p,startsAt:'2026-10-31T00:10:00Z'},[event]).reason,'NO_EXACT_EVENT_MATCH');
 assert.equal(matchNbaEvent({...p,home:p.away,away:p.home},[event]).reason,'NO_EXACT_EVENT_MATCH');
});
test('NBA rejects incomplete identities and malformed dates',()=>{
 assert.equal(matchNbaEvent({...p,startsAt:null},[event]).reason,'INVALID_FORECAST_IDENTITY');
 const bad=structuredClone(event);bad.competitions[0].competitors[0].team.id='999';assert.equal(matchNbaEvent(p,[bad]).reason,'NO_EXACT_EVENT_MATCH');
});

test('observed ten-minute tipoff offset preserves the earlier official cutoff',()=>{
 const r=matchNbaEvent({...p,startsAt:'2026-10-30T00:20:00Z'},[event]);assert.equal(r.ok,true);assert.equal(r.eligibilityStartsAt,p.startsAt.replace('Z','.000Z'));
 assert.equal(matchNbaEvent({...p,startsAt:'2026-10-30T00:26:00Z'},[event]).ok,false);
});
