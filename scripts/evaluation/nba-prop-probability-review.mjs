// Descriptive, offline review of saved v47 NBA forecasts. This does not fit a
// model, authenticate caller-supplied records, or authorize a wager/promotion.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {metrics} from './winner-validation-metrics.mjs';

const CONTRACT = 'nba-prop-probability-review-v1';
const EPSILON = 1e-12;
const TOLERANCE = 1e-9;
const MARKETS = new Set(['points', 'rebounds', 'assists', 'points_assists',
  'points_rebounds', 'rebounds_assists', 'points_rebounds_assists', 'three_pointers']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const named = value => typeof value === 'string' && value.trim().length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const probability = value => finite(value) && value >= 0 && value <= 1;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const countBy = values => values.reduce((counts, value) => {
  counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}, {});
function time(value) {
  if (typeof value !== 'string') return NaN;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (y < 1 || m < 1 || m > 12 || d < 1 ||
      d > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return NaN;
  return Date.parse(value);
}
function probabilityState(value) {
  if (value === null || value === undefined) return {status: 'MISSING', value: null};
  return probability(value) ? {status: 'VALID', value} : {status: 'INVALID', value: null};
}
function distributionState(payload) {
  const sources = [];
  if (['distribution', 'probability'].some(key => payload[key] !== undefined &&
      payload[key] !== null && !object(payload[key]))) {
    return {status: 'INVALID', value: null, reason: 'INVALID_DISTRIBUTION_CONTAINER'};
  }
  if (object(payload.distribution)) sources.push(payload.distribution);
  if (object(payload.probability) && ['under', 'push', 'over'].some(key => key in payload.probability)) {
    const p = payload.probability;
    sources.push({win: payload.side === 'OVER' ? p.over : p.under,
      push: p.push, loss: payload.side === 'OVER' ? p.under : p.over});
  }
  if (!sources.length) return {status: 'MISSING', value: null};
  if (sources.some(p => !['win', 'push', 'loss'].every(key => probability(p[key])) ||
      Math.abs(p.win + p.push + p.loss - 1) > TOLERANCE ||
      (!Number.isInteger(payload.line) && p.push !== 0))) {
    return {status: 'INVALID', value: null, reason: 'INVALID_WIN_PUSH_LOSS_DISTRIBUTION'};
  }
  if (sources.some(p => ['win', 'push', 'loss'].some(key => Math.abs(p[key] - sources[0][key]) > TOLERANCE))) {
    return {status: 'INVALID', value: null, reason: 'CONFLICTING_DISTRIBUTIONS'};
  }
  const {win, push, loss} = sources[0];
  return {status: 'VALID', value: {win, push, loss}};
}
function modelState(payload, distribution) {
  const state = probabilityState(Object.hasOwn(payload, 'modelProbability')
    ? payload.modelProbability : payload.probability?.modelProbability);
  if (distribution.status === 'INVALID' && state.status === 'VALID') {
    return {status: 'INVALID', value: null, reason: distribution.reason};
  }
  if (state.status === 'VALID' && distribution.status === 'VALID') {
    const p = distribution.value, nonPush = p.win + p.loss;
    if (nonPush === 0 || Math.abs(state.value - p.win / nonPush) > TOLERANCE) {
      return {status: 'INVALID', value: null, reason: 'CONDITIONAL_PROBABILITY_MISMATCH'};
    }
  }
  if (state.status === 'VALID' && payload.probability?.modelProbability !== undefined &&
      payload.probability.modelProbability !== null &&
      (!probability(payload.probability.modelProbability) ||
      Math.abs(state.value - payload.probability.modelProbability) > TOLERANCE)) {
    return {status: 'INVALID', value: null, reason: 'CONFLICTING_MODEL_PROBABILITIES'};
  }
  return state;
}
function marketState(payload, issued) {
  const state = probabilityState(payload.marketProbability);
  if (state.status !== 'VALID') return state;
  for (const key of ['quoteAt', 'oppositeQuoteAt']) {
    if (payload[key] !== undefined && (!Number.isFinite(time(payload[key])) || time(payload[key]) > issued)) {
      return {status: 'INVALID', value: null, reason: 'MARKET_QUOTE_AFTER_FORECAST_OR_INVALID'};
    }
  }
  return state;
}
function parseForecast(row, asOf) {
  if (!object(row) || !object(row.payload)) return {error: 'INVALID_FORECAST_ROW'};
  const p = row.payload;
  if (!named(row.identity) || (p.identity !== undefined && p.identity !== row.identity)) return {error: 'FORECAST_IDENTITY_MISMATCH'};
  if (!/^[a-f0-9]{64}$/.test(row.model_hash ?? '') ||
      (p.modelHash !== undefined && p.modelHash !== row.model_hash)) return {error: 'MODEL_HASH_MISMATCH'};
  if (!named(p.eventID) || !named(p.playerID) || (p.sport !== undefined && p.sport !== 'NBA')) return {error: 'INVALID_SELECTION_IDENTITY'};
  if (!MARKETS.has(p.market)) return {error: 'UNSUPPORTED_MARKET'};
  const scopes = ['period', 'marketScope', 'market_scope', 'scope'].filter(key => p[key] !== undefined).map(key => p[key]);
  if (scopes.some(scope => !['FULL_GAME', 'full_game', 'game'].includes(scope))) return {error: 'UNSUPPORTED_PERIOD'};
  if (!['OVER', 'UNDER'].includes(p.side) || !finite(p.line) || p.line < 0 || p.line > 1000 ||
      !Number.isInteger(p.line * 2)) return {error: 'INVALID_EXACT_LINE'};
  const issued = time(p.issuedAt), starts = time(p.startsAt);
  if (!Number.isFinite(issued) || !Number.isFinite(starts) || issued >= starts || issued > asOf) return {error: 'INVALID_PREGAME_CHRONOLOGY'};
  const cutoffs = ['historyCutoff', 'inputCutoff'].filter(key => p[key] !== undefined);
  if (!cutoffs.length) return {error: 'HISTORY_CUTOFF_MISSING'};
  if (cutoffs.some(key => !Number.isFinite(time(p[key])) || time(p[key]) > issued)) return {error: 'HISTORY_CUTOFF_AFTER_FORECAST_OR_INVALID'};
  const selection = [p.eventID, p.playerID, p.market, 'FULL_GAME', p.side, p.line];
  const distribution = distributionState(p);
  return {identity: row.identity, modelHash: row.model_hash, payload: p, issued, starts,
    period: 'FULL_GAME', periodExplicit: scopes.length > 0, key: JSON.stringify(selection),
    groupKey: JSON.stringify([row.model_hash, p.market, 'FULL_GAME']),
    distribution, model: modelState(p, distribution), market: marketState(p, issued)};
}
function tiedForecastSignature(row) {
  const p = row.payload;
  return JSON.stringify([row.starts, row.model, row.distribution,
    p.baselineProjection ?? null, p.candidateProjection ?? null,
    p.historyCutoff ?? null, p.inputCutoff ?? null, p.historySnapshotDigest ?? null]);
}
function parseOutcome(row, forecast, asOf) {
  if (!object(row) || !object(row.payload) || row.identity !== forecast.identity) return {error: 'INVALID_OUTCOME_ROW'};
  const p = row.payload, f = forecast.payload;
  if ((p.identity !== undefined && p.identity !== row.identity) || p.playerID !== f.playerID ||
      (p.officialEventId ?? p.eventID) !== f.eventID ||
      (p.eventID !== undefined && p.eventID !== f.eventID)) return {error: 'OUTCOME_IDENTITY_MISMATCH'};
  const officialStart = time(p.officialStartAt ?? p.startsAt);
  if (!Number.isFinite(officialStart) || officialStart !== forecast.starts) return {error: 'OUTCOME_START_MISMATCH'};
  const stamps = ['retrievedAt', 'observedAt', 'gradedAt'].filter(key => p[key] !== undefined).map(key => time(p[key]));
  if (!stamps.length || stamps.some(value => !Number.isFinite(value) || value <= officialStart || value > asOf)) {
    return {error: 'OUTCOME_TIMESTAMP_UNAVAILABLE_OR_OUTSIDE_AS_OF'};
  }
  if ((p.completed !== undefined && p.completed !== true) ||
      (p.status !== undefined && !['FINAL', 'COMPLETED'].includes(p.status))) return {error: 'OUTCOME_NOT_FINAL'};
  const outcome = ({W: 'WIN', L: 'LOSS', WIN: 'WIN', LOSS: 'LOSS', PUSH: 'PUSH', VOID: 'VOID', INACTIVE: 'INACTIVE'})[p.outcome];
  if (!outcome) return {error: 'OUTCOME_NOT_FINAL'};
  if (['VOID', 'INACTIVE'].includes(outcome)) return {outcome, actual: null, observed: Math.max(...stamps)};
  if (!Number.isInteger(p.actual) || p.actual < 0 || p.actual > 1000 || !finite(p.actualMinutes) ||
      p.actualMinutes <= 0 || p.actualMinutes > 100) return {error: 'POSITIVE_MINUTE_ACTUAL_UNVERIFIED'};
  const actualGrade = p.actual === f.line ? 'PUSH' :
    ((f.side === 'OVER' ? p.actual > f.line : p.actual < f.line) ? 'WIN' : 'LOSS');
  if (outcome !== actualGrade) return {error: 'OUTCOME_GRADE_MISMATCH'};
  return {outcome, actual: p.actual, actualMinutes: p.actualMinutes, observed: Math.max(...stamps)};
}
function binaryMetrics(rows, key) {
  const selected = rows.filter(row => row.outcome !== 'PUSH' && row[key].status === 'VALID');
  return {...metrics(selected.map(row => ({probability: row[key].value, outcome: Number(row.outcome === 'WIN')}))),
    independentGameCount: new Set(selected.map(row => row.payload.eventID)).size};
}
function threeWayMetrics(rows) {
  const selected = rows.filter(row => row.distribution.status === 'VALID');
  const sums = selected.reduce((sum, row) => {
    const actual = row.outcome.toLowerCase(), p = row.distribution.value;
    sum.brier += ['win', 'push', 'loss'].reduce((score, key) => score + (p[key] - Number(key === actual)) ** 2, 0);
    sum.logloss -= Math.log(Math.max(EPSILON, p[actual]));
    return sum;
  }, {brier: 0, logloss: 0});
  return {n: selected.length, independentGameCount: new Set(selected.map(row => row.payload.eventID)).size,
    brier: selected.length ? sums.brier / selected.length : null,
    logloss: selected.length ? sums.logloss / selected.length : null,
    brierConvention: 'SUM_OF_THREE_SQUARED_ERRORS_RANGE_0_TO_2',
    outcomes: countBy(selected.map(row => row.outcome))};
}
function summarizeGroup(group, outcomeIndex, asOf, exclusions) {
  const exact = new Map(), selected = [], scores = [], unscored = [];
  for (const row of group.rows) {
    if (!exact.has(row.key)) exact.set(row.key, []);
    exact.get(row.key).push(row);
  }
  let duplicateRowsRemoved = 0, ambiguousSelections = 0;
  for (const rows of exact.values()) {
    rows.sort((a, b) => a.issued - b.issued || compare(a.payload.book ?? '', b.payload.book ?? '') || compare(a.identity, b.identity));
    const earliest = rows.filter(row => row.issued === rows[0].issued);
    const bookSignatures = new Map();
    const sameBookConflict = earliest.some(row => {
      const book = row.payload.book ?? '', signature = JSON.stringify([row.market, row.payload.quoteAt ?? null, row.payload.oppositeQuoteAt ?? null]);
      const conflict = bookSignatures.has(book) && bookSignatures.get(book) !== signature;
      bookSignatures.set(book, signature);
      return conflict;
    });
    if (new Set(rows.map(row => row.starts)).size !== 1 ||
        new Set(earliest.map(tiedForecastSignature)).size !== 1 || sameBookConflict) {
      ambiguousSelections++;
      exclusions.push({stage: 'selection', code: 'CONFLICTING_EARLIEST_FORECASTS_OR_STARTS',
        modelHash: group.modelHash, selectionKey: rows[0].key, forecastRows: rows.length});
      continue;
    }
    const row = earliest[0];
    selected.push(row);
    duplicateRowsRemoved += rows.length - 1;
    const candidates = outcomeIndex.get(row.identity) ?? [];
    const parsed = candidates.map(candidate => parseOutcome(candidate, row, asOf));
    const usable = parsed.filter(result => !result.error);
    for (const result of parsed.filter(result => result.error)) exclusions.push({stage: 'outcome', code: result.error,
      modelHash: group.modelHash, identity: row.identity, selectionKey: row.key});
    if (!usable.length) {
      const code = candidates.length ? 'NO_ELIGIBLE_OUTCOME_AS_OF' : 'OUTCOME_MISSING';
      unscored.push({identity: row.identity, selectionKey: row.key, code});
      exclusions.push({stage: 'selection', code, modelHash: group.modelHash, identity: row.identity, selectionKey: row.key});
      continue;
    }
    if (new Set(usable.map(result => JSON.stringify([result.outcome, result.actual, result.actualMinutes ?? null]))).size !== 1) {
      unscored.push({identity: row.identity, selectionKey: row.key, code: 'CONFLICTING_OUTCOMES'});
      exclusions.push({stage: 'selection', code: 'CONFLICTING_OUTCOMES', modelHash: group.modelHash, identity: row.identity, selectionKey: row.key});
      continue;
    }
    const outcome = usable.sort((a, b) => a.observed - b.observed)[0];
    if (['VOID', 'INACTIVE'].includes(outcome.outcome)) {
      unscored.push({identity: row.identity, selectionKey: row.key, code: outcome.outcome});
      continue;
    }
    scores.push({...row, ...outcome});
  }
  const decisive = scores.filter(row => row.outcome !== 'PUSH');
  const paired = decisive.filter(row => row.model.status === 'VALID' && row.market.status === 'VALID');
  const pairedModel = binaryMetrics(paired, 'model'), pairedMarket = binaryMetrics(paired, 'market');
  const model = binaryMetrics(scores, 'model'), market = binaryMetrics(scores, 'market'), threeWay = threeWayMetrics(scores);
  return {modelHash: group.modelHash, market: group.market, period: 'FULL_GAME',
    status: model.n || threeWay.n ? 'DESCRIPTIVE_ONLY' : 'PROBABILITY_EVALUATION_UNAVAILABLE',
    productionEligible: false, productionWeight: 0, automaticPromotion: false,
    coverage: {inputForecastRows: group.rows.length, exactSelectionsBeforeConflictCheck: exact.size,
      selectedForecasts: selected.length, duplicateRowsRemoved, ambiguousSelections,
      defaultFullGamePeriodRows: group.rows.filter(row => !row.periodExplicit).length,
      settledSelections: scores.length, decisiveSelections: decisive.length,
      pushes: scores.length - decisive.length,
      unscoredSelections: unscored.length, unscoredReasons: countBy(unscored.map(row => row.code))},
    independentGameCount: new Set(scores.map(row => row.payload.eventID)).size,
    probabilityValidity: Object.fromEntries(['model', 'market', 'distribution'].map(key => [key, {
      selected: countBy(selected.map(row => row[key].status)),
      settled: countBy(scores.map(row => row[key].status)),
      reasons: countBy(selected.filter(row => row[key].reason).map(row => row[key].reason))
    }])),
    binary: {model, market,
      interpretation: 'Separate coverage summaries are not directly compared; use paired.modelVsMarket.'},
    paired: {modelVsMarket: {status: paired.length ? 'DESCRIPTIVE_ONLY' : 'UNAVAILABLE', n: paired.length,
      independentGameCount: new Set(paired.map(row => row.payload.eventID)).size,
      excludedDecisiveSelections: decisive.length - paired.length, model: pairedModel, market: pairedMarket,
      delta: {brier: paired.length ? pairedModel.brier - pairedMarket.brier : null,
        logloss: paired.length ? pairedModel.logloss - pairedMarket.logloss : null},
      deltaConvention: 'MODEL_MINUS_MARKET_ON_IDENTICAL_DECISIVE_SELECTIONS; NEGATIVE_IS_LOWER_LOSS',
      uncertainty: null, superiorityEstablished: false}},
    threeWayModel: threeWay,
    selections: scores.map(row => ({identity: row.identity, selectionKey: row.key,
      eventID: row.payload.eventID, playerID: row.payload.playerID, side: row.payload.side,
      line: row.payload.line, book: row.payload.book ?? null, issuedAt: row.payload.issuedAt,
      actual: row.actual, outcome: row.outcome,
      modelProbability: row.model.value, marketProbability: row.market.value,
      distribution: row.distribution.value,
      inPairedComparison: row.outcome !== 'PUSH' && row.model.status === 'VALID' && row.market.status === 'VALID'})),
    unscoredSelections: unscored};
}

export function evaluateNbaPropForecasts(input = {}) {
  const {forecasts, outcomes, asOf} = object(input) ? input : {};
  const report = {contract: CONTRACT, asOf: asOf ?? null, status: 'INVALID_INPUT',
    productionEligible: false, productionWeight: 0, automaticPromotion: false,
    groups: [], exclusions: []};
  const cutoff = time(asOf);
  if (!Array.isArray(forecasts) || !Array.isArray(outcomes) || !Number.isFinite(cutoff)) {
    report.exclusions.push({stage: 'input', code: 'ARRAYS_AND_EXPLICIT_AS_OF_REQUIRED'});
    return report;
  }
  const parsed = [], groups = new Map(), identities = new Map(), outcomeIndex = new Map();
  for (const [index, row] of forecasts.entries()) {
    const result = parseForecast(row, cutoff);
    if (result.error) {
      report.exclusions.push({stage: 'forecast', code: result.error, inputIndex: index,
        identity: named(row?.identity) ? row.identity : null, modelHash: named(row?.model_hash) ? row.model_hash : null});
      continue;
    }
    parsed.push(result);
    const identityKey = JSON.stringify([result.modelHash, result.identity]);
    if (!identities.has(identityKey)) identities.set(identityKey, new Set());
    identities.get(identityKey).add(result.key);
  }
  for (const row of parsed) {
    if (identities.get(JSON.stringify([row.modelHash, row.identity])).size > 1) {
      report.exclusions.push({stage: 'forecast', code: 'IDENTITY_REUSED_FOR_DIFFERENT_SELECTION',
        identity: row.identity, modelHash: row.modelHash});
      continue;
    }
    if (!groups.has(row.groupKey)) groups.set(row.groupKey, {modelHash: row.modelHash, market: row.payload.market, rows: []});
    groups.get(row.groupKey).rows.push(row);
  }
  for (const [index, row] of outcomes.entries()) {
    if (!object(row) || !named(row.identity) || !object(row.payload)) {
      report.exclusions.push({stage: 'outcome', code: 'INVALID_OUTCOME_ROW', inputIndex: index});
      continue;
    }
    if (!outcomeIndex.has(row.identity)) outcomeIndex.set(row.identity, []);
    outcomeIndex.get(row.identity).push(row);
  }
  report.groups = [...groups.entries()].sort(([a], [b]) => compare(a, b))
    .map(([, group]) => summarizeGroup(group, outcomeIndex, cutoff, report.exclusions));
  report.status = report.groups.some(group => group.status === 'DESCRIPTIVE_ONLY')
    ? 'DESCRIPTIVE_REVIEW' : 'PROBABILITY_EVALUATION_UNAVAILABLE';
  report.input = {forecastRows: forecasts.length, outcomeRows: outcomes.length,
    eligibleForecastRows: [...groups.values()].reduce((sum, group) => sum + group.rows.length, 0)};
  report.exclusionCounts = countBy(report.exclusions.map(row => row.code));
  report.selectionPolicy = {
    scope: 'NBA_FULL_GAME_POSITIVE_MINUTE_PARTICIPATION',
    canonicalFields: ['eventID', 'playerID', 'market', 'FULL_GAME', 'side', 'line'],
    selection: 'EARLIEST_ELIGIBLE_PREGAME_ISSUE_BEFORE_LOOKING_AT_OUTCOMES_OR_PROBABILITY_AVAILABILITY',
    tiePolicy: 'REJECT_CONFLICTING_MODEL_OR_SAME_BOOK_RECORDS; OTHERWISE_BOOK_THEN_IDENTITY_ASCENDING',
    missingPeriod: 'ABSENT_PERIOD_IS_V47_FULL_GAME; EXPLICIT_OTHER_PERIODS_ARE_REJECTED',
    settlement: 'EXACT_IDENTITY_JOIN_AND_ACTUAL_STAT_REGRADING; NO_BOOK_PAYOUT_INFERENCE'
  };
  report.limitations = [
    'Descriptive review only; no fitted calibration, untouched confirmation claim, confidence interval, model superiority, or automatic approval.',
    'Caller-supplied as-of and history-cutoff metadata are checked, not independently authenticated historical receipts.',
    'Input completeness cannot be established from these arrays. Preserve the original export, source query and pagination evidence.',
    'Multiple players, sides and alternate lines from one game remain dependent. Independent game counts use distinct source event IDs, not quote or row counts.',
    'No cross-provider event alias resolution is attempted. Different provider IDs require reconciliation before claiming independent physical games.',
    'Binary probabilities are conditional on positive-minute participation and no push; pushes only enter full win/push/loss scoring.',
    'Market comparisons use the selected forecast’s recorded market probability. Exact underlying odds and no-vig calculations are not authenticated by this review.'
  ];
  return report;
}

function runCli(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--input', '--out'].includes(key) || !args[i + 1] || values[key]) {
      throw new Error('Usage: node scripts/evaluation/nba-prop-probability-review.mjs --input <json> --out <report.json>');
    }
    values[key] = args[i + 1];
  }
  if (!values['--input'] || !values['--out']) throw new Error('Both --input and --out are required.');
  const input = path.resolve(values['--input']), output = path.resolve(values['--out']);
  if (input === output || (fs.existsSync(output) && fs.realpathSync(input) === fs.realpathSync(output))) {
    throw new Error('The output must not overwrite the original input artifact.');
  }
  const report = evaluateNbaPropForecasts(JSON.parse(fs.readFileSync(input, 'utf8')));
  // Exclusive creation also protects prior reports and aliases/hard links.
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  process.stdout.write(JSON.stringify({status: report.status, groups: report.groups.length,
    forecastRows: report.input?.forecastRows ?? null, output}) + '\n');
  if (report.status === 'INVALID_INPUT') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runCli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
