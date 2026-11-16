"""Integrity tests for the offline candidate, using real computations."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'ml' / 'nba_recalibration_candidate.py'


def archive():
    games, players = [], []
    for i in range(7):
        start = datetime(2024, 11, 1, tzinfo=timezone.utc) + timedelta(days=i*2)
        game = dict(id=i, season=2024, status='Final', status_state='final', postseason=False,
                    datetime=start.isoformat(), date=start.date().isoformat(),
                    home_team_id=1, visitor_team_id=2, home_team_score=10+i, visitor_team_score=12)
        games.append(game)
        for team, pts in [(1, 10+i), (2, 12)]:
            players.append(dict(game=copy.deepcopy(game), player={'id': team}, team={'id': team},
                                min='30', pts=pts, reb=5, ast=3))
    return games, players


class CandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.exists = MODULE.is_file()
        if cls.exists:
            spec = importlib.util.spec_from_file_location('candidate', MODULE)
            cls.mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.mod)

    def require_module(self):
        self.assertTrue(self.exists, 'Offline NBA recalibration module is not implemented')
        return self.mod

    def test_target_outcome_cannot_change_its_forecast(self):
        mod = self.require_module()
        games, players = archive()
        before = mod.build_rows(games, players)
        games[-1]['home_team_score'] = 30
        for player in players[-2:]:
            player['game']['home_team_score'] = 30
            if player['team']['id'] == 1:
                player['pts'] = 30
        after = mod.build_rows(games, players)
        a = next(r for r in before if r['gameId']=='6' and r['playerId']=='1' and r['market']=='points')
        b = next(r for r in after if r['id']==a['id'])
        self.assertEqual(a['baselineMean'], 12.5)
        self.assertEqual(a['minutesMean'], b['minutesMean'])
        self.assertEqual(a['baselineMean'], b['baselineMean'])
        self.assertNotEqual(a['actual'], b['actual'])

    def test_rejects_conflicting_or_non_development_archive(self):
        mod = self.require_module()
        games, players = archive()
        players[-1]['pts'] = 11
        with self.assertRaisesRegex(ValueError, 'boxscore'):
            mod.build_rows(games, players)
        games, players = archive()
        games[-1]['season'] = 2026
        with self.assertRaises(ValueError):
            mod.build_rows(games, players)

    def test_prior_day_and_eight_hour_guard(self):
        mod = self.require_module()
        games, players = archive()
        # Sixth game's history has only four admissible games if the fifth starts
        # seven hours earlier; it cannot borrow that not-yet-published result.
        games[4]['datetime'] = '2024-11-10T20:00:00+00:00'
        games[4]['date'] = '2024-11-10'
        games[5]['datetime'] = '2024-11-11T03:00:00+00:00'
        for player in players:
            player['game'] = copy.deepcopy(games[player['game']['id']])
        rows = mod.build_rows(games, players)
        self.assertFalse(any(r['gameId']=='5' for r in rows))

    def test_real_distribution_conserves_probability_and_smooths_sparse_band(self):
        mod = self.require_module()
        model = {'global':[0.0], 'bands':{'low':[-1.0], 'medium':[], 'high':[1.0]}}
        row = {'minutesMean':4.0, 'projectedMinutes':10.0}
        p = mod.probability(model, row, 3.5, .5)
        self.assertEqual(p, {'over':.5, 'under':.5, 'push':0.0})
        row['projectedMinutes'] = 25.0
        self.assertEqual(mod.probability(model,row,3.5,1)['over'], 1.0)
        row['projectedMinutes'] = 35.0
        p = mod.probability(model,row,6.0,1)
        self.assertEqual(p, {'over':0.0,'under':0.0,'push':1.0})

    def test_equal_game_weight_and_selection_guards(self):
        mod = self.require_module()
        rows = [dict(gameId='a', actual=0, baselineMean=0, minutesMean=0, projectedMinutes=25)]
        rows += [dict(gameId='b', actual=2, baselineMean=0, minutesMean=0, projectedMinutes=25)]*9
        score = mod.evaluate(rows, {'global':[0], 'bands':{}}, 0, [0.5])
        self.assertAlmostEqual(score['brier'], .5)
        result = mod.select_variant({'pooled':{'brier':.2,'logLoss':.6},
                                     'half':{'brier':.19,'logLoss':.7},
                                     'full':{'brier':.1999,'logLoss':.59}})
        self.assertEqual(result, 'pooled')

    def test_fit_rejects_selection_rows_and_duplicate_training_observations(self):
        mod = self.require_module()
        row = dict(id='one',gameId='g',startsAt='2025-01-01T00:00:00Z',
                   actual=4,minutesMean=4,projectedMinutes=25)
        with self.assertRaisesRegex(ValueError, 'cutoff'):
            mod.fit([row])
        row['startsAt'] = '2024-12-31T00:00:00Z'
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            mod.fit([row,row])
        fitted = mod.fit([row])
        self.assertEqual(fitted['global'], [0.0]*201)
        self.assertEqual(fitted['bands']['medium'], [])

    def test_existing_experiment_is_never_overwritten(self):
        mod = self.require_module()
        source = MODULE.parents[2] / 'nba-development-recheck'
        if not source.is_dir():
            self.skipTest('Pinned development archive is external to the repository')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            sentinel = output / 'candidate.json'
            sentinel.write_text('{"keep":"original"}',encoding='utf-8')
            with self.assertRaises(FileExistsError):
                mod.run(source,output)
            self.assertEqual(sentinel.read_text(encoding='utf-8'),'{"keep":"original"}')

    def test_artifact_bytes_use_lf_on_every_platform(self):
        mod = self.require_module()
        self.assertTrue(hasattr(mod,'write_json'),'Canonical artifact writer is not implemented')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'artifact.json'
            mod.write_json(output,{'value':1})
            self.assertEqual(output.read_bytes(),b'{\n  "value": 1\n}\n')


if __name__ == '__main__':
    unittest.main()
