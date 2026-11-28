import { createHash } from 'node:crypto';
import { thresholdProbability } from './edge-vnext.js';

// Descriptive paired-game analysis and explicit minutes sensitivity only.
// Historical proportions are never promoted to calibrated forecast probabilities.
export const NBA_JOINT_SCENARIOS_VERSION = 'nba-paired-empirical-minutes-v1';
export const NBA_JOINT_SCENARIO_LIMITS = Object.freeze({
  inputRows: 5000, historyGames: 20, minimumGames: 3,
  thresholds: 12, minutesScenarios: 5
});
const COMPONENTS = Object.freeze({
  points: ['points'], rebounds: ['rebounds'], assists: ['assists'],
  points_assists: ['points', 'assists'],
  points_rebounds: ['points', 'rebounds'],
  rebounds_assists: ['rebounds', 'assists'],
  points_rebounds_assists: ['points', 'rebounds', 'assists']
});
export const NBA_JOINT_SCENARIO_MARKETS = Object.freeze(Object.keys(COMPONENTS));
const DIRECTIONS = new Set(['at_least', 'over', 'under', 'at_most']);
const MAX_OUTCOME = 1000;
const MAX_DIAGNOSTICS = 100;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const identifier = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
function timestamp(value) {
  if (typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const day = Date.parse(value.slice(0, 10) + 'T00:00:00Z');
  // Date.parse can normalize February 30 into March; never accept that silently.
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return Date.parse(value);
}
const hash = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const appearanceKey = row => JSON.stringify([row.playerId, row.teamId, row.startsAt]);
const factsKey = row => JSON.stringify([
  row.startsAt, row.playerId, row.teamId, row.minutes,
  row.points, row.rebounds, row.assists
]);
const groupBy = (rows, key) => {
  const groups = new Map();
  for (const row of rows) {
    const value = key(row);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
};

function quantile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index), upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarize(sample, thresholds, rateField) {
  const observations = sample.length;
  const values = sample.map(row => row.value).sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / observations;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (observations - 1);
  const pmf = Array(values.at(-1) + 1).fill(0);
  for (const value of values) pmf[value] += 1 / observations;
  return {
    mean, median: quantile(values, 0.5), standardDeviation: Math.sqrt(variance),
    standardDeviationMethod: 'SAMPLE_N_MINUS_ONE',
    quantiles: {
      p10: quantile(values, 0.1), p25: quantile(values, 0.25),
      p75: quantile(values, 0.75), p90: quantile(values, 0.9)
    },
    quantileMethod: 'LINEAR_INTERPOLATION_R7',
    intervalInterpretation: 'DESCRIPTIVE_SAMPLE_QUANTILES_NOT_PREDICTION_INTERVALS',
    observedGameCount: observations,
    sourceGameIds: sample.map(row => row.gameId), sample,
    thresholds: thresholds.map(({ threshold, direction }) => {
      const settlement = thresholdProbability({ pmf, threshold, direction });
      // These are exact empirical counts, not simulated effective sample sizes.
      const wins = Math.round(settlement.winProbability * observations);
      const pushes = Math.round(settlement.pushProbability * observations);
      const losses = observations - wins - pushes;
      return {
        threshold, direction, [rateField]: wins / observations,
        pushRate: pushes / observations, lossRate: losses / observations,
        wins, pushes, losses, observations
      };
    })
  };
}

function minutesScenario(rows, market, thresholds, minutes) {
  const sample = rows.map(row => {
    const outcome = {
      ...row, observedMinutes: row.minutes, minutes,
      points: Math.round(row.points * minutes / row.minutes),
      rebounds: Math.round(row.rebounds * minutes / row.minutes),
      assists: Math.round(row.assists * minutes / row.minutes)
    };
    outcome.value = COMPONENTS[market].reduce((sum, key) => sum + outcome[key], 0);
    return outcome;
  });
  const base = {
    minutes, assumption: 'USER_SUPPLIED_MINUTES',
    method: 'ROUND_EACH_PAIRED_GAME_COMPONENT_RATE_AT_FIXED_MINUTES',
    observedGameCount: rows.length, scenarioOutcomeCount: rows.length,
    simulationDrawCount: 0, calibrated: false, modelProbability: null,
    productionEligible: false, productionWeight: 0,
    explanation: 'Each game keeps its paired points, rebounds and assists. Each component is scaled to the assumed minutes and rounded before combination. This is unvalidated sensitivity, not a fitted minutes forecast.'
  };
  // Reject an entire scenario instead of clipping or dropping inconvenient tails.
  if (sample.some(row => !Number.isSafeInteger(row.value) || row.value > MAX_OUTCOME ||
    ['points', 'rebounds', 'assists'].some(key => !Number.isSafeInteger(row[key])))) {
    return { ...base, status: 'UNAVAILABLE', errors: ['SCALED_OUTCOME_OUT_OF_RANGE'],
      scenarioOutcomeCount: 0, sample: [], thresholds: [] };
  }
  return { ...base, status: 'AVAILABLE', errors: [],
    ...summarize(sample, thresholds, 'scenarioRate') };
}

/**
 * Input rows must already be matched to final source records by the caller.
 * This function checks identity, cutoffs, duplicate appearances and statistic
 * shape; it cannot establish source authenticity or current participation.
 * minutesScenarios is an array of explicit positive numbers, at most 48 minutes.
 */
export function buildNbaJointScenarios(input = {}) {
  const validRequest = input !== null && typeof input === 'object' && !Array.isArray(input);
  const { rows, target, asOf, market, thresholds, minutesScenarios = [] } = validRequest ? input : {};
  const issued = timestamp(asOf), start = timestamp(target?.startsAt);
  const supportedMarket = typeof market === 'string' && Object.hasOwn(COMPONENTS, market);
  const cleanTarget = target && typeof target === 'object' ? {
    eventID: target.eventID, playerID: target.playerID, teamId: target.teamId,
    opponentTeamId: target.opponentTeamId, startsAt: target.startsAt
  } : null;
  const result = {
    contract: 'nba-joint-scenarios-v1', modelVersion: NBA_JOINT_SCENARIOS_VERSION,
    artifactId: null, status: 'INVALID_INPUT', asOf: Number.isFinite(issued) ? new Date(issued).toISOString() : null,
    target: null, market: supportedMarket ? market : null,
    productionEligible: false, productionWeight: 0, automaticBuyEnabled: false,
    calibrated: false, modelProbability: null, errors: [],
    condition: 'POSITIVE_MINUTE_SAME_TEAM_APPEARANCES',
    limitations: [
      'Historical hit proportions are descriptive, not calibrated probabilities for the upcoming game.',
      'Current participation, rotation, matchup and injury effects are not estimated.',
      'Sample quantiles describe observed variation; they are not validated prediction or confidence intervals.',
      'Minutes scenarios are separate assumptions with no fitted scenario weights.'
    ],
    coverage: { inputRows: Array.isArray(rows) ? rows.length : 0,
      eligibleGameCount: 0, observedGameCount: 0,
      minimumGames: NBA_JOINT_SCENARIO_LIMITS.minimumGames,
      windowLimit: NBA_JOINT_SCENARIO_LIMITS.historyGames,
      excludedCount: 0, excludedCounts: {}, excludedRows: [],
      excludedRowsTruncated: false, conflictingGameIds: [] },
    historical: null, minutesScenarios: []
  };
  if (!validRequest) result.errors.push('INVALID_REQUEST');
  if (!Array.isArray(rows)) result.errors.push('ROWS_REQUIRED');
  else if (rows.length > NBA_JOINT_SCENARIO_LIMITS.inputRows) result.errors.push('INPUT_ROW_LIMIT_EXCEEDED');
  if (!cleanTarget || !['eventID', 'playerID', 'teamId', 'opponentTeamId'].every(key => identifier(cleanTarget[key])) ||
    cleanTarget.teamId === cleanTarget.opponentTeamId || !Number.isFinite(start)) result.errors.push('INVALID_TARGET');
  else result.target = { ...cleanTarget, startsAt: new Date(start).toISOString() };
  if (!Number.isFinite(issued)) result.errors.push('INVALID_AS_OF');
  if (Number.isFinite(issued) && Number.isFinite(start) && issued >= start) result.errors.push('TARGET_NOT_PREGAME');
  if (!supportedMarket) result.errors.push('UNSUPPORTED_MARKET');
  if (!Array.isArray(thresholds) || thresholds.length < 1 || thresholds.length > NBA_JOINT_SCENARIO_LIMITS.thresholds ||
    thresholds.some(item => !item || !finite(item.threshold) || item.threshold < 0 || item.threshold > MAX_OUTCOME || !DIRECTIONS.has(item.direction))) {
    result.errors.push('INVALID_THRESHOLDS');
  } else if (new Set(thresholds.map(item => JSON.stringify([item.threshold, item.direction]))).size !== thresholds.length) {
    result.errors.push('DUPLICATE_THRESHOLDS');
  }
  if (!Array.isArray(minutesScenarios) || minutesScenarios.length > NBA_JOINT_SCENARIO_LIMITS.minutesScenarios ||
    minutesScenarios.some(minutes => !finite(minutes) || minutes <= 0 || minutes > 48) ||
    new Set(minutesScenarios).size !== minutesScenarios.length) result.errors.push('INVALID_MINUTES_SCENARIOS');
  if (result.errors.length) return result;

  const excluded = new Map(), candidates = [], conflictingGameIds = new Set();
  const exclude = (index, row, reason) => excluded.set(index, {
    index, gameId: identifier(row?.gameId) ? row.gameId : null, reason
  });
  rows.forEach((raw, index) => {
    if (!raw || !['gameId', 'playerId', 'teamId'].every(key => identifier(raw[key]))) return exclude(index, raw, 'INVALID_ROW_IDENTITY');
    if (raw.playerId !== target.playerID) return exclude(index, raw, 'DIFFERENT_PLAYER');
    if (raw.teamId !== target.teamId) return exclude(index, raw, 'DIFFERENT_TEAM');
    if (raw.gameId === target.eventID) return exclude(index, raw, 'TARGET_EVENT');
    const played = timestamp(raw.startsAt), observed = timestamp(raw.observedAt);
    if (!Number.isFinite(played) || !Number.isFinite(observed)) return exclude(index, raw, 'INVALID_ROW_TIMESTAMP');
    if (played >= issued) return exclude(index, raw, 'GAME_NOT_BEFORE_CUTOFF');
    if (observed > issued) return exclude(index, raw, 'OBSERVED_AFTER_CUTOFF');
    if (observed < played) return exclude(index, raw, 'OBSERVATION_BEFORE_GAME');
    if (!finite(raw.minutes) || raw.minutes < 0 || raw.minutes > 70 ||
      ['points', 'rebounds', 'assists'].some(key => !Number.isInteger(raw[key]) || raw[key] < 0 || raw[key] > 300)) {
      return exclude(index, raw, 'INVALID_STAT_LINE');
    }
    if (raw.minutes === 0) return exclude(index, raw, 'NO_POSITIVE_MINUTES');
    candidates.push({ index, row: {
      gameId: raw.gameId, startsAt: new Date(played).toISOString(), observedAt: new Date(observed).toISOString(),
      playerId: raw.playerId, teamId: raw.teamId, minutes: raw.minutes,
      points: raw.points, rebounds: raw.rebounds, assists: raw.assists
    } });
  });

  const uniqueGames = [], conflictingAppearances = new Set();
  for (const records of groupBy(candidates, item => item.row.gameId).values()) {
    if (new Set(records.map(item => factsKey(item.row))).size > 1) {
      for (const item of records) {
        exclude(item.index, item.row, 'CONFLICTING_GAME_RECORD');
        conflictingGameIds.add(item.row.gameId);
        conflictingAppearances.add(appearanceKey(item.row));
      }
      continue;
    }
    records.sort((a, b) => a.row.observedAt.localeCompare(b.row.observedAt) || a.index - b.index);
    uniqueGames.push({ ...records[0], records });
  }
  const eligible = [];
  // A provider alias at the exact same player/team/start is one appearance.
  // Conflicting aliases are quarantined rather than averaging their statistics.
  for (const games of groupBy(uniqueGames, item => appearanceKey(item.row)).values()) {
    if (conflictingAppearances.has(appearanceKey(games[0].row)) ||
      new Set(games.map(item => factsKey(item.row))).size > 1) {
      for (const game of games) for (const item of game.records) {
        exclude(item.index, item.row, 'CONFLICTING_GAME_APPEARANCE');
        conflictingGameIds.add(item.row.gameId);
      }
      continue;
    }
    games.sort((a, b) => a.row.observedAt.localeCompare(b.row.observedAt) || a.row.gameId.localeCompare(b.row.gameId));
    const chosen = games[0]; eligible.push(chosen);
    for (const game of games) for (const item of game.records) {
      if (item.index !== chosen.index) exclude(item.index, item.row,
        game === chosen ? 'DUPLICATE_GAME_RECORD' : 'DUPLICATE_GAME_APPEARANCE');
    }
  }
  eligible.sort((a, b) => a.row.startsAt.localeCompare(b.row.startsAt) || a.row.gameId.localeCompare(b.row.gameId));
  const chosen = eligible.slice(-NBA_JOINT_SCENARIO_LIMITS.historyGames);
  for (const item of eligible.slice(0, Math.max(0, eligible.length - chosen.length))) exclude(item.index, item.row, 'OUTSIDE_HISTORY_WINDOW');
  const normalized = chosen.map(item => item.row);
  const exclusions = [...excluded.values()].sort((a, b) => a.index - b.index);
  for (const item of exclusions) result.coverage.excludedCounts[item.reason] = (result.coverage.excludedCounts[item.reason] || 0) + 1;
  Object.assign(result.coverage, {
    eligibleGameCount: eligible.length, observedGameCount: normalized.length,
    excludedCount: exclusions.length, excludedRows: exclusions.slice(0, MAX_DIAGNOSTICS),
    excludedRowsTruncated: exclusions.length > MAX_DIAGNOSTICS,
    conflictingGameIds: [...conflictingGameIds].sort()
  });
  const exactThresholds = thresholds.map(({ threshold, direction }) => ({ threshold, direction }));
  result.artifactId = hash({ modelVersion: NBA_JOINT_SCENARIOS_VERSION, target: result.target,
    asOf: result.asOf, market, thresholds: exactThresholds, minutesScenarios, rows: normalized });
  if (normalized.length < NBA_JOINT_SCENARIO_LIMITS.minimumGames) {
    result.status = 'INSUFFICIENT_HISTORY'; result.errors.push('MINIMUM_THREE_UNIQUE_GAMES_REQUIRED');
    return result;
  }
  const sample = normalized.map(row => ({ ...row,
    value: COMPONENTS[market].reduce((sum, key) => sum + row[key], 0) }));
  result.status = 'AVAILABLE';
  result.historical = {
    method: 'EQUAL_WEIGHT_PAIRED_EMPIRICAL_GAME_OUTCOMES',
    calibrated: false, modelProbability: null, simulationDrawCount: 0,
    ...summarize(sample, exactThresholds, 'historicalRate')
  };
  result.minutesScenarios = minutesScenarios.map(minutes => minutesScenario(normalized, market, exactThresholds, minutes));
  return result;
}
