import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {projectNbaGames, NBA_BASELINE_VERSION} from '../../sharp-service/lib/nba-vnext-baseline.js';
import {metrics, pairedBlockBootstrap} from './winner-validation-metrics.mjs';

// Offline development experiment only. No network requests, production writes,
// incumbent coefficient changes, or use of actual target-game participation.
export const PROTOCOL = Object.freeze({
  id: 'nba-winner-rest-defense-development-2026-11-17-v1',
  season: 2024,
  historyCalendarDays: 21,
  minimumPriorGamesPerTeam: 4,
  timeZone: 'America/New_York',
  trainThrough: '2024-12-31',
  diagnosticFrom: '2025-01-01', diagnosticThrough: '2025-01-31',
  evaluationFrom: '2025-02-01', evaluationThrough: '2025-04-13',
  evaluationStatus: 'REUSED_DEVELOPMENT_NOT_UNTOUCHED_HOLDOUT',
  baseline: NBA_BASELINE_VERSION,
  fit: {family: 'logistic_offset', intercept: false, penalty: '0.5 * lambda * sum(beta^2)',
    lambda: 0.05, learningRate: 0.05, iterations: 2000, initialCoefficients: 0,
    objective: 'mean Bernoulli log loss plus L2 penalty', tuning: false},
  features: [
    'home_minus_away_rest_days_clipped_4_divided_4',
    'away_minus_home_back_to_back',
    'away_minus_home_games_previous_7_calendar_days_divided_4',
    'home_minus_away_expected_efg_divided_0.10',
    'home_minus_away_expected_turnover_rate_divided_0.10',
    'home_minus_away_expected_offensive_rebound_rate_divided_0.10',
    'home_minus_away_expected_free_throw_attempt_rate_divided_0.10',
  ],
  matchupFormula: 'Expected rate = mean(team prior offense rate, opponent prior allowed rate). Rates pool prior 21 Eastern slates; no current slate.',
  rateDefinitions: {
    efg: '(FGM + 0.5 * 3PM) / FGA',
    turnover: 'TO / (FGA + 0.44 * FTA + TO)',
    offensiveRebound: 'ORB / (ORB + opponent DRB)',
    freeThrowAttempt: 'FTA / FGA',
  },
  comparison: 'Same eligible event cohort for baseline, rest, defense, both. No selection based on later results.',
  uncertainty: {unit: 'Eastern slate day', iterations: 2000, seed: 20261117,
    interpretation: 'Descriptive paired day-block intervals; not a promotion or multiplicity-adjusted confirmation test.'},
  lineup: 'UNAVAILABLE: no historical publication-time availability, starting lineup, or roster snapshots; no lineup candidate fitted.',
  productionEligible: false, productionWeight: 0, automaticBuyEnabled: false,
});

const PINNED_HASHES = Object.freeze({
  'games.json': 'd6f710ae1f196d7010506fb5205a5940a00577b606c8da40e7906d5a860c2a0a',
  'player-stats.json': '6b1aefaa4721c6f7eb3f04d80f3783f0af8f1b1492a0154b445186c1d7c6fa54',
});
const ARMS = Object.freeze({rest: [0, 1, 2], defense: [3, 4, 5, 6], both: [0, 1, 2, 3, 4, 5, 6]});
const STATS = ['pts', 'reb', 'ast', 'turnover', 'stl', 'blk', 'oreb', 'dreb', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta'];
const GAME_FIELDS = ['id', 'season', 'datetime', 'date', 'home_team_id', 'visitor_team_id',
  'home_team_score', 'visitor_team_score', 'status', 'status_state', 'postseason'];
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PROTOCOL.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalBytes = value => JSON.stringify(value, null, 2) + '\n';
const day = timestamp => formatter.format(new Date(timestamp));
const dayDistance = (later, earlier) => (Date.parse(later) - Date.parse(earlier)) / 86400000;
const teamKey = (gameId, teamId) => `${gameId}:${teamId}`;
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const sigmoid = value => 1 / (1 + Math.exp(-value));
const logit = probability => Math.log(probability / (1 - probability));
const sameTeam = (left, right) => left?.id === right?.id && left?.abbreviation === right?.abbreviation && left?.full_name === right?.full_name;
const validTeam = (team, id) => team?.id === id && /^[A-Z]{2,3}$/.test(team?.abbreviation || '') && typeof team?.full_name === 'string' && team.full_name.trim();

export function validateInputs(games, players) {
  if (!Array.isArray(games) || !games.length || !Array.isArray(players) || !players.length) throw Error('Missing game/player archive');
  const byId = new Map(), box = new Map(), seenPlayers = new Set();
  for (const game of games) {
    if (byId.has(game?.id)) throw Error(`Duplicate game identity: ${game?.id}`);
    if (game?.season !== PROTOCOL.season) throw Error('Wrong season: only previously inspected 2024 development is accepted');
    const at = Date.parse(game.datetime);
    if (!positiveId(game.id) || !Number.isFinite(at) || game.date !== new Date(at).toISOString().slice(0, 10) ||
        ![2024, 2025].includes(new Date(at).getUTCFullYear()) || game.status !== 'Final' || game.status_state !== 'final' || game.postseason !== false ||
        !positiveId(game.home_team_id) || !positiveId(game.visitor_team_id) || game.home_team_id === game.visitor_team_id ||
        !validTeam(game.home_team, game.home_team_id) || !validTeam(game.visitor_team, game.visitor_team_id) ||
        game.home_team.abbreviation === game.visitor_team.abbreviation ||
        ![game.home_team_score, game.visitor_team_score].every(score => Number.isInteger(score) && score >= 0 && score <= 250) ||
        game.home_team_score === game.visitor_team_score) throw Error(`Invalid final game identity, chronology, or score: ${game.id}`);
    byId.set(game.id, game);
  }
  for (const row of players) {
    const game = byId.get(row?.game?.id);
    if (!game || !positiveId(row?.player?.id)) throw Error('Invalid player game identity');
    const key = `${game.id}:${row.player.id}`;
    if (seenPlayers.has(key)) throw Error(`Duplicate player-game identity: ${key}`);
    seenPlayers.add(key);
    const expectedTeam = row.team?.id === game.home_team_id ? game.home_team : row.team?.id === game.visitor_team_id ? game.visitor_team : null;
    if (!expectedTeam || !sameTeam(row.team, expectedTeam) || GAME_FIELDS.some(field => row.game[field] !== game[field]) ||
        !sameTeam(row.game.home_team, game.home_team) || !sameTeam(row.game.visitor_team, game.visitor_team)) throw Error(`Conflicting nested player/game identity: ${key}`);
    const minutes = typeof row.min === 'number' ? row.min : typeof row.min === 'string' && /^\d+(?:\.\d+)?$/.test(row.min) ? Number(row.min) : NaN;
    if (!Number.isFinite(minutes) || minutes < 0 || STATS.some(stat => !Number.isInteger(row[stat]) || row[stat] < 0) ||
        row.fgm > row.fga || row.fg3m > row.fg3a || row.fg3m > row.fgm || row.fg3a > row.fga || row.ftm > row.fta ||
        row.pts !== 2 * row.fgm + row.fg3m + row.ftm) throw Error(`Invalid numeric boxscore or points: ${key}`);
    const aggregateKey = teamKey(game.id, row.team.id);
    if (!box.has(aggregateKey)) box.set(aggregateKey, Object.fromEntries(STATS.map(stat => [stat, 0])));
    const aggregate = box.get(aggregateKey);
    for (const stat of STATS) aggregate[stat] += row[stat];
  }
  for (const game of games) for (const side of ['home', 'visitor']) {
    const total = box.get(teamKey(game.id, game[`${side}_team_id`]));
    if (!total || total.pts !== game[`${side}_team_score`]) throw Error(`Player-summed team score mismatch: ${game.id} ${side}`);
  }
  return {games: [...games].sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime) || a.id - b.id), box};
}

function scoreboard(game) {
  return {eventId: String(game.id), startsAt: game.datetime, home: game.home_team.abbreviation,
    away: game.visitor_team.abbreviation, homeScore: game.home_team_score, awayScore: game.visitor_team_score, completed: true};
}
function rates(own, opponent) {
  const denominators = [own.fga, own.fga + .44 * own.fta + own.turnover, own.oreb + opponent.dreb, own.fga];
  if (denominators.some(value => !(value > 0))) return null;
  return [(own.fgm + .5 * own.fg3m) / denominators[0], own.turnover / denominators[1],
    own.oreb / denominators[2], own.fta / denominators[3]];
}
function teamContext(prior, teamId, targetDay, box) {
  const history = prior.filter(game => game.home_team_id === teamId || game.visitor_team_id === teamId);
  const own = Object.fromEntries(STATS.map(stat => [stat, 0])), opponent = {...own};
  for (const game of history) {
    const otherId = game.home_team_id === teamId ? game.visitor_team_id : game.home_team_id;
    for (const stat of STATS) {
      own[stat] += box.get(teamKey(game.id, teamId))[stat];
      opponent[stat] += box.get(teamKey(game.id, otherId))[stat];
    }
  }
  const lastDay = history.length ? day(history.at(-1).datetime) : null;
  const restDays = lastDay ? Math.max(0, dayDistance(targetDay, lastDay) - 1) : null;
  return {games: history.length, restDays, backToBack: restDays === 0 ? 1 : 0,
    lastGameDay: lastDay, gamesPrevious7Days: history.filter(game => dayDistance(targetDay, day(game.datetime)) <= 7).length,
    offense: rates(own, opponent), defense: rates(opponent, own)};
}

export function buildCohort(games, players) {
  const validated = validateInputs(games, players), rows = [], exclusions = [];
  const dated = validated.games.map(game => ({...game, slate: day(game.datetime)}));
  let cachedDay = null, prior = null;
  for (const target of dated) {
    if (target.slate !== cachedDay) {
      cachedDay = target.slate;
      prior = dated.filter(game => game.slate < target.slate && dayDistance(target.slate, game.slate) <= PROTOCOL.historyCalendarDays);
    }
    const home = teamContext(prior, target.home_team_id, target.slate, validated.box);
    const away = teamContext(prior, target.visitor_team_id, target.slate, validated.box);
    if (Math.min(home.games, away.games) < PROTOCOL.minimumPriorGamesPerTeam) {
      exclusions.push({eventId: String(target.id), block: target.slate, reason: 'INSUFFICIENT_PRIOR_HISTORY', homePriorGames: home.games, awayPriorGames: away.games});
      continue;
    }
    if (![home.offense, home.defense, away.offense, away.defense].every(Boolean)) {
      exclusions.push({eventId: String(target.id), block: target.slate, reason: 'INVALID_DEFENSE_DENOMINATOR'});
      continue;
    }
    const forecastAt = new Date(Date.parse(target.datetime) - 1).toISOString();
    const prediction = projectNbaGames({historicalGames: prior.map(scoreboard), upcomingGames: [{...scoreboard(target), completed: false}],
      asOf: forecastAt, historyComplete: true}).rows?.[0];
    if (!Number.isFinite(prediction?.homeWinProbability)) throw Error(`Reference unexpectedly unavailable: ${target.id}`);
    const restFeatures = [(Math.min(home.restDays, 4) - Math.min(away.restDays, 4)) / 4,
      away.backToBack - home.backToBack, (away.gamesPrevious7Days - home.gamesPrevious7Days) / 4];
    const defenseFeatures = home.offense.map((value, i) => ((value + away.defense[i]) / 2 - (away.offense[i] + home.defense[i]) / 2) / .10);
    rows.push({eventId: String(target.id), block: target.slate, startsAt: target.datetime, forecastAt,
      home: target.home_team.abbreviation, away: target.visitor_team.abbreviation,
      outcome: target.home_team_score > target.visitor_team_score ? 1 : 0,
      baseline: prediction.homeWinProbability, projectedHomeMargin: prediction.projectedHomeMargin,
      historyGames: prior.length, homePriorGames: home.games, awayPriorGames: away.games,
      priorGameIds: prior.map(game => String(game.id)), features: [...restFeatures, ...defenseFeatures],
      restContext: {home: {restDays: home.restDays, lastGameDay: home.lastGameDay, gamesPrevious7Days: home.gamesPrevious7Days},
        away: {restDays: away.restDays, lastGameDay: away.lastGameDay, gamesPrevious7Days: away.gamesPrevious7Days}},
      lineupAvailable: false});
  }
  return {rows, exclusions, archiveGames: dated.length};
}

function validateFeatureRow(row) {
  if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.block) || ![0, 1].includes(row.outcome) ||
      !(row.baseline > 0 && row.baseline < 1) || row.features?.length !== PROTOCOL.features.length ||
      !row.features.every(Number.isFinite)) throw Error('Invalid model feature row');
}
export function fitModels(rows) {
  rows.forEach(validateFeatureRow);
  const training = rows.filter(row => row.block <= PROTOCOL.trainThrough);
  if (!training.length) throw Error('No predeclared training games');
  if (new Set(training.map(row => row.eventId)).size !== training.length) throw Error('Duplicate training game');
  const models = {};
  for (const [arm, indices] of Object.entries(ARMS)) {
    const coefficients = indices.map(() => 0);
    const prepared = training.map(row => ({offset: logit(row.baseline), y: row.outcome, x: indices.map(index => row.features[index])}));
    let maxGradient = null;
    for (let step = 0; step < PROTOCOL.fit.iterations; step++) {
      const gradient = coefficients.map(value => PROTOCOL.fit.lambda * value);
      for (const row of prepared) {
        const p = sigmoid(row.offset + coefficients.reduce((sum, value, i) => sum + value * row.x[i], 0));
        for (let i = 0; i < coefficients.length; i++) gradient[i] += (p - row.y) * row.x[i] / prepared.length;
      }
      maxGradient = Math.max(...gradient.map(Math.abs));
      for (let i = 0; i < coefficients.length; i++) coefficients[i] -= PROTOCOL.fit.learningRate * gradient[i];
    }
    if (!coefficients.every(Number.isFinite)) throw Error(`Nonfinite fitted coefficients: ${arm}`);
    models[arm] = {featureIndices: indices, coefficients, finalIterationMaxGradient: maxGradient};
  }
  return {trainingGames: training.length, trainThrough: PROTOCOL.trainThrough, fit: PROTOCOL.fit, models};
}
export function applyModels(rows, fitted) {
  return rows.map(row => {
    validateFeatureRow(row);
    const result = {...row};
    for (const [arm, model] of Object.entries(fitted.models)) {
      const adjustment = model.coefficients.reduce((sum, value, i) => sum + value * row.features[model.featureIndices[i]], 0);
      result[arm] = Math.max(.000001, Math.min(.999999, sigmoid(logit(row.baseline) + adjustment)));
    }
    return result;
  });
}
function summarize(rows) {
  const modelMetrics = Object.fromEntries(['baseline', ...Object.keys(ARMS)].map(arm => [arm,
    metrics(rows.map(row => ({probability: row[arm], outcome: row.outcome})))]));
  const paired = rows.length ? Object.fromEntries(Object.keys(ARMS).map(arm => [arm,
    pairedBlockBootstrap(rows, arm, 'baseline', {iterations: PROTOCOL.uncertainty.iterations, seed: PROTOCOL.uncertainty.seed})])) : {};
  return {games: rows.length, days: new Set(rows.map(row => row.block)).size,
    firstDay: rows[0]?.block ?? null, lastDay: rows.at(-1)?.block ?? null, metrics: modelMetrics, paired};
}
export function runExperiment(games, players) {
  const cohort = buildCohort(games, players), fitted = fitModels(cohort.rows), predictions = applyModels(cohort.rows, fitted);
  const training = predictions.filter(row => row.block <= PROTOCOL.trainThrough);
  const january = predictions.filter(row => row.block >= PROTOCOL.diagnosticFrom && row.block <= PROTOCOL.diagnosticThrough);
  const later = predictions.filter(row => row.block >= PROTOCOL.evaluationFrom && row.block <= PROTOCOL.evaluationThrough);
  const report = {
    protocolId: PROTOCOL.id, evaluationStatus: PROTOCOL.evaluationStatus,
    productionEligible: false, productionWeight: 0, automaticBuyEnabled: false,
    coverage: {archiveGames: games.length, archivePlayerRows: players.length, eligibleGames: predictions.length,
      exclusions: cohort.exclusions.length, exclusionCounts: Object.fromEntries([...new Set(cohort.exclusions.map(row => row.reason))].map(reason =>
        [reason, cohort.exclusions.filter(row => row.reason === reason).length])),
      historicalTimestampedLineups: 0, lineupAblation: 'NOT_EVALUABLE',
      historicalMatchedPricePairs: 0, marketRelativeValidation: 'NOT_EVALUABLE',
      untouchedConfirmationGames: 0},
    fitted, coefficientsSha256: sha256(canonicalBytes(fitted)),
    training: summarize(training), januaryDiagnostics: summarize(january), laterDevelopment: summarize(later),
    limitations: [
      'Both chronological portions are previously inspected development. Neither is an untouched confirmation cohort.',
      'Final boxscores were downloaded retrospectively and have no result-publication timestamps. Previous Eastern slates are a conservative replay proxy, not proof of contemporaneous receipt.',
      'Player-summed boxes omit unassigned team rebounds and team-only turnovers. These are box-derived team matchup proxies, not exact official team rates or player-position defense claims.',
      'Historical injury publication, final active lists and starting lineups are unavailable. Target-game participants never supply features.',
      'No historical same-time two-sided market prices are supplied: no market-edge, ROI or wager-clearance conclusion.',
      'Day-block bootstrap does not fully model dependence from overlapping team histories. Intervals are descriptive.',
    ],
  };
  return {protocol: PROTOCOL, report, predictions, exclusions: cohort.exclusions};
}

export function saveExperiment(outputDirectory, experiment) {
  if (fs.existsSync(outputDirectory)) throw Error('Experiment output already exists; refusing overwrite');
  fs.mkdirSync(path.dirname(path.resolve(outputDirectory)), {recursive: true});
  fs.mkdirSync(outputDirectory);
  for (const [name, value] of Object.entries(experiment)) {
    fs.writeFileSync(path.join(outputDirectory, `${name}.json`), canonicalBytes(value), {encoding: 'utf8', flag: 'wx'});
  }
}
export function loadPinnedArchive(sourceDirectory) {
  const sourceHashes = {}, parsed = {};
  for (const [name, expected] of Object.entries(PINNED_HASHES)) {
    const bytes = fs.readFileSync(path.join(sourceDirectory, name));
    const actual = sha256(bytes);
    if (actual !== expected) throw Error(`Source hash mismatch: ${name}`);
    sourceHashes[name] = actual; parsed[name] = JSON.parse(bytes);
  }
  const games = parsed['games.json'], players = parsed['player-stats.json'];
  if (games.length !== 1230 || players.length !== 26306) throw Error('Incomplete pinned development archive');
  return {games, players, sourceHashes};
}
function fileHash(relative) {
  return sha256(fs.readFileSync(new URL(relative, import.meta.url)));
}
async function main() {
  const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const source = option('source'), output = option('output');
  if (!source || !output) throw Error('Required: --source=PINNED_ARCHIVE_DIRECTORY --output=NEW_EXPERIMENT_DIRECTORY');
  const input = loadPinnedArchive(source);
  const provenance = {sourceDirectory: path.resolve(source), sourceHashes: input.sourceHashes,
    implementationSha256: fileHash('./nba-winner-validation.mjs'),
    metricsSha256: fileHash('./winner-validation-metrics.mjs'),
    baselineSha256: fileHash('../../sharp-service/lib/nba-vnext-baseline.js'),
    predeclaredProtocolSha256: fileHash('../../docs/evaluations/winner-validation-2026-11-17/protocol.md')};
  // Reserve output and record all choices before constructing forecasts or fitting.
  saveExperiment(output, {protocol: {...PROTOCOL, frozenAt: new Date().toISOString(), provenance}});
  const result = runExperiment(input.games, input.players);
  result.report.provenance = provenance;
  for (const name of ['report', 'predictions', 'exclusions']) fs.writeFileSync(path.join(output, `${name}.json`), canonicalBytes(result[name]), {encoding: 'utf8', flag: 'wx'});
  console.log(JSON.stringify({output: path.resolve(output), coverage: result.report.coverage,
    laterDevelopment: result.report.laterDevelopment, productionEligible: false}, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
