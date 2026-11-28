import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNbaJointScenarios, NBA_JOINT_SCENARIOS_VERSION, NBA_JOINT_SCENARIO_LIMITS
} from '../../sharp-service/lib/nba-joint-scenarios.js';

const target = {
  eventID: 'future-game', playerID: 'player', teamId: 'MIN_NBA',
  opponentTeamId: 'MEM_NBA', startsAt: '2026-11-29T01:00:00Z'
};
const asOf = '2026-11-28T18:00:00Z';
function row(index, overrides = {}) {
  return {
    gameId: 'g' + index, playerId: target.playerID, teamId: target.teamId,
    startsAt: new Date(Date.UTC(2026, 10, index + 1, 1)).toISOString(),
    observedAt: new Date(Date.UTC(2026, 10, index + 1, 4)).toISOString(),
    minutes: 30, points: 10, rebounds: 5, assists: 4, ...overrides
  };
}
const request = (overrides = {}) => ({
  rows: [row(0), row(1), row(2)], target, asOf, market: 'points',
  thresholds: [{ threshold: 10, direction: 'at_least' }], ...overrides
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('paired points and assists retain negative dependence instead of independent convolution', () => {
  const rows = [row(0, { points: 10, assists: 0 }), row(1, { points: 0, assists: 10 }),
    row(2, { points: 10, assists: 0 }), row(3, { points: 0, assists: 10 })];
  const result = buildNbaJointScenarios(request({ rows, market: 'points_assists',
    thresholds: [{ threshold: 15, direction: 'over' }], minutesScenarios: [30] }));
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.historical.mean, 10);
  assert.equal(result.historical.standardDeviation, 0);
  assert.deepEqual(result.historical.sample.map(x => x.value), [10, 10, 10, 10]);
  assert.equal(result.historical.thresholds[0].historicalRate, 0);
  assert.equal(result.minutesScenarios[0].thresholds[0].scenarioRate, 0);
});

test('10+, over 10, under 10 and half-point lines settle distinctly', () => {
  const thresholds = [
    { threshold: 10, direction: 'at_least' }, { threshold: 10, direction: 'over' },
    { threshold: 10, direction: 'under' }, { threshold: 10, direction: 'at_most' },
    { threshold: 9.5, direction: 'over' }
  ];
  const result = buildNbaJointScenarios(request({ rows: [row(0, { points: 9 }), row(1), row(2, { points: 11 })], thresholds }));
  const [atLeast, over, under, atMost, half] = result.historical.thresholds;
  close(atLeast.historicalRate, 2 / 3); assert.equal(atLeast.pushes, 0);
  close(over.historicalRate, 1 / 3); assert.equal(over.pushes, 1);
  close(under.historicalRate, 1 / 3); assert.equal(under.pushes, 1);
  close(atMost.historicalRate, 2 / 3); assert.equal(atMost.pushes, 0);
  close(half.historicalRate, 2 / 3); assert.equal(half.pushes, 0);
  for (const item of result.historical.thresholds) {
    assert.equal(item.wins + item.pushes + item.losses, item.observations);
    close(item.historicalRate + item.pushRate + item.lossRate, 1);
  }
});

test('threshold ladder is monotonic and all supported combos use the same row', () => {
  const result = buildNbaJointScenarios(request({ thresholds: [0, 5, 10, 15, 20].map(threshold => ({ threshold, direction: 'at_least' })) }));
  const rates = result.historical.thresholds.map(item => item.historicalRate);
  assert.ok(rates.every((value, i) => i === 0 || value <= rates[i - 1]));
  const expectations = { points: 10, rebounds: 5, assists: 4, points_assists: 14,
    points_rebounds: 15, rebounds_assists: 9, points_rebounds_assists: 19 };
  for (const [market, mean] of Object.entries(expectations)) {
    assert.equal(buildNbaJointScenarios(request({ market })).historical.mean, mean);
  }
});

test('sample moments and quantiles are descriptive and calculated without random draws', () => {
  const result = buildNbaJointScenarios(request({ rows: [row(0, { points: 1 }), row(1, { points: 2 }), row(2, { points: 5 })] }));
  const h = result.historical;
  close(h.mean, 8 / 3); assert.equal(h.median, 2); close(h.standardDeviation, Math.sqrt(13 / 3));
  close(h.quantiles.p10, 1.2); close(h.quantiles.p25, 1.5);
  close(h.quantiles.p75, 3.5); close(h.quantiles.p90, 4.4);
  assert.equal(h.simulationDrawCount, 0);
  assert.match(h.intervalInterpretation, /NOT_PREDICTION_INTERVALS/);
  assert.equal(result.modelVersion, NBA_JOINT_SCENARIOS_VERSION);
  assert.equal(result.modelProbability, null); assert.equal(h.modelProbability, null);
  assert.equal(result.productionEligible, false); assert.equal(result.automaticBuyEnabled, false);
});

test('cutoffs, target event, other identities, DNP and invalid source rows are diagnosed', () => {
  const rows = [row(0), row(1), row(2),
    row(3, { gameId: target.eventID }), row(4, { playerId: 'someone-else' }),
    row(5, { teamId: 'OLD_NBA' }), row(6, { minutes: 0 }),
    row(7, { observedAt: '2026-11-28T18:00:01Z' }),
    row(8, { startsAt: asOf, observedAt: asOf }),
    row(9, { observedAt: '2026-10-01T00:00:00Z' }),
    row(10, { startsAt: '2026-11-11' }), row(11, { points: -1 }),
    row(12, { rebounds: null }), row(13, { gameId: '' })];
  const result = buildNbaJointScenarios(request({ rows }));
  assert.equal(result.status, 'AVAILABLE');
  assert.deepEqual(result.historical.sourceGameIds, ['g0', 'g1', 'g2']);
  for (const reason of ['TARGET_EVENT', 'DIFFERENT_PLAYER', 'DIFFERENT_TEAM', 'NO_POSITIVE_MINUTES',
    'OBSERVED_AFTER_CUTOFF', 'GAME_NOT_BEFORE_CUTOFF', 'OBSERVATION_BEFORE_GAME', 'INVALID_ROW_TIMESTAMP', 'INVALID_ROW_IDENTITY']) {
    assert.equal(result.coverage.excludedCounts[reason], 1, reason);
  }
  assert.equal(result.coverage.excludedCounts.INVALID_STAT_LINE, 2);
  assert.equal(result.coverage.excludedCount, rows.length - 3);
});

test('same-game repeats and exact source aliases do not enlarge the observed sample', () => {
  const rows = [row(0), row(1), row(2), row(0, { observedAt: '2026-11-01T05:00:00Z' }),
    row(0, { gameId: 'provider-alias', observedAt: '2026-11-01T06:00:00Z' })];
  const result = buildNbaJointScenarios(request({ rows }));
  assert.equal(result.historical.observedGameCount, 3);
  assert.equal(result.coverage.excludedCounts.DUPLICATE_GAME_RECORD, 1);
  assert.equal(result.coverage.excludedCounts.DUPLICATE_GAME_APPEARANCE, 1);
  assert.equal(result.artifactId, buildNbaJointScenarios(request({ rows: [...rows].reverse() })).artifactId);
  assert.equal(result.artifactId, buildNbaJointScenarios(request()).artifactId);
});

test('conflicting game records and aliases are quarantined, independently of input order', () => {
  const rows = [row(0), row(1), row(2), row(3), row(0, { points: 12 }),
    row(0, { gameId: 'alias-of-conflict' })];
  const result = buildNbaJointScenarios(request({ rows }));
  assert.deepEqual(result.historical.sourceGameIds, ['g1', 'g2', 'g3']);
  assert.deepEqual(result.coverage.conflictingGameIds, ['alias-of-conflict', 'g0']);
  assert.equal(result.coverage.excludedCounts.CONFLICTING_GAME_RECORD, 2);
  assert.equal(result.coverage.excludedCounts.CONFLICTING_GAME_APPEARANCE, 1);
  assert.equal(result.artifactId, buildNbaJointScenarios(request({ rows: [...rows].reverse() })).artifactId);
  const aliases = buildNbaJointScenarios(request({ rows: [row(0), row(1), row(2), row(3),
    row(0, { gameId: 'different-source', assists: 100 })] }));
  assert.deepEqual(aliases.historical.sourceGameIds, ['g1', 'g2', 'g3']);
  assert.equal(aliases.coverage.excludedCounts.CONFLICTING_GAME_APPEARANCE, 2);
});

test('a revision observed after the cutoff cannot invalidate or replace a known prior row', () => {
  const base = buildNbaJointScenarios(request());
  const result = buildNbaJointScenarios(request({ rows: [row(0), row(1), row(2),
    row(0, { points: 99, observedAt: '2026-11-28T18:00:01Z' })] }));
  assert.equal(result.artifactId, base.artifactId);
  assert.deepEqual(result.historical, base.historical);
  assert.equal(result.coverage.excludedCounts.OBSERVED_AFTER_CUTOFF, 1);
});

test('only the most recent twenty eligible unique games enter the distribution', () => {
  const rows = Array.from({ length: 24 }, (_, i) => row(i, { points: i }));
  const result = buildNbaJointScenarios(request({ rows: rows.reverse() }));
  assert.equal(result.coverage.eligibleGameCount, 24);
  assert.equal(result.historical.observedGameCount, 20);
  assert.equal(result.historical.sourceGameIds[0], 'g4');
  assert.equal(result.historical.sourceGameIds.at(-1), 'g23');
  assert.equal(result.coverage.excludedCounts.OUTSIDE_HISTORY_WINDOW, 4);
  close(result.historical.mean, 13.5);
});

test('fewer than three unique usable games produces no probabilities or quantiles', () => {
  const result = buildNbaJointScenarios(request({ rows: [row(0), row(0), row(1)], minutesScenarios: [30] }));
  assert.equal(result.status, 'INSUFFICIENT_HISTORY');
  assert.equal(result.coverage.observedGameCount, 2);
  assert.equal(result.historical, null);
  assert.deepEqual(result.minutesScenarios, []);
  assert.deepEqual(result.errors, ['MINIMUM_THREE_UNIQUE_GAMES_REQUIRED']);
});

test('minutes sensitivity uses coherent integer component draws and preserves source sample size', () => {
  const rows = [row(0, { minutes: 20, points: 3, assists: 3 }),
    row(1, { minutes: 20, points: 5, assists: 1 }), row(2, { minutes: 20, points: 1, assists: 5 })];
  const result = buildNbaJointScenarios(request({ rows, market: 'points_assists',
    thresholds: [{ threshold: 6, direction: 'at_least' }], minutesScenarios: [10, 20, 30] }));
  assert.equal(result.historical.mean, 6);
  const low = result.minutesScenarios[0];
  assert.equal(low.mean, 4); // Round each paired component, then sum: 2+2, 3+1, 1+3.
  for (const scenario of result.minutesScenarios) {
    assert.equal(scenario.observedGameCount, 3);
    assert.equal(scenario.scenarioOutcomeCount, 3);
    assert.equal(scenario.simulationDrawCount, 0);
    assert.equal(scenario.assumption, 'USER_SUPPLIED_MINUTES');
    assert.equal(scenario.modelProbability, null);
    assert.equal(scenario.calibrated, false);
    assert.equal(scenario.productionEligible, false);
    assert.ok(scenario.sample.every(x => Number.isInteger(x.value) && x.value === x.points + x.assists && x.observedMinutes === 20));
    assert.equal(scenario.thresholds[0].observations, 3);
    assert.equal(Object.hasOwn(scenario.thresholds[0], 'historicalRate'), false);
  }
  assert.equal(result.minutesScenarios[1].mean, result.historical.mean);
  assert.equal(result.historical.observedGameCount, 3); // Three scenarios are not nine observations.
});

test('extreme scaled tails make a scenario unavailable rather than clipping or dropping rows', () => {
  const result = buildNbaJointScenarios(request({ rows: [row(0, { minutes: 1 / 60, points: 1 }), row(1), row(2)], minutesScenarios: [48] }));
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.historical.observedGameCount, 3);
  assert.equal(result.minutesScenarios[0].status, 'UNAVAILABLE');
  assert.deepEqual(result.minutesScenarios[0].errors, ['SCALED_OUTCOME_OUT_OF_RANGE']);
  assert.equal(result.minutesScenarios[0].scenarioOutcomeCount, 0);
  assert.deepEqual(result.minutesScenarios[0].thresholds, []);
});

test('invalid input and resource limits return explicit errors without coercing assumptions', () => {
  const bad = [
    { rows: null }, { rows: Array(NBA_JOINT_SCENARIO_LIMITS.inputRows + 1).fill(null) },
    { target: null }, { target: { ...target, opponentTeamId: target.teamId } },
    { target: { ...target, startsAt: asOf } }, { asOf: '2026-11-28' },
    { asOf: '2026-02-30T18:00:00Z' }, { market: {} },
    { market: 'three_pointers' }, { thresholds: [] },
    { thresholds: [{ threshold: '10', direction: 'over' }] },
    { thresholds: [{ threshold: 10, direction: 'higher' }] },
    { thresholds: [{ threshold: -1, direction: 'over' }] },
    { thresholds: Array.from({ length: 13 }, (_, i) => ({ threshold: i, direction: 'over' })) },
    { thresholds: [{ threshold: 10, direction: 'over' }, { threshold: 10, direction: 'over' }] },
    { minutesScenarios: [0] }, { minutesScenarios: [49] }, { minutesScenarios: ['30'] },
    { minutesScenarios: [10, 15, 20, 25, 30, 35] }, { minutesScenarios: [30, 30] }
  ];
  for (const overrides of bad) {
    const result = buildNbaJointScenarios(request(overrides));
    assert.equal(result.status, 'INVALID_INPUT', JSON.stringify(overrides));
    assert.ok(result.errors.length);
    assert.equal(result.historical, null); assert.equal(result.artifactId, null);
    assert.equal(result.modelProbability, null); assert.equal(result.productionEligible, false);
  }
  assert.equal(buildNbaJointScenarios().status, 'INVALID_INPUT');
  for (const invalid of [null, 'anything', 42, []]) {
    const result = buildNbaJointScenarios(invalid);
    assert.equal(result.status, 'INVALID_INPUT');
    assert.ok(result.errors.includes('INVALID_REQUEST'));
  }
});

test('artifact identity changes with the target assumptions and source values', () => {
  const original = buildNbaJointScenarios(request());
  for (const overrides of [
    { minutesScenarios: [30] }, { market: 'assists' },
    { thresholds: [{ threshold: 10.5, direction: 'over' }] },
    { rows: [row(0, { points: 11 }), row(1), row(2)] },
    { asOf: '2026-11-28T17:00:00Z' }
  ]) assert.notEqual(buildNbaJointScenarios(request(overrides)).artifactId, original.artifactId);
  assert.match(original.artifactId, /^sha256:[a-f0-9]{64}$/);
});

test('exclusion details are bounded while full exclusion counts remain available', () => {
  const rows = [row(0), row(1), row(2), ...Array.from({ length: 130 }, () => row(0, { playerId: 'other' }))];
  const result = buildNbaJointScenarios(request({ rows }));
  assert.equal(result.coverage.excludedCount, 130);
  assert.equal(result.coverage.excludedCounts.DIFFERENT_PLAYER, 130);
  assert.equal(result.coverage.excludedRows.length, 100);
  assert.equal(result.coverage.excludedRowsTruncated, true);
});
