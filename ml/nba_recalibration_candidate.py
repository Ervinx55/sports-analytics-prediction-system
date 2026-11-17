"""Separate historical NBA variance-calibration candidate; never authorizes plays.

Only the pinned 2024 development archive is accepted by the CLI. January 2025
selects among fixed variants; February onward is previously inspected development
data. No prospective forecasts, production parameters or old holdout are loaded.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path

import numpy as np

MARKETS = {'points': 'pts', 'rebounds': 'reb', 'assists': 'ast'}
ARCHIVE_HASHES = {
    'games.json': 'd6f710ae1f196d7010506fb5205a5940a00577b606c8da40e7906d5a860c2a0a',
    'player-stats.json': '6b1aefaa4721c6f7eb3f04d80f3783f0af8f1b1492a0154b445186c1d7c6fa54',
}
POLICY = {
    'version': 'nba-minutes-distribution-recalibration-2026-11-16-v1',
    'phase': 'DEVELOPMENT_ONLY', 'productionWeight': 0, 'productionEligible': False,
    'fitBefore': '2025-01-01T00:00:00Z', 'selectBefore': '2025-02-01T00:00:00Z',
    'season': 2024, 'minimumPriorGames': 5, 'historyWindow': 10,
    'historyPublicationProxyHours': 8, 'minutesHalfLifeGames': 3,
    'minutesCap': 48, 'minutesBands': [20, 30], 'residualGridSize': 201,
    'minimumBandGames': 50, 'minimumBandRows': 200,
    'variants': {'pooled': 0, 'half': .5, 'full': 1},
    'selection': 'January equal-game Brier, gain >=0.0005 and non-worse log loss versus pooled; ties prefer simpler',
    'primaryThresholds': 'Unique nonnegative half-point lines at floor(last-ten mean)+0.5 plus fixed offsets',
    'nearOffsets': {'points': [-5, 0, 5], 'rebounds': [-2, 0, 2], 'assists': [-1, 0, 1]},
    'secondaryThresholds': {'points': [5.5, 10.5, 15.5, 20.5, 25.5],
                            'rebounds': [2.5, 4.5, 6.5, 8.5], 'assists': [1.5, 3.5, 5.5, 7.5]},
    'minimumSplitGames': 100, 'bootstrapDraws': 2000, 'bootstrapSeed': 20261116,
    'condition': 'POSITIVE_MINUTE_PARTICIPATION',
}


def stamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.utcoffset() is None:
        raise ValueError('Timezone required')
    return result.astimezone(timezone.utc)


def nonnegative(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def build_rows(games, players):
    """Audit canonical finals, then create forecasts strictly before adding history."""
    canonical, grouped, seen = {}, defaultdict(list), set()
    keys = ['datetime', 'date', 'season', 'home_team_id', 'visitor_team_id',
            'home_team_score', 'visitor_team_score', 'status', 'status_state', 'postseason']
    for game in games:
        if (game['id'] in canonical or game['season'] != 2024 or game['postseason'] is not False
                or game['status'] != 'Final' or game['status_state'] != 'final'
                or game['home_team_id'] == game['visitor_team_id']
                or not datetime(2024, 9, 1, tzinfo=timezone.utc) <= stamp(game['datetime']) < datetime(2025, 7, 1, tzinfo=timezone.utc)
                or stamp(game['datetime']).date().isoformat() != game['date']
                or not all(nonnegative(game[k]) for k in ['home_team_score', 'visitor_team_score'])):
            raise ValueError('Invalid development game')
        canonical[game['id']] = game
    for player in players:
        key = (player['game']['id'], player['player']['id'])
        game = canonical.get(key[0])
        if key in seen or not game or any(player['game'].get(k) != game[k] for k in keys):
            raise ValueError('Duplicate or inconsistent player game')
        seen.add(key)
        if player['team']['id'] not in (game['home_team_id'], game['visitor_team_id']):
            raise ValueError('Player team outside game')
        if not all(nonnegative(player.get(k)) and float(player[k]).is_integer() for k in MARKETS.values()):
            raise ValueError('Invalid boxscore stat')
        minutes = float(player['min'])
        if not math.isfinite(minutes) or not 0 <= minutes <= 70:
            raise ValueError('Invalid boxscore minutes')
        grouped[game['id']].append({**player, 'minutes': minutes})
    for game in games:
        for team, score in [(game['home_team_id'], game['home_team_score']),
                            (game['visitor_team_id'], game['visitor_team_score'])]:
            entries = [p for p in grouped[game['id']] if p['team']['id'] == team]
            if not entries or sum(p['pts'] for p in entries) != score:
                raise ValueError('Incomplete team boxscore')
    history, rows = defaultdict(list), []
    for game in sorted(games, key=lambda g: (stamp(g['datetime']), str(g['id']))):
        start = stamp(game['datetime'])
        for player in grouped[game['id']]:
            if player['minutes'] <= 0:
                continue
            key = (player['player']['id'], player['team']['id'])
            past = [p for p in history[key] if stamp(p['game']['datetime']).date() < start.date()
                    and stamp(p['game']['datetime']) + timedelta(hours=8) <= start][-10:]
            if len(past) < 5:
                continue
            weights = [2**(-(len(past)-1-i)/3) for i in range(len(past))]
            minutes = min(48., sum(p['minutes']*w for p,w in zip(past,weights))/sum(weights))
            for market, stat in MARKETS.items():
                rows.append({'id': f"{game['id']}:{player['player']['id']}:{market}",
                             'gameId': str(game['id']), 'playerId': str(player['player']['id']),
                             'market': market, 'startsAt': game['datetime'],
                             'baselineMean': sum(p[stat] for p in past)/len(past),
                             'minutesMean': minutes*sum(p[stat] for p in past)/sum(p['minutes'] for p in past),
                             'projectedMinutes': minutes, 'actual': player[stat],
                             'actualMinutes': player['minutes'], 'priorGames': len(past)})
        for player in grouped[game['id']]:
            if player['minutes'] > 0:
                history[(player['player']['id'], player['team']['id'])].append(player)
    return rows


def band(minutes):
    return 'low' if minutes < 20 else 'medium' if minutes < 30 else 'high'


def residual_grid(rows, mean_key='minutesMean'):
    if not rows:
        raise ValueError('Empty training rows')
    counts = Counter(r['gameId'] for r in rows)
    residuals = sorted(((r['actual']-r[mean_key])/math.sqrt(max(r[mean_key],1)), 1/counts[r['gameId']]) for r in rows)
    cumulative = np.cumsum([w for _,w in residuals]); cumulative /= cumulative[-1]
    return [float(residuals[min(int(np.searchsorted(cumulative, (i+.5)/201)),len(residuals)-1)][0]) for i in range(201)]


def fit(rows, mean_key='minutesMean'):
    if not rows or any(stamp(r['startsAt']) >= stamp(POLICY['fitBefore']) for r in rows):
        raise ValueError('Training must precede fixed cutoff')
    if len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate training row')
    groups = {b: [r for r in rows if band(r['projectedMinutes'])==b] for b in ['low','medium','high']}
    counts = {b: {'games':len({r['gameId'] for r in group}), 'rows':len(group)} for b,group in groups.items()}
    return {'global':residual_grid(rows,mean_key),
            'bands':{b:residual_grid(group,mean_key) if counts[b]['games']>=50 and len(group)>=200 else []
                     for b,group in groups.items()}, 'bandCoverage':counts,
            'trainingGames':len({r['gameId'] for r in rows}), 'trainingRows':len(rows), 'meanKey':mean_key}


def probability(model, row, line, strength):
    if (not nonnegative(line) or not nonnegative(row['projectedMinutes'])
            or not nonnegative(row[model.get('meanKey','minutesMean')]) or not 0<=strength<=1):
        raise ValueError('Invalid probability input')
    mean = row[model.get('meanKey','minutesMean')]
    def from_grid(grid):
        values = np.maximum(0, np.floor(mean+math.sqrt(max(mean,1))*np.asarray(grid)+.5))
        return {'over':float(np.mean(values>line)), 'under':float(np.mean(values<line)), 'push':float(np.mean(values==line))}
    global_p = from_grid(model['global'])
    local_grid = model['bands'].get(band(row['projectedMinutes']), [])
    if not local_grid or strength==0:
        return global_p
    local_p = from_grid(local_grid)
    return {k:(1-strength)*global_p[k]+strength*local_p[k] for k in global_p}


def evaluate(rows, model, strength, lines=None):
    games, bins = defaultdict(list), [[0.,0.,0.] for _ in range(10)]
    counts = Counter(r['gameId'] for r in rows)
    for row in rows:
        thresholds = lines if lines is not None else sorted({max(.5,math.floor(row['baselineMean'])+.5+offset)
                                                            for offset in POLICY['nearOffsets'][row['market']]})
        scores = []
        for line in thresholds:
            p = probability(model,row,line,strength)['over']; y = int(row['actual']>line)
            safe = min(1-1e-6,max(1e-6,p))
            scores.append([(p-y)**2, -(y*math.log(safe)+(1-y)*math.log1p(-safe))])
            weight = 1/counts[row['gameId']]/len(thresholds)
            b = bins[min(9,int(p*10))]; b[0]+=weight; b[1]+=weight*p; b[2]+=weight*y
        games[row['gameId']].append(np.mean(scores,axis=0))
    by_game = {g:np.mean(v,axis=0).tolist() for g,v in games.items()}
    means = np.mean(list(by_game.values()),axis=0)
    return {'games':len(games), 'playerMarkets':len(rows), 'brier':float(means[0]), 'logLoss':float(means[1]),
            'ece':sum(abs(b[1]-b[2]) for b in bins)/len(games),
            'reliability':[{'range':[i/10,(i+1)/10], 'gameWeight':b[0],
                            'meanProbability':b[1]/b[0] if b[0] else None,
                            'observedRate':b[2]/b[0] if b[0] else None} for i,b in enumerate(bins)],
            '_gameScores':by_game}


def select_variant(scores):
    baseline = scores['pooled']
    eligible = ['pooled']+[name for name in ['half','full']
                           if baseline['brier']-scores[name]['brier']>=.0005
                           and scores[name]['logLoss']<=baseline['logLoss']]
    return min(eligible,key=lambda name:scores[name]['brier'])


def write_json(path, payload):
    """Canonical UTF-8/LF bytes keep artifact hashes stable through Git on Windows."""
    Path(path).write_text(json.dumps(payload,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')


def run(source, output):
    source, output = Path(source), Path(output)
    raw = {name:(source/name).read_bytes() for name in ARCHIVE_HASHES}
    hashes = {name:hashlib.sha256(data).hexdigest() for name,data in raw.items()}
    manifest = json.loads((source/'manifest.json').read_text(encoding='utf-8'))
    if hashes != ARCHIVE_HASHES or hashes != manifest.get('sha256') or manifest.get('season')!=2024:
        raise ValueError('Pinned development archive/hash mismatch')
    output.mkdir(parents=True,exist_ok=False)
    policy = {**POLICY, 'inputHashes':hashes, 'archiveManifestHash':hashlib.sha256((source/'manifest.json').read_bytes()).hexdigest(),
              'codeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'createdAt':datetime.now(timezone.utc).isoformat()}
    def write(name, payload):
        write_json(output/name,payload)
    write('policy.json',policy)
    rows = build_rows(json.loads(raw['games.json']),json.loads(raw['player-stats.json']))
    report, models = {'policy':policy,'markets':{}}, {}
    for market in MARKETS:
        subset = [r for r in rows if r['market']==market]
        train = [r for r in subset if stamp(r['startsAt'])<stamp(policy['fitBefore'])]
        select = [r for r in subset if stamp(policy['fitBefore'])<=stamp(r['startsAt'])<stamp(policy['selectBefore'])]
        later = [r for r in subset if stamp(r['startsAt'])>=stamp(policy['selectBefore'])]
        if any(len({r['gameId'] for r in group})<100 for group in [train,select,later]):
            raise ValueError('Insufficient chronological game coverage')
        model = fit(train); reference = fit(train,'baselineMean')
        selection = {name:evaluate(select,model,strength) for name,strength in policy['variants'].items()}
        chosen = select_variant(selection)
        # Candidate choice is fixed before later scores are computed.
        later_scores = {name:evaluate(later,model,strength) for name,strength in policy['variants'].items()}
        baseline_scores = evaluate(later,reference,0)
        delta = np.array([later_scores[chosen]['_gameScores'][g][0]-later_scores['pooled']['_gameScores'][g][0]
                          for g in sorted(later_scores['pooled']['_gameScores'])])
        rng = np.random.default_rng(policy['bootstrapSeed'])
        interval = np.quantile(rng.choice(delta,size=(policy['bootstrapDraws'],len(delta)),replace=True).mean(axis=1),[.025,.975]).tolist()
        secondary = {name:evaluate(later,model,strength,policy['secondaryThresholds'][market])
                     for name,strength in policy['variants'].items()}
        for metrics in [baseline_scores,*selection.values(),*later_scores.values(),*secondary.values()]:
            metrics.pop('_gameScores')
        report['markets'][market] = {'trainingGames':model['trainingGames'],'trainingPlayerMarkets':len(train),
                                     'selected':chosen,'selection':selection,'laterDevelopment':later_scores,
                                     'lastTenReferenceLater':baseline_scores,'secondaryFixedThresholds':secondary,
                                     'selectedBrierDeltaVsMinutesPooled':float(delta.mean()),
                                     'descriptive95PercentGameBootstrap':interval}
        models[market] = {'distribution':model,'strength':policy['variants'][chosen], 'selected':chosen}
        print(json.dumps({'market':market,'selected':chosen,'laterPooledBrier':later_scores['pooled']['brier'],
                          'laterCandidateBrier':later_scores[chosen]['brier'],'delta':float(delta.mean()),'ci':interval}),flush=True)
    artifact = {'policy':policy,'markets':models,'productionEligible':False,'productionWeight':0}
    report['limitations'] = [
        'All data are previously inspected 2024-season development data; no untouched validation claim.',
        'Synthetic lines are independent of target outcomes but are not saved bookmaker lines; no ROI or market-edge claim.',
        'Retrospectively retrieved positive-minute universe excludes inactive players; historical availability publication times unknown.',
        'Equal game weighting and descriptive game-bootstrap intervals do not correct model-search multiplicity or season dependencies.',
        'Baseline references are refitted on a common historical cohort, not replays of the frozen November live artifacts.',
        'Separate offline artifact only. Requires a new frozen prospective protocol before deployment or approval.',
    ]
    write('candidate.json',artifact)
    report['candidateSha256'] = hashlib.sha256((output/'candidate.json').read_bytes()).hexdigest()
    write('report.json',report)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True); parser.add_argument('--output',required=True)
    arguments = parser.parse_args()
    run(arguments.source,arguments.output)
