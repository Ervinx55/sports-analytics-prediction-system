import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const api = await import('../../scripts/evaluation/nba-winner-validation.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

const teams = [
  {id: 2, abbreviation: 'BOS', full_name: 'Boston Celtics'},
  {id: 18, abbreviation: 'NYK', full_name: 'New York Knicks'},
  {id: 4, abbreviation: 'CHI', full_name: 'Chicago Bulls'},
  {id: 5, abbreviation: 'CLE', full_name: 'Cleveland Cavaliers'},
];
function addGame(data, id, datetime, home, away, homeScore = 100, awayScore = 90) {
  const game = {id, source: 'ESPN', season: 2024, datetime, date: datetime.slice(0, 10),
    status: 'Final', status_state: 'final', postseason: false,
    home_team: teams[home], visitor_team: teams[away],
    home_team_id: teams[home].id, visitor_team_id: teams[away].id,
    home_team_score: homeScore, visitor_team_score: awayScore};
  data.games.push(game);
  for (const [index, score] of [[home, homeScore], [away, awayScore]]) {
    data.players.push({id: `espn:${id}:${index + 1}`, source: 'ESPN', game: structuredClone(game),
      team: teams[index], player: {id: index + 1, first_name: 'Fixture', last_name: String(index), position: 'G'},
      min: '48', pts: score, fgm: (score - 10) / 2, fga: 90, fg3m: 0, fg3a: 20,
      ftm: 10, fta: 12, oreb: 10, dreb: 30, reb: 40, ast: 20, turnover: 10, stl: 5, blk: 5});
  }
}
function fixture() {
  const data = {games: [], players: []};
  for (let i = 0; i < 5; i++) {
    const day = String(i + 20).padStart(2, '0');
    addGame(data, 100 + 2 * i, `2024-12-${day}T23:00:00.000Z`, 0, 1);
    addGame(data, 101 + 2 * i, `2024-12-${day}T23:00:00.000Z`, 2, 3);
  }
  addGame(data, 200, '2024-12-26T23:00:00.000Z', 1, 3);
  addGame(data, 201, '2024-12-27T02:00:00.000Z', 0, 2);
  return data;
}
function requireApi(name) {
  assert.equal(typeof api[name], 'function', `Missing offline validation function ${name}`);
  return api[name];
}

test('previous Eastern slate excludes earlier games across the UTC midnight boundary', () => {
  const build = requireApi('buildCohort');
  const data = fixture();
  const row = build(data.games, data.players).rows.find(row => row.eventId === '201');
  assert.equal(row.block, '2024-12-26');
  assert.equal(row.priorGameIds.includes('200'), false);
  assert.equal(row.historyGames, 10);
  assert.equal(row.homePriorGames, 5);
  assert.equal(row.awayPriorGames, 5);
});

test('changing target and earlier same-slate outcomes cannot change target features or forecast', () => {
  const build = requireApi('buildCohort');
  const original = fixture();
  const changed = fixture();
  changed.games = changed.games.filter(game => ![200, 201].includes(game.id));
  changed.players = changed.players.filter(row => ![200, 201].includes(row.game.id));
  addGame(changed, 200, '2024-12-26T23:00:00.000Z', 1, 3, 130, 70);
  addGame(changed, 201, '2024-12-27T02:00:00.000Z', 0, 2, 70, 130);
  const select = data => build(data.games, data.players).rows.find(row => row.eventId === '201');
  const first = select(original), second = select(changed);
  assert.deepEqual(first.features, second.features);
  assert.equal(first.baseline, second.baseline);
  assert.notEqual(first.outcome, second.outcome);
});

test('input order cannot change cohort membership, feature values, or probability', () => {
  const build = requireApi('buildCohort'), data = fixture();
  assert.deepEqual(build(data.games, data.players), build([...data.games].reverse(), [...data.players].reverse()));
});

test('lagged rest and opponent-defense matchup rates match a hand-calculated asymmetric fixture', () => {
  const build = requireApi('buildCohort'), data = fixture();
  for (const id of [101, 103, 105, 107, 109]) {
    const original = data.games.find(game => game.id === id);
    data.games = data.games.filter(game => game.id !== id);
    data.players = data.players.filter(row => row.game.id !== id);
    if (id !== 109) addGame(data, id, original.datetime, 2, 3, 82, 90);
  }
  const row = build(data.games, data.players).rows.find(row => row.eventId === '201');
  // BOS last played Dec24 (one rest day), CHI Dec23 (two); five vs four games.
  assert.deepEqual(row.features.slice(0, 3), [-.25, 0, -.25]);
  // BOS eFG=.5; CHI eFG=.4; both opponents allow equal eFG. Expected gap=.05.
  assert.ok(Math.abs(row.features[3] - .5) < 1e-12);
  for (const value of row.features.slice(4)) assert.ok(Math.abs(value) < 1e-12);
});

test('duplicate event and player-game rows fail closed instead of inflating evidence', () => {
  const validate = requireApi('validateInputs'), data = fixture();
  assert.throws(() => validate([...data.games, data.games[0]], data.players), /duplicate.*game/i);
  assert.throws(() => validate(data.games, [...data.players, data.players[0]]), /duplicate.*player/i);
});

test('wrong seasons, conflicting nested identities, and score-sum failures reject the archive', () => {
  const validate = requireApi('validateInputs');
  const wrongSeason = fixture(); wrongSeason.games[0].season = 2025;
  assert.throws(() => validate(wrongSeason.games, wrongSeason.players), /season/i);
  const wrongIdentity = fixture(); wrongIdentity.players[0].game.home_team_id = 99;
  assert.throws(() => validate(wrongIdentity.games, wrongIdentity.players), /identity/i);
  const wrongScore = fixture(); wrongScore.players[0].pts += 1;
  assert.throws(() => validate(wrongScore.games, wrongScore.players), /score|points/i);
});

test('history older than 21 Eastern calendar days cannot make a forecast eligible', () => {
  const build = requireApi('buildCohort'), data = fixture();
  addGame(data, 300, '2025-02-01T23:00:00.000Z', 0, 2);
  const result = build(data.games, data.players);
  assert.equal(result.rows.some(row => row.eventId === '300'), false);
  assert.equal(result.exclusions.find(row => row.eventId === '300').reason, 'INSUFFICIENT_PRIOR_HISTORY');
});

test('future outcomes cannot affect coefficients and all candidate arms retain identical game identities', () => {
  const fit = requireApi('fitModels'), predict = requireApi('applyModels');
  const rows = [
    {eventId: '1', block: '2024-12-01', baseline: .5, outcome: 1, features: [1, 0, 0, 0, 0, 0, 0]},
    {eventId: '2', block: '2024-12-02', baseline: .5, outcome: 0, features: [-1, 0, 0, 0, 0, 0, 0]},
    {eventId: '3', block: '2025-02-02', baseline: .5, outcome: 0, features: [1, 0, 0, 0, 0, 0, 0]},
  ];
  const fitted = fit(rows);
  const changed = structuredClone(rows); changed[2].outcome = 1;
  assert.deepEqual(fitted, fit(changed));
  const predicted = predict(rows, fitted);
  assert.deepEqual(predicted.map(row => row.eventId), ['1', '2', '3']);
  assert.ok(predicted[0].rest > .5);
  for (const row of predicted) for (const key of ['baseline', 'rest', 'defense', 'both']) {
    assert.ok(Number.isFinite(row[key]) && row[key] > 0 && row[key] < 1);
  }
  assert.equal(fitted.trainingGames, 2);
});

test('artifact saving cannot overwrite a frozen prior experiment', () => {
  const save = requireApi('saveExperiment');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nba-winner-validation-'));
  try {
    const output = path.join(directory, 'run');
    save(output, {protocol: {id: 'fixture'}, report: {productionEligible: false}, predictions: []});
    const before = fs.readFileSync(path.join(output, 'report.json'), 'utf8');
    assert.throws(() => save(output, {protocol: {}, report: {changed: true}, predictions: []}), /exist|overwrite/i);
    assert.equal(fs.readFileSync(path.join(output, 'report.json'), 'utf8'), before);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
