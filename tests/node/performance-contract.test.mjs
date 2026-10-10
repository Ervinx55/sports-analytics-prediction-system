import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrediction, marketKey } from '../../supabase/functions/_shared/performance-contract.mjs';

const now = '2026-10-05T12:00:00Z';
const fixture = { sourceKey: 'provider:observation:1', sport: 'NFL', eventKey: 'nfl:1', marketType: 'spread', side: 'HOME', line: 0, modelVersion: 'v1', modelMode: 'LIVE', modelAvailable: true, capturedAt: now, startsAt: '2026-10-05T12:15:00Z', quoteAt: '2026-10-05T11:59:00Z', modelProbability: .6, marketProbability: .5, probabilityBasis: 'CONDITIONAL_NO_PUSH', sourceIds: { event: '1' }, settlementRule: { version: 'v1' }, provenance: { source: 'test' } };
const norm = (changes = {}) => normalizePrediction({ ...fixture, ...changes }, { now });
test('market identity separates sports, events, players, sides, lines, versions and modes', () => {
  const base = marketKey(norm());
  for (const changes of [{sport:'NBA'}, {eventKey:'nfl:2'}, {playerKey:'p:1'}, {side:'AWAY'}, {line:.5}, {modelVersion:'v2'}, {modelMode:'SHADOW'}]) assert.notEqual(marketKey(norm(changes)), base);
  assert.notEqual(marketKey(norm({eventKey:'a|b', side:'c'})), marketKey(norm({eventKey:'a', side:'b|c'})));
});
test('zero and nullable numbers survive normalization', () => {
  assert.equal(norm().line, 0);
  assert.equal(norm().odds, null);
  assert.equal(norm({modelProbability:null}).modelProbability, null);
  assert.equal(norm({line:''}).line, null);
});
test('missing canonical identity and source IDs exclude predictions', () => {
  assert.ok(norm({eventKey:null}).eligibilityReasons.includes('MISSING_EVENT_KEY'));
  assert.ok(norm({sourceIds:{}}).eligibilityReasons.includes('MISSING_SOURCE_EVENT_ID'));
  assert.ok(norm({marketType:'player_points', playerKey:null}).eligibilityReasons.includes('MISSING_PLAYER_KEY'));
});
test('invalid probabilities and unavailable models are excluded', () => {
  for (const value of [null, '', true, -1, 1.1, NaN]) assert.ok(norm({modelProbability:value}).eligibilityReasons.includes('INVALID_MODEL_PROBABILITY'));
  assert.ok(norm({modelAvailable:false}).eligibilityReasons.includes('MODEL_UNAVAILABLE'));
  assert.ok(norm({pushProbability:.7, probabilityBasis:'UNCONDITIONAL'}).eligibilityReasons.includes('INVALID_PROBABILITY_MASS'));
});
test('quote age is known and measured at capture using component freshness windows', () => {
  assert.deepEqual(norm().eligibilityReasons, []);
  assert.ok(norm({quoteAt:null}).eligibilityReasons.includes('UNKNOWN_QUOTE_AGE'));
  assert.ok(norm({quoteAt:'2026-10-05T12:01:00Z'}).eligibilityReasons.includes('FUTURE_QUOTE'));
  for (const [startsAt, quoteAt] of [['12:15','11:57'],['13:00','11:54'],['15:00','11:44'],['23:00','11:29']]) assert.ok(norm({startsAt:`2026-10-05T${startsAt}:00Z`,quoteAt:`2026-10-05T${quoteAt}:00Z`}).eligibilityReasons.includes('STALE_QUOTE'));
});
test('original start and strict pregame capture cannot be bypassed by rescheduling', () => {
  assert.ok(norm({startsAt:now}).eligibilityReasons.includes('POST_START_CAPTURE'));
  assert.ok(norm({eligibilityStartsAt:'2026-10-05T11:00:00Z',startsAt:'2026-10-06T12:00:00Z'}).eligibilityReasons.includes('POST_START_CAPTURE'));
  assert.ok(norm({capturedAt:'2026-10-05T12:01:00Z'}).eligibilityReasons.includes('FUTURE_CAPTURE'));
});
test('provenance and source identity are retained without mutating input', () => {
  const input = structuredClone(fixture);
  const result = normalizePrediction(input,{now});
  assert.deepEqual(result.provenance, fixture.provenance);
  assert.equal(result.sourceKey, fixture.sourceKey);
  assert.deepEqual(input, fixture);
});
test('exact lines are mandatory for spreads totals and props, optional for moneyline', () => {
  assert.ok(norm({line:null}).eligibilityReasons.includes('MISSING_MARKET_LINE'));
  assert.ok(norm({line:'NaN'}).eligibilityReasons.includes('MISSING_MARKET_LINE'));
  assert.deepEqual(norm({marketType:'moneyline',line:null}).eligibilityReasons, []);
});
test('null source metadata becomes diagnostic data rather than crashing', () => {
  assert.ok(norm({sourceIds:null,provenance:null}).eligibilityReasons.includes('MISSING_SOURCE_EVENT_ID'));
});
test('a caller-provided delayed eligibility start cannot override the recorded kickoff', () => {
  assert.ok(norm({startsAt:'2026-10-05T11:00:00Z',eligibilityStartsAt:'2026-10-06T12:00:00Z'}).eligibilityReasons.includes('POST_START_CAPTURE'));
});
