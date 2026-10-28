import { normalizeTeam } from './nfl-model.js';

export const NFL_PROP_CONTEXT_VERSION = 'nfl-prop-context-v1';
const METRICS = {
  passing_yards: ['passing_yards', 'attempts'],
  passing_touchdowns: ['passing_tds', 'attempts'],
  rushing_yards: ['rushing_yards', 'carries'],
  receiving_receptions: ['receptions', 'targets'],
  receiving_yards: ['receiving_yards', 'targets']
};
const numeric = value => value === null || value === undefined || String(value).trim() === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const teamOf = row => normalizeTeam(row.team || row.recent_team);
const sum = (rows, key) => rows.length && rows.every(row => numeric(row[key]) !== null) ? rows.reduce((n, row) => n + numeric(row[key]), 0) : null;

// Explanatory evidence only. Unknown publication times cannot certify a retrospective
// forecast. No weights, probability mapping or adjustment to the v2.1 control.
export function buildNflPropContext({ schedule = [], playerStats = [], season, cutoff, team, opponent, observedAt = null, windowGames = 5 } = {}) {
  team = normalizeTeam(team);
  opponent = normalizeTeam(opponent);
  const boundary = time(cutoff);
  const window = Math.max(1, Math.min(17, Number(windowGames) || 5));
  // Exact repeats are harmless; conflicting corrections have no trustworthy
  // ordering without archived publication timestamps, so exclude the identity.
  const gameVersions = new Map();
  const conflictingGames = new Set();
  for (const game of schedule) {
    const signature = JSON.stringify(game);
    if (gameVersions.has(game.game_id) && gameVersions.get(game.game_id) !== signature) conflictingGames.add(game.game_id);
    gameVersions.set(game.game_id, signature);
  }
  const seenGames = new Set();
  const games = schedule.filter(game => {
    if (!game.game_id || conflictingGames.has(game.game_id) || seenGames.has(game.game_id)) return false;
    seenGames.add(game.game_id);
    // Scores certify a final result in nflverse schedules. Use explicit completion
    // if supplied; otherwise conservatively exclude the entire gameday (UTC).
    const completed = time(game.completedAt || game.completed_at) ?? (time(`${game.gameday}T00:00:00Z`) === null ? null : time(`${game.gameday}T00:00:00Z`) + 86400000);
    const published = time(game.availableAt || game.available_at);
    return boundary !== null && completed !== null && completed < boundary &&
      (!game.status || ['final', 'completed', 'STATUS_FINAL'].includes(game.status)) &&
      (published === null || published < boundary) &&
      numeric(game.season) === Number(season) && game.game_type === 'REG' &&
      numeric(game.home_score) !== null && numeric(game.away_score) !== null;
  }).sort((a, b) => String(b.gameday).localeCompare(String(a.gameday)));
  const byId = new Map(games.map(game => [game.game_id, game]));
  const byWeekTeam = new Map();
  for (const game of games) for (const side of [game.home_team, game.away_team]) {
    const key = `${game.season}:${game.week}:${normalizeTeam(side)}`;
    byWeekTeam.set(key, byWeekTeam.has(key) ? null : game);
  }
  const seenRows = new Map();
  const conflictingRows = new Set();
  let rows = [];
  for (const row of playerStats) {
    const rowTeam = teamOf(row);
    const game = row.game_id ? byId.get(row.game_id) : byWeekTeam.get(`${row.season}:${row.week}:${rowTeam}`);
    const id = row.player_id || row.player_gsis_id || row.gsis_id;
    if (!game || !id || ![normalizeTeam(game.home_team), normalizeTeam(game.away_team)].includes(rowTeam)) continue;
    if (numeric(row.season) !== Number(season) || (row.season_type && row.season_type !== 'REG')) continue;
    const published = time(row.availableAt || row.available_at);
    if (published !== null && published >= boundary) continue;
    const key = `${game.game_id}:${id}`;
    const signature = JSON.stringify(row);
    if (seenRows.has(key)) {
      if (seenRows.get(key) !== signature) conflictingRows.add(key);
      continue;
    }
    seenRows.set(key, signature);
    rows.push({ ...row, contextIdentity: key, gameId: game.game_id, historicalTeam: rowTeam });
  }
  rows = rows.filter(row => !conflictingRows.has(row.contextIdentity));
  const rowsByGame = new Map();
  for (const row of rows) {
    if (!rowsByGame.has(row.gameId)) rowsByGame.set(row.gameId, []);
    rowsByGame.get(row.gameId).push(row);
  }
  const forTeam = club => games.filter(g => [normalizeTeam(g.home_team), normalizeTeam(g.away_team)].includes(club)).slice(0, window);
  const envelope = (value, selected, evidence = [], missingReason = 'No eligible completed games with complete required fields', source = 'nflverse_player_stats+nflverse_schedules') => ({
    value, status: value === null ? 'unavailable' : 'exploratory', source, observedAt,
    availableAt: null, cutoff, season: Number(season), window: { gameType: 'REG', lastGames: window },
    sampleCount: selected.length, gameIds: selected.map(g => g.game_id),
    historicalAvailabilityVerified: false,
    availabilityReason: 'Historical source publication and correction times are not archived',
    missingReason: value === null ? missingReason : null,
    rank: null, rankMissingReason: 'Complete eligible league comparison coverage is not verified',
    observationCount: evidence.length
  });
  const ownGames = forTeam(team);
  const wins = ownGames.map(g => { const home = normalizeTeam(g.home_team) === team; const delta = numeric(home ? g.home_score : g.away_score) - numeric(home ? g.away_score : g.home_score); return delta === 0 ? 0.5 : delta > 0 ? 1 : 0; });
  const teamForm = envelope(wins.length ? wins.reduce((a,b) => a+b,0)/wins.length : null, ownGames, [], undefined, 'nflverse_schedules');
  teamForm.metric = 'win_rate_ties_half';
  function efficiency(club, defense) {
    const selected = [], evidence = []; let epa = 0, plays = 0;
    for (const game of forTeam(club)) {
      const gameRows = (rowsByGame.get(game.game_id) || []).filter(r => defense ? r.historicalTeam !== club : r.historicalTeam === club);
      const totals = ['attempts', 'carries', 'passing_epa', 'rushing_epa'].map(key => sum(gameRows, key));
      if (totals.some(v => v === null) || totals[0] + totals[1] <= 0) continue;
      selected.push(game); evidence.push(...gameRows); plays += totals[0] + totals[1]; epa += totals[2] + totals[3];
    }
    return { ...envelope(plays ? epa / plays : null, selected, evidence), metric: 'player_epa_per_attempt_or_carry', denominator: 'attempts+carries', coverageReason: 'Player-stat proxy; excludes sacks and unrecorded plays; full team coverage not certified' };
  }
  const opponentAllowanceByPosition = {};
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    opponentAllowanceByPosition[position] = {};
    for (const [market, [stat, opportunity]] of Object.entries(METRICS)) {
      const selected = [], evidence = [], adjustedGames = []; let total = 0, adjustedTotal = 0, opportunities = 0;
      for (const game of forTeam(opponent)) {
        const gameRows = (rowsByGame.get(game.game_id) || []).filter(r => r.historicalTeam !== opponent && r.position === position);
        const value = sum(gameRows, stat), denominator = sum(gameRows, opportunity);
        if (value === null) continue;
        selected.push(game); evidence.push(...gameRows); total += value;
        if (denominator !== null && denominator > 0) { adjustedGames.push(game); adjustedTotal += value; opportunities += denominator; }
      }
      opponentAllowanceByPosition[position][market] = {
        ...envelope(selected.length ? total / selected.length : null, selected, evidence),
        metric: `${stat}_per_observed_position_game`, position,
        coverageReason: 'Historical position proxy; missing position/game observations excluded, never assumed zero; full roster coverage not certified',
        perOpportunity: { ...envelope(opportunities ? adjustedTotal / opportunities : null, adjustedGames), denominator: opportunity, opportunityCount: opportunities }
      };
    }
  }
  return { version: NFL_PROP_CONTEXT_VERSION, status: 'exploratory', productionWeight: 0, productionEligible: false, cutoff, season: Number(season), team, opponent,
    teamForm, offense: efficiency(team, false), defense: efficiency(team, true), opponentDefense: efficiency(opponent, true), opponentAllowanceByPosition,
    adjustedProjection: null, adjustmentMissingReason: 'Context coefficients have not been fitted and validated; existing control projection is unchanged' };
}
