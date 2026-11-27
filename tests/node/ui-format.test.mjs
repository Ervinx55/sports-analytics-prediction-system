import test from 'node:test';
import assert from 'node:assert/strict';
import { displayPlayerName, formatCentralTime, formatProbability, formatNumber, shortReason } from '../../sharp-service/ui-format.js';

test('player display preserves supplied punctuation, acronyms and spelling', () => {
  for (const name of ["Day'Ron Sharpe", 'OG Anunoby', 'P.J. Washington', 'Karl-Anthony Towns', 'LeBron James', 'Nikola Jokić']) {
    assert.deepEqual(displayPlayerName(name, 'OTHER_PLAYER_1_NBA'), { name, source: 'supplied' });
  }
  assert.deepEqual(displayPlayerName('  Derrick   White  ', 'DERRICK_WHITE_1_NBA'), { name: 'Derrick White', source: 'supplied' });
});

test('recognized provider IDs provide display-only fallbacks for missing names', () => {
  for (const name of [null, undefined, '', 'Player name unavailable', 'UNKNOWN', 'N/A', 'DERRICK_WHITE_1_NBA']) {
    assert.deepEqual(displayPlayerName(name, 'DERRICK_WHITE_1_NBA'), { name: 'Derrick White', source: 'provider-id' });
  }
  assert.deepEqual(displayPlayerName(null, 'PAYTON_PRITCHARD_1_NBA'), { name: 'Payton Pritchard', source: 'provider-id' });
  assert.deepEqual(displayPlayerName('GIANNIS_ANTETOKOUNMPO_1_NBA'), { name: 'Giannis Antetokounmpo', source: 'provider-id' });
  for (const sport of ['NBA', 'NFL', 'NHL', 'MLB', 'CFB']) {
    assert.equal(displayPlayerName(null, `TEST_PLAYER_2_${sport}`).source, 'provider-id');
  }
});

test('fallback does not invent missing punctuation and respects initials and suffixes', () => {
  assert.equal(displayPlayerName(null, 'OG_ANUNOBY_1_NBA').name, 'OG Anunoby');
  assert.equal(displayPlayerName(null, 'P_J_WASHINGTON_1_NBA').name, 'P J Washington');
  assert.equal(displayPlayerName(null, 'GARY_PAYTON_II_1_NBA').name, 'Gary Payton II');
  assert.equal(displayPlayerName(null, 'JAREN_JACKSON_JR_1_NBA').name, 'Jaren Jackson Jr.');
  assert.equal(displayPlayerName(null, 'KARLANTHONY_TOWNS_1_NBA').name, 'Karlanthony Towns');
});

test('opaque, unsupported and team identifiers cannot become player names', () => {
  for (const id of ['b2588e8e06ff6f1dbc81397491499118d72b19d17202d265f566d0f87c25631b',
    '12345', 'unknown:12345', 'BOSTON_CELTICS_NBA', 'TEST_PLAYER_1_UNKNOWN',
    'FAKE123_NAME_1_NBA', 'TEST__PLAYER_1_NBA', 'b2588e8e06ff6f1dbc81397491499118d7_1_NBA',
    '<script>_PLAYER_1_NBA']) {
    assert.deepEqual(displayPlayerName(id, id), { name: 'Name unavailable', source: 'unavailable' }, id);
  }
  assert.equal(displayPlayerName('<img src=x onerror=alert(1)>', null).source, 'unavailable');
});

test('probabilities preserve zero and one and reject missing, coerced or invalid inputs', () => {
  assert.equal(formatProbability(0), '0.0%');
  assert.equal(formatProbability(1), '100.0%');
  assert.equal(formatProbability(0.6268656716), '62.7%');
  for (const value of [null, undefined, '', '0', '0.55', false, [], {}, NaN, Infinity, -Infinity, -0.01, 1.01]) {
    assert.equal(formatProbability(value), 'N/A');
  }
});

test('numeric formatting keeps zeros, configured precision and suffixes without coercion', () => {
  assert.equal(formatNumber(0), '0.0');
  assert.equal(formatNumber(-0), '0.0');
  assert.equal(formatNumber(1234.56, { digits: 2 }), '1,234.56');
  assert.equal(formatNumber(4.75, { digits: 0, suffix: ' pp' }), '5 pp');
  assert.equal(formatNumber(-1.25, { digits: 2, suffix: '%' }), '-1.25%');
  assert.equal(formatNumber(1.25, { digits: Infinity }), '1.3');
  for (const value of [null, undefined, '', '0', false, [], {}, NaN, Infinity]) assert.equal(formatNumber(value), 'N/A');
});

test('Central times include the correct date and daylight saving abbreviation', () => {
  assert.equal(formatCentralTime('2026-11-28T00:00:00Z'), 'Nov 27, 2026, 6:00 PM CST');
  assert.equal(formatCentralTime('2026-07-04T00:00:30Z', { seconds: true }), 'Jul 3, 2026, 7:00:30 PM CDT');
  assert.equal(formatCentralTime('2026-11-27T18:00:00-06:00'), formatCentralTime('2026-11-28T00:00:00Z'));
  assert.equal(formatCentralTime(new Date('2026-11-28T00:00:00Z')), formatCentralTime(Date.parse('2026-11-28T00:00:00Z')));
});

test('missing, invalid and timezone-free dates remain unavailable', () => {
  for (const value of [null, undefined, '', '0', 'not a date', '2026-11-27', '2026-11-27T16:32:30', false, {}, [], Infinity, NaN, new Date(NaN)]) {
    assert.equal(formatCentralTime(value), 'N/A', String(value));
  }
});

test('short reasons deduplicate labels and retain at most three without mutating input', () => {
  const reasons = Object.freeze(['MODEL_NOT_APPROVED', 'EXPLICIT_AVAILABILITY_REQUIRED', 'AVAILABILITY_UNVERIFIED', 'ROTATION_UNCONFIRMED', 'PROJECTED_MINUTES_UNAVAILABLE']);
  assert.equal(shortReason(reasons), 'Model not approved · Availability unverified · Rotation unconfirmed');
  assert.equal(reasons.length, 5);
  assert.equal(shortReason(['NEW_PROVIDER_STATE']), 'New provider state');
  assert.equal(shortReason('QUOTE_STALE'), 'Market price stale');
  assert.equal(shortReason(['constructor', 'toString']), 'constructor · toString');
});

test('short reasons use a bounded fallback without adding a decision', () => {
  assert.equal(shortReason([], 'Reviewed and cleared'), 'Reviewed and cleared');
  assert.equal(shortReason(null), 'Details unavailable');
  assert.equal(shortReason([null, {}, '  '], ''), 'Details unavailable');
  assert.ok(shortReason([], 'x'.repeat(300)).length <= 160);
  assert.ok(shortReason(['x'.repeat(300)]).length <= 64);
});
