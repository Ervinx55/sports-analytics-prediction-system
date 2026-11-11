import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDeepDive,deepDiveHtml,selectionKey} from '../../sharp-service/deep-dive.js';
test('research PLAY cannot authorize a play',()=>{assert.match(buildDeepDive({status:'PLAY',modelProbability:.9}).title,/NOT CLEARED/);});
test('cached historical context discloses refresh failure and acquisition timestamp',()=>{
 const d=JSON.stringify(buildDeepDive({context:{features:{},evidenceRead:{status:'cached_after_error',fetchedAt:'2026-11-11T13:00:00Z'}}}));
 assert.match(d,/refresh failed/i);assert.match(d,/2026-11-11T13:00:00Z/);assert.match(d,/historical evidence/i);
});
test('authoritative PASS and reason are retained',()=>{const d=buildDeepDive({reason:'Missing opposite price'},{presentation:{kind:'pass',title:'PASS — do not play',reason:'Not approved'}});assert.match(d.reason,/Missing opposite price/);assert.match(d.title,/PASS/);});
test('context is research only with units, sample and missing usage',()=>{const d=JSON.stringify(buildDeepDive({context:{features:{defenseVsPosition:{value:0,source:'test',sampleCount:12,cutoff:'2026-11-10'},expectedMinutes:{value:28}}}}));assert.match(d,/0.*per opposing player appearance/);assert.match(d,/Research context only/);assert.match(d,/Usage share is unavailable/);assert.match(d,/12/);});
test('unsafe text is escaped and no source links execute',()=>{const h=deepDiveHtml({reason:'<img src=x onerror=alert(1)>',context:{features:{opponentDefensiveRating:{value:100,source:'javascript:alert(1)'}}}});assert.ok(!h.includes('<img'));assert.ok(!h.includes('href='));});
test('invalid probabilities stay unavailable and identity ignores refresh timestamps',()=>{assert.match(JSON.stringify(buildDeepDive({modelProbability:2,marketProbability:null})),/Model: Unavailable/);assert.equal(selectionKey({eventID:'e',playerID:'p',line:2,issuedAt:'a'}),selectionKey({eventID:'e',playerID:'p',line:2,issuedAt:'b'}));assert.notEqual(selectionKey({line:2}),selectionKey({line:3}));});

test('live evidence and expired recorded approval are distinguished',()=>{
 const d=buildDeepDive({contract:'nba-reviewed-live-v1',reason:'All checks passed',modelProbability:.6,evidence:{projectedMinutes:31,availability:{status:'Available',sourceUrl:'https://example.test/report'}}},{presentation:{title:'PASS — do not play',reason:'Live clearance expired'}});
 assert.match(d.reason,/expired.*Recorded explanation: All checks passed/);
 assert.match(JSON.stringify(d),/31 projected minutes/);assert.match(JSON.stringify(d),/Availability evidence: Available/);
});
test('normalized NFL probability and stat identity take precedence',()=>{
 assert.match(JSON.stringify(buildDeepDive({model:.6,modelProbability:.5})),/Model: 60.0%/);
 assert.notEqual(selectionKey({playerID:'p',statID:'points'}),selectionKey({playerID:'p',statID:'rebounds'}));
 assert.notEqual(selectionKey({market_type:'spread',side_key:'home'}),selectionKey({market_type:'spread',side_key:'away'}));
});

test('dashboard percent-point fields and NFL book aliases preserve units',()=>{
 const text=JSON.stringify(buildDeepDive({final_probability:.61,bestBook:'Book',bestOdds:-110,edge_pct_points:3.2,ev_pct:4.5}));
 assert.match(text,/Book: Book/);assert.match(text,/Odds: -110/);assert.match(text,/Model: 61.0%/);assert.match(text,/3.20 percentage points/);assert.match(text,/4.50% per unit/);
});

test('frozen model variants keep independent disclosure state for the same selection',()=>{
 const r={eventID:'e',playerID:'p',market:'points',side:'OVER',line:20.5,book:'b'};
 assert.notEqual(selectionKey({...r,modelHash:'baseline'}),selectionKey({...r,modelHash:'minutes'}));
});
