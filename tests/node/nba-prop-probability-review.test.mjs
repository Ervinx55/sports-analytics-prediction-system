import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {evaluateNbaPropForecasts} from '../../scripts/evaluation/nba-prop-probability-review.mjs';

const asOf = '2026-11-28T12:00:00Z';
const modelHash = 'a'.repeat(64), otherHash = 'b'.repeat(64);
function forecast(id = 'one', patch = {}, hash = modelHash) {
  return {identity: id, model_hash: hash, payload: {identity: id, modelHash: hash,
    eventID: `game-${id}`, playerID: 'player', sport: 'NBA', market: 'points',
    side: 'OVER', line: 10.5, book: 'draftkings', startsAt: '2026-11-28T01:00:00Z',
    issuedAt: '2026-11-27T23:00:00Z', historyCutoff: '2026-11-27T18:00:00Z',
    quoteAt: '2026-11-27T22:59:00Z', oppositeQuoteAt: '2026-11-27T22:59:00Z',
    modelProbability: .9, marketProbability: .9, ...patch}};
}
function outcome(forecast, actual = 12, patch = {}) {
  const p = forecast.payload;
  return {identity: forecast.identity, payload: {identity: forecast.identity, playerID: p.playerID,
    officialEventId: p.eventID, officialStartAt: p.startsAt,
    retrievedAt: '2026-11-28T04:00:00Z', actual, actualMinutes: 30,
    outcome: actual === p.line ? 'PUSH' : (p.side === 'OVER' ? actual > p.line : actual < p.line) ? 'WIN' : 'LOSS',
    researchOnly: true, settlementPolicy: 'RESEARCH_POSITIVE_MINUTE_PARTICIPATION_ONLY', ...patch}};
}
function review(forecasts, outcomes = forecasts.map(f => outcome(f))) {
  return evaluateNbaPropForecasts({forecasts, outcomes, asOf});
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('paired comparison cannot claim improvement from asymmetric missing probability coverage', () => {
  const first = forecast('win'), second = forecast('loss', {modelProbability: null});
  const group = review([first, second], [outcome(first), outcome(second, 4)]).groups[0];
  assert.equal(group.binary.model.n, 1);
  assert.equal(group.binary.market.n, 2);
  close(group.binary.model.brier, .01);
  close(group.binary.market.brier, .41);
  assert.equal(group.paired.modelVsMarket.n, 1);
  close(group.paired.modelVsMarket.delta.brier, 0);
  close(group.paired.modelVsMarket.delta.logloss, 0);
  assert.equal(group.paired.modelVsMarket.excludedDecisiveSelections, 1);
});

test('many graded rows without probabilities remain unavailable', () => {
  const rows = Array.from({length: 250}, (_, index) => forecast(String(index), {modelProbability: null, marketProbability: null}));
  const report = review(rows), group = report.groups[0];
  assert.equal(report.status, 'PROBABILITY_EVALUATION_UNAVAILABLE');
  assert.equal(group.coverage.settledSelections, 250);
  assert.equal(group.binary.model.n, 0);
  assert.equal(group.binary.model.brier, null);
  assert.equal(group.paired.modelVsMarket.status, 'UNAVAILABLE');
  assert.equal(group.probabilityValidity.model.settled.MISSING, 250);
  assert.equal(report.productionEligible, false);
  assert.equal(report.automaticPromotion, false);
});

test('invalid ranges and numeric strings never become probabilities', () => {
  for (const value of [-.1, 1.1, NaN, Infinity, '.9']) {
    const group = review([forecast('one', {modelProbability: value})]).groups[0];
    assert.equal(group.binary.model.n, 0);
    assert.equal(group.paired.modelVsMarket.n, 0);
    assert.equal(group.probabilityValidity.model.settled.INVALID, 1);
  }
  for (const value of [0, 1]) {
    const group = review([forecast('one', {modelProbability: value})]).groups[0];
    assert.equal(group.binary.model.n, 1);
    assert.ok(Number.isFinite(group.binary.model.logloss));
  }
});

test('earliest quote is selected before probability/outcome lookup and repeated books add no samples', () => {
  const first = forecast('first', {eventID: 'same-game', modelProbability: null});
  const later = forecast('later', {eventID: 'same-game', issuedAt: '2026-11-27T23:05:00Z', book: 'fanduel', modelProbability: .9});
  const group = review([later, first, structuredClone(first)]).groups[0];
  assert.equal(group.coverage.selectedForecasts, 1);
  assert.equal(group.coverage.duplicateRowsRemoved, 2);
  assert.equal(group.independentGameCount, 1);
  assert.equal(group.binary.model.n, 0);
  assert.equal(group.selections[0].identity, 'first');
});

test('same-time conflicting predictions are excluded without a later fallback', () => {
  const first = forecast('one', {eventID: 'same'});
  const second = forecast('two', {eventID: 'same', book: 'fanduel', modelProbability: .7});
  const later = forecast('later', {eventID: 'same', issuedAt: '2026-11-27T23:10:00Z'});
  const report = review([first, second, later]);
  assert.equal(report.groups[0].coverage.ambiguousSelections, 1);
  assert.equal(report.groups[0].coverage.settledSelections, 0);
  assert.equal(report.exclusionCounts.CONFLICTING_EARLIEST_FORECASTS_OR_STARTS, 1);
});

test('same-time identical model forecasts choose a book deterministically without changing the input', () => {
  const first = forecast('one', {eventID: 'same', book: 'fanduel', marketProbability: .8});
  const second = forecast('two', {eventID: 'same', book: 'draftkings', marketProbability: .7});
  const input = {forecasts: [first, second], outcomes: [outcome(first), outcome(second)], asOf};
  const before = JSON.stringify(input), a = evaluateNbaPropForecasts(input);
  const b = evaluateNbaPropForecasts({...input, forecasts: [...input.forecasts].reverse()});
  assert.equal(a.groups[0].selections[0].book, 'draftkings');
  assert.deepEqual(a.groups, b.groups);
  assert.equal(JSON.stringify(input), before);
});

test('pushes stay out of conditional binary scoring and remain in full three-way scores', () => {
  const push = forecast('push', {line: 10, modelProbability: .75,
    probability: {over: .6, push: .2, under: .2, modelProbability: .75}});
  const win = forecast('win', {line: 10, modelProbability: .75,
    probability: {over: .6, push: .2, under: .2, modelProbability: .75}});
  const group = review([push, win], [outcome(push, 10), outcome(win, 12)]).groups[0];
  assert.equal(group.coverage.pushes, 1);
  assert.equal(group.binary.model.n, 1);
  close(group.binary.model.brier, .0625);
  assert.equal(group.paired.modelVsMarket.n, 1);
  assert.equal(group.threeWayModel.n, 2);
  close(group.threeWayModel.brier, (.36 + .64 + .04 + .16 + .04 + .04) / 2);
  assert.equal(group.threeWayModel.outcomes.PUSH, 1);
});

test('under distributions reverse win and loss, with an all-push distribution scored only three-way', () => {
  const under = forecast('under', {side: 'UNDER', line: 10, modelProbability: .25,
    probability: {over: .6, push: .2, under: .2, modelProbability: .25}});
  const push = forecast('push', {line: 10, modelProbability: null, distribution: {win: 0, push: 1, loss: 0}});
  const group = review([under, push], [outcome(under, 9), outcome(push, 10)]).groups[0];
  assert.equal(group.binary.model.n, 1);
  close(group.binary.model.brier, .75 ** 2);
  assert.equal(group.threeWayModel.n, 2);
  close(group.threeWayModel.brier, (.64 + .04 + .36) / 2);
});

test('invalid distributions and conditional probability inconsistencies are visible', () => {
  const invalid = forecast('invalid', {probability: {over: .8, push: .1, under: .1}});
  const mismatch = forecast('mismatch', {line: 10, probability: {over: .4, push: .2, under: .4}, modelProbability: .8});
  const group = review([invalid, mismatch]).groups[0];
  assert.equal(group.binary.model.n, 0);
  assert.equal(group.probabilityValidity.distribution.selected.INVALID, 1);
  assert.equal(group.probabilityValidity.model.reasons.CONDITIONAL_PROBABILITY_MISMATCH, 1);
  assert.equal(group.threeWayModel.n, 1);
});

test('malformed distribution containers are invalid, while tiny positive non-push mass stays valid', () => {
  for (const key of ['distribution', 'probability']) {
    for (const value of ['unavailable', [], .7]) {
      const group = review([forecast('one', {[key]: value})]).groups[0];
      assert.equal(group.probabilityValidity.distribution.selected.INVALID, 1);
      assert.equal(group.binary.model.n, 0);
    }
  }
  const small = forecast('small', {line: 10, modelProbability: .5,
    distribution: {win: 5e-13, push: 1 - 1e-12, loss: 5e-13}});
  const group = review([small]).groups[0];
  assert.equal(group.probabilityValidity.model.selected.VALID, 1);
  close(group.binary.model.brier, .25);
});

test('pregame chronology, historical cutoff and exact period are required', () => {
  const patches = [
    {issuedAt: '2026-11-28T01:00:00Z'},
    {historyCutoff: '2026-11-27T23:01:00Z'},
    {historyCutoff: undefined},
    {historyCutoff: '2026-02-30T00:00:00Z'},
    {marketScope: 'FIRST_HALF'},
    {line: 10.25}
  ];
  for (const patch of patches) {
    const report = review([forecast('one', patch)]);
    assert.equal(report.input.eligibleForecastRows, 0, JSON.stringify(patch));
    assert.equal(report.groups.length, 0);
  }
  const future = forecast('future', {issuedAt: '2026-11-29T01:00:00Z', startsAt: '2026-11-29T03:00:00Z'});
  assert.equal(review([future]).input.eligibleForecastRows, 0);
});

test('future or unsettled outcomes, mismatched grades, and nonparticipation cannot become binary losses', () => {
  const first = forecast();
  for (const patch of [
    {retrievedAt: '2026-11-28T13:00:00Z'},
    {retrievedAt: '2026-11-28T00:00:00Z'},
    {status: 'LIVE'},
    {outcome: 'PENDING'},
    {outcome: 'LOSS'},
    {actualMinutes: 0},
    {officialEventId: 'wrong-game'},
    {playerID: 'wrong-player'},
    {officialStartAt: '2026-11-28T02:00:00Z'}
  ]) {
    const group = review([first], [outcome(first, 12, patch)]).groups[0];
    assert.equal(group.coverage.settledSelections, 0, JSON.stringify(patch));
    assert.equal(group.binary.model.n, 0);
  }
  for (const status of ['INACTIVE', 'VOID']) {
    const group = review([first], [outcome(first, null, {outcome: status, actualMinutes: 0})]).groups[0];
    assert.equal(group.binary.model.n, 0);
    assert.equal(group.coverage.unscoredReasons[status], 1);
  }
});

test('models and markets have separate reports while alternate selections retain one distinct game', () => {
  const first = forecast('same-id', {eventID: 'game'});
  const challenger = forecast('same-id', {eventID: 'game', modelProbability: .7}, otherHash);
  const alternate = forecast('alternate', {eventID: 'game', line: 12.5});
  const rebound = forecast('rebound', {eventID: 'game', market: 'rebounds', line: 5.5});
  const report = review([first, challenger, alternate, rebound], [outcome(first), outcome(alternate, 14), outcome(rebound)]);
  assert.equal(report.groups.length, 3);
  const group = report.groups.find(row => row.modelHash === modelHash && row.market === 'points');
  assert.equal(group.coverage.settledSelections, 2);
  assert.equal(group.independentGameCount, 1);
  assert.equal(group.paired.modelVsMarket.independentGameCount, 1);
});

test('conflicting outcomes and identity reuse are excluded', () => {
  const first = forecast();
  const report = review([first], [outcome(first, 12), outcome(first, 8)]);
  assert.equal(report.groups[0].binary.model.n, 0);
  assert.equal(report.exclusionCounts.CONFLICTING_OUTCOMES, 1);
  const wrong = forecast('one', {eventID: 'other-game'});
  assert.equal(review([first, wrong]).input.eligibleForecastRows, 0);
});

test('a future market quote invalidates only its same-row comparison', () => {
  const group = review([forecast('one', {quoteAt: '2026-11-27T23:01:00Z'})]).groups[0];
  assert.equal(group.binary.model.n, 1);
  assert.equal(group.binary.market.n, 0);
  assert.equal(group.paired.modelVsMarket.n, 0);
});

test('invalid input returns a structured unavailable report', () => {
  for (const input of [undefined, null, [], {}, {forecasts: [], outcomes: [], asOf: '2026-11-28'}]) {
    const report = evaluateNbaPropForecasts(input);
    assert.equal(report.status, 'INVALID_INPUT');
    assert.equal(report.productionEligible, false);
  }
});

test('offline CLI writes a report and refuses to overwrite input or an existing report', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'nba-probability-review-'));
  try {
    const input = path.join(folder, 'input.json'), output = path.join(folder, 'report.json');
    const first = forecast();
    writeFileSync(input, JSON.stringify({forecasts: [first], outcomes: [outcome(first)], asOf}));
    const original = readFileSync(input, 'utf8');
    const script = new URL('../../scripts/evaluation/nba-prop-probability-review.mjs', import.meta.url);
    const invoke = destination => spawnSync(process.execPath, [script.pathname, '--input', input, '--out', destination], {encoding: 'utf8'});
    assert.equal(invoke(output).status, 0);
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).groups[0].paired.modelVsMarket.n, 1);
    assert.equal(invoke(input).status, 1);
    assert.equal(invoke(output).status, 1);
    assert.equal(readFileSync(input, 'utf8'), original);
  } finally { rmSync(folder, {recursive: true, force: true}); }
});
