import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCohort,summarizePerformance,parsePerformanceFilters,publicRow} from '../../supabase/functions/_shared/performance-metrics.mjs';
const p=(id,change={})=>({id,sourceKey:id,sport:'MLB',eventKey:'g',playerKey:'p',marketType:'player_hits',side:'OVER',line:.5,marketKey:'m',modelVersion:'v',modelMode:'LIVE',modelAvailable:true,valid:true,capturedAt:'2026-10-01T12:00:00Z',startsAt:'2026-10-01T14:00:00Z',eligibilityStartsAt:'2026-10-01T14:00:00Z',quoteAt:'2026-10-01T12:00:00Z',odds:100,modelProbability:.6,marketProbability:.5,probabilityBasis:'CONDITIONAL_NO_PUSH',eligibilityReasons:[],...change});
const d=(id,predictionId,change={})=>({id,predictionId,issuedAt:'2026-10-01T12:01:00Z',status:'PLAY',qualified:true,firstIssued:true,legacyReconstructed:false,...change});
const s=(predictionId,outcome,revision=1)=>({predictionId,outcome,revision});
const filters={from:'2026-10-01T00:00:00Z',to:'2026-10-03T00:00:00Z'};
test('ALL takes last valid snapshot; PLAY retains first issuance; shadow and legacy stay separate',()=>{
 const predictions=[p('a'),p('b',{capturedAt:'2026-10-01T13:00:00Z',odds:200}),p('late',{capturedAt:'2026-10-01T15:00:00Z'}),p('shadow',{marketKey:'sh',modelMode:'SHADOW'}),p('legacy',{marketKey:'le'})];
 const decisions=[d('da','a'),d('db','b',{firstIssued:false,issuedAt:'2026-10-01T13:01:00Z'}),d('ds','shadow'),d('dl','legacy',{legacyReconstructed:true})];
 assert.deepEqual(selectCohort(predictions,decisions,[],{...filters,cohort:'ALL'}).map(r=>r.id).sort(),['b','legacy']);
 assert.deepEqual(selectCohort(predictions,decisions,[],{...filters,cohort:'PLAY'}).map(r=>[r.id,r.odds]),[['a',100]]);
 assert.equal(selectCohort(predictions,decisions,[],{...filters,cohort:'SHADOW'})[0].id,'shadow');
 assert.equal(selectCohort(predictions,decisions,[],{...filters,cohort:'LEGACY'})[0].id,'legacy');
});
test('equivalent half hits/bases portfolio chooses earliest issuance pre-outcome, exact ALL survives',()=>{
 const predictions=[p('a'),p('b',{marketKey:'b',marketType:'player_total_bases'}),p('c',{marketKey:'c',line:1.5})];
 const decisions=[d('a','a',{issuedAt:'2026-10-01T12:02:00Z'}),d('b','b'),d('c','c')];
 const rows=selectCohort(predictions,decisions,[s('a','WIN'),s('b','LOSS'),s('b','WIN',2)],{...filters,cohort:'PLAY'});
 assert.deepEqual(rows.map(r=>r.id),['b','c']);assert.equal(rows[0].outcome,'WIN');
 assert.equal(selectCohort(predictions,decisions,[],{...filters,cohort:'ALL'}).length,3);
});
test('ROI symmetric missing price exclusion, push zero, void no stake, null empty denominators',()=>{
 const rows=[p('a',{outcome:'WIN',odds:null}),p('b',{outcome:'LOSS',odds:null}),p('c',{outcome:'PUSH'}),p('d',{outcome:'VOID'}),p('e',{outcome:'WIN',odds:200})];
 const {summary}=summarizePerformance(rows);assert.equal(summary.pricedCount,2);assert.equal(summary.hypotheticalUnitProfit,2);assert.equal(summary.hypotheticalRoi,1);assert.equal(summary.distinctGames,1);
 assert.equal(summarizePerformance([]).summary.winRate,null);assert.equal(summarizePerformance([]).summary.hypotheticalUnitProfit,null);
});
test('paired conditional push conversion uses identical complete binary rows and game-blocked deterministic intervals',()=>{
 const rows=[p('a',{outcome:'WIN',modelProbability:.48,pushProbability:.2,probabilityBasis:'UNCONDITIONAL'}),p('b',{outcome:'LOSS',eventKey:'g2',modelProbability:.6}),p('c',{outcome:'WIN',marketProbability:null}),p('d',{outcome:'PUSH'})];
 const result=summarizePerformance(rows);assert.equal(result.summary.pairedCount,2);assert.ok(Math.abs(result.summary.modelBrier-.26)<1e-12);assert.equal(result.reliabilityBins.length,10);assert.equal(result.uncertainty.resamples,2000);assert.deepEqual(result.uncertainty,summarizePerformance(rows).uncertainty);
 assert.equal(summarizePerformance(rows.filter(r=>r.eventKey==='g')).uncertainty.status,'INSUFFICIENT_GAMES');
 assert.equal(result.metadata.logLossClip,1e-6);
});
test('filters reject malformed input and defaults are thirty days and page one hundred',()=>{
 const f=parsePerformanceFilters({},new Date('2026-10-06T00:00:00Z'));assert.equal(f.from,'2026-09-06T00:00:00.000Z');assert.equal(f.limit,100);
 for(const input of [{sport:'fake'},{from:'yesterday'},{from:'2026-02-30'},{cursor:'-1'},{cohort:'fake'},{kind:'weird'},{limit:'101'}])assert.throws(()=>parsePerformanceFilters(input));
});
test('provider MLB batting stat names dedupe half hits and bases with canonical lexical tie',()=>{
 const predictions=[p('z',{marketKey:'z',marketType:'player_batting_hits'}),p('a',{marketKey:'a',marketType:'player_batting_totalBases'})];
 const rows=selectCohort(predictions,[d('z','z'),d('a','a')],[s('z','WIN'),s('a','LOSS')],{...filters,cohort:'PLAY'});
 assert.deepEqual(rows.map(r=>r.id),['a']);
});
test('PASS uses saved decision and mirrored rows count one game; invalid diagnostic never earns ROI',()=>{
 const predictions=Array.from({length:10},(_,i)=>p(String(i),{marketKey:String(i)}));
 assert.equal(selectCohort(predictions,[d('pass','0',{status:'PASS',qualified:false,firstIssued:false})],[],{...filters,cohort:'PASS'}).length,1);
 assert.equal(summarizePerformance(predictions.map(r=>({...r,outcome:'WIN'}))).summary.distinctGames,1);
 const diagnostic=summarizePerformance([p('bad',{valid:false,outcome:'WIN'})]);assert.equal(diagnostic.summary.hypotheticalRoi,null);assert.equal(diagnostic.summary.pairedCount,0);
});
test('equivalent policy portfolios cross books without outcomes or quote improvement selecting entry',()=>{
 const predictions=[p('a',{marketKey:'a',settlementRule:{version:'v',book:'one',period:'FULL_GAME'}}),p('b',{marketKey:'b',marketType:'player_total_bases',odds:300,settlementRule:{period:'FULL_GAME',book:'two',version:'v'}})];
 assert.deepEqual(selectCohort(predictions,[d('a','a'),d('b','b',{issuedAt:'2026-10-01T12:02:00Z'})],[],{...filters,cohort:'PLAY'}).map(r=>r.id),['a']);
});
test('legacy provenance survives ALL, no-decision LEGACY imports and diagnostic history',()=>{
 const predictions=[p('marked',{marketKey:'marked',legacyReconstructed:true}),p('decision',{marketKey:'decision'}),p('bad',{marketKey:'bad',valid:false,legacyReconstructed:true,eligibilityReasons:['MODEL_UNAVAILABLE']})];
 const decisions=[d('legacy','decision',{legacyReconstructed:true}),d('apparently-live','marked')];
 const all=selectCohort(predictions,decisions,[],{...filters,cohort:'ALL'});assert.ok(all.every(r=>r.legacyReconstructed===true));
 assert.deepEqual(selectCohort(predictions,decisions,[],{...filters,cohort:'LEGACY'}).map(r=>r.id).sort(),['bad','decision','marked']);
 assert.equal(selectCohort(predictions,decisions,[],{...filters,cohort:'DIAGNOSTIC'})[0].legacyReconstructed,true);
 assert.equal(selectCohort(predictions,decisions,[],{...filters,cohort:'PLAY'}).length,0);
});
test('scope projection validates values under allowed keys and cannot return nested data',()=>{
 for(const value of [{raw:{secret:'exposed'}},['exposed'],true,'exposed',-1,0,1.5,'1',9007199254740992]){
  const row=publicRow(p('bad',{marketScope:{period:value,unit:value,set:value,game:value}}));assert.deepEqual(row.marketScope,{period:null,unit:null,set:null,game:null});
 }
 assert.deepEqual(publicRow(p('valid',{marketScope:{period:'REGULATION',unit:'GAME',set:2,game:9007199254740991}})).marketScope,{period:'REGULATION',unit:'GAME',set:2,game:9007199254740991});
});
