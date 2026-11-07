import test from 'node:test';
import assert from 'node:assert/strict';
import { mapNbaArchiveQuotes,mapNflArchiveQuotes,capturePropResearchRows } from '../lib/prop-market-archive.js';

const now=Date.parse('2026-11-07T17:00:00Z');
const nba=({updatedAt='2026-11-07T16:59:00Z',startsAt='2026-11-07T19:00:00Z'}={})=>[
 {league:'NBA',eventID:'g1',startsAt,provider:'SportsGameOdds',
  players:[{prop:{statID:'rebounds',playerID:'verified-player-1',playerName:'Player One',
   over:{books:{draftkings:{odds:-110,line:9.5,updatedAt,quoteState:'OBSERVED'}}},
   under:{books:{draftkings:{odds:-110,line:9.5,updatedAt,quoteState:'OBSERVED'}}}}}]}
];
test('captures only genuinely timestamped pregame NBA books, both sides',()=>{
 const rows=mapNbaArchiveQuotes(nba(),{now});
 assert.equal(rows.length,2);
 assert.equal(rows[0].pregame_model_probability,null);
 assert.equal(rows[0].provenance,'LIVE_PROVIDER_OBSERVATION');
 assert.equal(rows[0].source_quote_at,'2026-11-07T16:59:00.000Z');
});
test('rejects stale, post-start, and future NBA quotes',()=>{
 assert.equal(mapNbaArchiveQuotes(nba({updatedAt:'2026-11-07T16:20:00Z'}),{now}).length,0);
 assert.equal(mapNbaArchiveQuotes(nba({updatedAt:'2026-11-07T17:01:00Z'}),{now}).length,0);
 assert.equal(mapNbaArchiveQuotes(nba({startsAt:'2026-11-07T16:55:00Z'}),{now}).length,0);
});
test('NFL capture requires real player identity and real current quote',()=>{
 const row={startsAt:'2026-11-08T18:00:00Z',updatedAt:'2026-11-07T16:55:00Z',
    eventID:'nfl1',playerID:'123',playerName:'Player Two',statID:'receiving_receptions',
    side:'over',line:3.5,odds:-110,book:'circa'};
 assert.equal(mapNflArchiveQuotes([row],{now}).length,1);
 assert.equal(mapNflArchiveQuotes([{...row,playerID:null}],{now}).length,0);
});
test('private archiver never sends secrets to caller and is disabled by default',async()=>{
 const result=await capturePropResearchRows([{a:1}],{
    env:{},fetcher:()=>{throw Error('must not fetch');}
 });
 assert.equal(result.status,'DISABLED');
 assert.equal(result.count,0);
});
test('archiver uses private schema and deduplicated conflict target',async()=>{
 let called=false;
 const row={sport:'NBA',event_id:'g1'};
 const result=await capturePropResearchRows([row],{
  env:{EDGE_LAB_PROP_ARCHIVE_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY:'private-test-only'},
  fetcher:async(url,opt)=>{
    called=true;
    assert.match(url,/\/rest\/v1\/rpc\/edge_lab_prop_ingest_v1$/);
    assert.equal(opt.headers.Accept,'application/json');
    assert.equal(JSON.parse(opt.body).p_rows[0].sport,'NBA');
    return {ok:true,json:async()=>({inserted:1})};
  }
 });
 assert.equal(called,true);
 assert.equal(result.status,'CAPTURED_OR_DUPLICATE');
});
