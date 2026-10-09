import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptLegacyObservation, qualifiedDecision, importHistoryPage, capturePersistedRows, publicationState, serviceAuthorized } from '../../supabase/functions/_shared/performance-mlb-adapter.mjs';
const row = { id: 12, game_pk: 123, event_id: 'odds-1', captured_at: '2026-10-05T12:00:00Z', starts_at: '2026-10-05T12:15:00Z', model_version: 'v1', market_type: 'moneyline', market_side: 'home', best_book: 'book', best_odds: -110, model_probability: .6, market_fair_probability: .5, raw: { quoteAt: '2026-10-05T11:59:00Z', probabilityBasis: 'CONDITIONAL_NO_PUSH', settlementRule: { version: 'mlb-full-game-v1', extraInnings: true, shortenedFinal: 'UNRESOLVED' } } };
const adapt = (changes = {}, kind = 'market_grade_observations') => adaptLegacyObservation({...row,...changes}, kind);
test('source identity is deterministic and equivalent observations preserve original links', () => {
  assert.deepEqual(adapt(),adapt());
  assert.equal(adapt().sourceKey,'market_grade_observations:12');
  assert.equal(adapt().eventKey,'mlb:123');
  assert.equal(adapt().sourceIds.oddsEvent,'odds-1');
  assert.notEqual(adapt({},'model_audit_observations').sourceKey,adapt().sourceKey);
});
test('raw PLAY and READY_FOR_SHARP_CHECK never prove final qualification', () => {
  for(const status of ['PLAY','READY_FOR_SHARP_CHECK','FINAL_PLAY']) assert.equal(qualifiedDecision({...adapt(),id:'uuid'}, {status},row.captured_at),null);
  const d = qualifiedDecision({...adapt(),id:'uuid'}, {status:'PLAY',finalQualification:true},row.captured_at);
  assert.equal(d.qualified,true);
  assert.equal(d.sourceKey,'market_grade_observations:12:final');
});
test('unknown times, stats and rules stay unknown, ambiguous official IDs exclude', () => {
  const p = adapt({game_pk:null,model_probability:null,raw:{}});
  assert.equal(p.eventKey,null); assert.equal(p.modelProbability,null); assert.equal(p.quoteAt,null); assert.equal(p.settlementRule,null);
  assert.ok(p.eligibilityReasons.includes('MISSING_EVENT_KEY'));
});
test('props require official player identity and player_ market prefix', () => {
  const p = adapt({mlb_player_id:44,player_id:'provider44',stat_id:'batting_hits',side:'over',line:0},'player_prop_observations');
  assert.equal(p.marketType,'player_batting_hits'); assert.equal(p.playerKey,'mlb:44'); assert.equal(p.line,0);
  assert.equal(p.provenance.statId,'batting_hits');
});
test('post-event reconstructed PLAY stays legacy diagnostic and cannot issue', () => {
  const p = adapt({status:'PLAY',captured_at:'2026-10-05T13:00:00Z'});
  assert.equal(p.provenance.legacyReconstructed,true); assert.equal(p.provenance.originalDecision,'PLAY');
  assert.equal(qualifiedDecision({...p,id:'uuid'}, {status:'PLAY',finalQualification:true},p.capturedAt),null);
});
test('issuance rejects shadow, missing price, stale quote and post-start', () => {
  for(const changes of [{modelMode:'SHADOW'},{odds:null},{quoteAt:null},{quoteAt:'2026-10-05T11:50:00Z'}]) assert.equal(qualifiedDecision({...adapt(),id:'uuid',...changes},{status:'PLAY',finalQualification:true},row.captured_at),null);
  assert.equal(qualifiedDecision({...adapt(),id:'uuid'},{status:'PLAY',finalQualification:true},row.starts_at),null);
});
test('paginated import dry run counts exclusions and only advances after complete page', async () => {
  const writes=[]; const rows=Array.from({length:500},(_,i)=>({...row,id:i+1}));
  const result=await importHistoryPage({table:'market_grade_observations',cursor:0,fetchPage:async()=>rows,write:async p=>writes.push(p),dryRun:true});
  assert.equal(result.count,500); assert.equal(result.nextCursor,500); assert.equal(result.complete,false); assert.equal(writes.length,0);
  const last=await importHistoryPage({table:'market_grade_observations',cursor:500,fetchPage:async()=>[{...row,id:501}],write:async p=>writes.push(p)});
  assert.equal(last.complete,true); assert.equal(last.nextCursor,501); assert.equal(writes.length,1);
  await assert.rejects(importHistoryPage({table:'market_grade_observations',cursor:0,fetchPage:async()=>rows,write:async()=>{throw Error('offline')}}),/offline/);
  await assert.rejects(importHistoryPage({table:'market_grade_observations',cursor:0,fetchPage:async()=>[{...row,id:2},{...row,id:1}],write:async()=>{}}),/ordered/);
});
test('capture failure is explicit while persistence identities remain retryable', async () => {
  const calls=[]; const client={rpc:async(name,{payload})=>{calls.push(payload.sourceKey);return {data:null,error:{message:'offline'}}}};
  const result=await capturePersistedRows(client,[row],'market_grade_observations');
  assert.equal(result.tracked,0); assert.equal(result.faults[0].sourceKey,'market_grade_observations:12');
  await capturePersistedRows(client,[row],'market_grade_observations'); assert.equal(calls[0],calls[1]);
});
test('public enabled PLAY requires matching persisted publication; faults use deadline policy', () => {
  const card={...row,status:'PLAY',reason:'qualified'};
  assert.equal(publicationState(card,null,{enabled:false,now:'2026-10-05T11:00:00Z'}).status,'PLAY');
  assert.equal(publicationState(card,null,{enabled:true,now:'2026-10-05T11:00:00Z'}).status,'PENDING');
  assert.equal(publicationState(card,null,{enabled:true,now:row.captured_at}).status,'PASS');
  const publication={id:'decision',prediction:{source_key:'market_grade_observations:12',odds:-110,book:'book'},qualified:true,status:'PLAY',legacy_reconstructed:false};
  assert.equal(publicationState(card,publication,{enabled:true,kind:'market_grade_observations',now:row.captured_at}).tracking.tracked,true);
  assert.equal(publicationState({...card,best_odds:120},publication,{enabled:true,kind:'market_grade_observations',now:row.captured_at}).status,'PASS');
});
test('publisher authentication never accepts missing secrets or anonymous keys',()=>{
 assert.equal(serviceAuthorized('Bearer secret','secret'),true);
 for(const [header,secret] of [[null,null],['Bearer anon','secret'],['secret','secret'],['Bearer ', '']]) assert.equal(serviceAuthorized(header,secret),false);
});

import { evaluateTeamCard, evaluatePropCard } from '../../supabase/functions/_shared/performance-mlb-qualification.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
test('selected quote follows the exact chosen book and line without capture fallback',()=>{
 const source=readFileSync('sharp-service/api/propmodel.js','utf8');
 const fn=source.slice(source.indexOf('function bestPriceAtLine('),source.indexOf('function exactLineMarket('));
 const ctx={num:v=>v==null?null:Number(v)};vm.createContext(ctx);vm.runInContext(fn,ctx);
 const best=ctx.bestPriceAtLine({books:{a:{line:1,odds:100,updatedAt:'old'},b:{line:1,odds:120,updatedAt:'selected'},c:{line:2,odds:200,updatedAt:'wrong'}}},1);
 assert.equal(best.quoteAt,'selected');assert.equal(best.bestBook,'b');
 assert.equal(ctx.bestPriceAtLine({books:{a:{line:1,odds:100}}},1).quoteAt,null);
});
test('shared final evaluator keeps qualification and original freshness thresholds',()=>{
 const now=Date.parse(row.captured_at);
 const g={...row,non_sharp_status:'READY_FOR_SHARP_CHECK',reason:'candidate'};
 const sharp={checked_at:row.captured_at,final_status:'FINAL_PLAY',raw:{}};
 // Quote age helper needs authoritative sharp source timestamp, never checked_at.
 const c={sharp:{...sharp,raw:{sharpQuoteAt:row.captured_at}},verification:{evaluated_at:row.captured_at},weather:{evaluated_at:row.captured_at}};
 const prop=evaluatePropCard({...g,status:'PLAY'}, {verificationGate:c.verification,weatherParkImpact:c.weather},now);
 assert.equal(prop.status,'PLAY');assert.equal(prop.freshness.action,'KEEP');
 const stale=evaluatePropCard({...g,status:'PLAY',captured_at:'2026-10-05T11:50:00Z'},{verificationGate:c.verification,weatherParkImpact:c.weather},now);
 assert.equal(stale.status,'PASS');assert.equal(stale.freshness.action,'PASS_STALE');
 const pending=evaluateTeamCard({...g,non_sharp_status:'PENDING'},c,now);
 assert.equal(pending.status,'PASS');
 const raw=evaluateTeamCard(g,{...c,sharp:{...sharp,final_status:'PENDING'}},now);
 assert.equal(raw.status,'PASS');
});

test('team quote provenance checks exact selected line and preserves spread push probability',()=>{
 const p=adapt({market_type:'spread',line:-1.5,raw:{...row.raw,quoteLine:-2.5,pushProbability:.05,probabilityBasis:'UNCONDITIONAL'}});
 assert.equal(p.pushProbability,.05);assert.ok(p.eligibilityReasons.includes('QUOTE_LINE_MISMATCH'));
 for(const file of ['decision','runenv']) {
 const source=readFileSync('sharp-service/api/'+file+'.js','utf8');
 const start=source.indexOf('function bestOdds('),end=source.indexOf('\nfunction ',start+10);
 const ctx={num:v=>v==null?null:Number(v)};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 const best=ctx.bestOdds({a:{odds:100,updatedAt:'old'},b:{odds:120,line:2,updatedAt:'selected'}});
 assert.equal(best.quoteAt,'selected');assert.equal(best.book,'b');
 }
});

test('72 frozen production outputs retain exact status, reason and freshness parity',()=>{
 const {fixtures}=JSON.parse(readFileSync('tests/fixtures/performance-mlb-qualification.json','utf8'));
 assert.equal(fixtures.length,72);
 for(const fixture of fixtures){
 const result=(fixture.kind==='team'?evaluateTeamCard:evaluatePropCard)(fixture.row,fixture.context,fixture.now);
 assert.deepEqual({status:result.status,reason:result.reason,freshness:result.freshness},fixture.expected,JSON.stringify({kind:fixture.kind,row:fixture.row}));
 }
});

test('publication enrichment never changes the immutable captured prediction payload',()=>{
 const original={...row,non_sharp_status:'READY_FOR_SHARP_CHECK'};
 const captured=adaptLegacyObservation(original,'market_grade_observations');
 const enriched=adaptLegacyObservation({...original,status:'PLAY',freshness:{score:100},sharpGate:{final_status:'FINAL_PLAY'}},'market_grade_observations');
 assert.deepEqual(enriched,captured);
});

test('missing persistence IDs are an explicit capture coverage fault',async()=>{
 const result=await capturePersistedRows({rpc:async()=>({data:'id',error:null})},[],'player_prop_observations',3);
 assert.equal(result.tracked,0);assert.match(result.faults[0].error,/IDs.*0.*3/);
});
