import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNflPropContext } from '../../sharp-service/lib/nfl-prop-context.js';
const game = (id, date, extra = {}) => ({ game_id: id, season: 2026, week: Number(id), game_type: 'REG', gameday: date, home_team: 'GB', away_team: 'CHI', home_score: 21, away_score: 14, ...extra });
const row = (id, extra = {}) => ({ game_id: id, season: 2026, week: Number(id), season_type: 'REG', team: 'CHI', player_id: 'p1', position: 'WR', targets: 10, receptions: 6, receiving_yards: 80, attempts: 0, passing_yards: 0, passing_tds: 0, passing_epa: 0, carries: 0, rushing_yards: 0, rushing_epa: 0, ...extra });
const build = (extra = {}) => buildNflPropContext({ schedule: [game('1', '2026-09-10')], playerStats: [row('1')], season: 2026, cutoff: '2026-09-20T18:00:00Z', team: 'CHI', opponent: 'GB', ...extra });
test('specific historical position allowances preserve raw and opportunity-adjusted evidence', () => {
 const r = build();
 assert.equal(r.opponentAllowanceByPosition.WR.receiving_yards.value, 80);
 assert.equal(r.opponentAllowanceByPosition.WR.receiving_yards.perOpportunity.value, 8);
 assert.equal(r.opponentAllowanceByPosition.RB.receiving_yards.value, null);
 assert.equal(r.teamForm.value, 0);
 assert.equal(r.productionWeight, 0);
 assert.equal(r.teamForm.rank, null);
 assert.equal(r.teamForm.historicalAvailabilityVerified, false);
});
test('rejects target date, future, unfinished and other-season games; deduplicates players', () => {
 const r = build({ schedule: [game('1', '2026-09-10'), game('2', '2026-09-20'), game('3', '2026-09-11', { home_score: '' }), game('4', '2026-09-12', { season: 2025 })], playerStats: [row('1'), row('1'), row('2'), row('3'), row('4')] });
 assert.equal(r.opponentAllowanceByPosition.WR.receiving_yards.value, 80);
 assert.equal(r.opponentAllowanceByPosition.WR.receiving_yards.sampleCount, 1);
 assert.equal(r.teamForm.sampleCount, 1);
});
test('missing stat, position and future availability never become zero evidence', () => {
 for (const extra of [{ receiving_yards: '' }, { position: '' }, { availableAt: '2026-09-21T00:00:00Z' }]) assert.equal(build({ playerStats: [row('1', extra)] }).opponentAllowanceByPosition.WR.receiving_yards.value, null);
});
test('EPA efficiency uses attempts and carries and historical team membership', () => {
 const r = build({ playerStats: [row('1', { player_id: 'qb', position: 'QB', attempts: 30, passing_yards: 210, passing_epa: 6, carries: 5, rushing_yards: 25, rushing_epa: 1 }), row('1', { player_id: 'rb', position: 'RB', carries: 15, rushing_yards: 75, rushing_epa: 3 })] });
 assert.equal(r.offense.value, 0.2);
 assert.equal(r.opponentAllowanceByPosition.QB.passing_yards.perOpportunity.value, 7);
});

test('ambiguous corrected duplicates and post-cutoff schedule publications are excluded', () => {
 assert.equal(build({ schedule: [game('1', '2026-09-10', { availableAt: '2026-09-21T00:00:00Z' })] }).teamForm.value, null);
 assert.equal(build({ playerStats: [row('1'), row('1', { receiving_yards: 99 })] }).opponentAllowanceByPosition.WR.receiving_yards.value, null);
 assert.equal(build({ schedule: [game('1', '2026-09-10'), game('1', '2026-09-10', { home_score: 7 })] }).teamForm.value, null);
});
test('weekly source joins require unambiguous team-season-week and regular season', () => {
 const weekly = row('1'); delete weekly.game_id;
 assert.equal(build({ playerStats: [weekly] }).opponentAllowanceByPosition.WR.receiving_yards.value, 80);
 assert.equal(build({ playerStats: [row('1', { season_type: 'POST' })] }).opponentAllowanceByPosition.WR.receiving_yards.value, null);
 assert.equal(build({ schedule: [game('1', '2026-09-10', { status: 'postponed' })] }).teamForm.value, null);
});

test('live-source blank EPA on verified nonparticipants does not erase team efficiency', () => {
 const liveRows = [
  row('1', { player_id: 'te', position: 'TE', attempts: '0', carries: '0', passing_epa: '', rushing_epa: '' }),
  row('1', { player_id: 'rb', position: 'RB', attempts: '0', carries: '11', passing_epa: '', rushing_epa: '-1.6957' }),
  row('1', { player_id: 'qb', position: 'QB', attempts: '45', carries: '0', passing_epa: '6.9249', rushing_epa: '' })
 ];
 const r = build({ playerStats: liveRows });
 assert.equal(r.offense.value, (6.9249 - 1.6957) / 56);
 assert.equal(r.opponentDefense.value, r.offense.value);
 assert.equal(r.offense.sampleCount, 1);
 for (const [index, extra] of [[2, { passing_epa: '' }], [1, { rushing_epa: '' }], [0, { attempts: '' }], [0, { carries: '' }]]) {
  const brokenRows = liveRows.map((r, i) => i === index ? { ...r, ...extra } : r);
  assert.equal(build({ playerStats: brokenRows }).offense.value, null);
 }
});
