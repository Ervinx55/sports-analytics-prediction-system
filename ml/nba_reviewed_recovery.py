"""Prepare and render a pinned, manually reviewed outcome-only recovery.

This module has no network or database client. SQL generation requires the exact
SHA-256 of the reviewed manifest; execution is a separate authorized operation.
"""
from collections import Counter
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlparse


def check(condition, code):
    if not condition:
        raise ValueError(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True, allow_nan=False)


def instant(value):
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        check(dt.tzinfo is not None, 'INVALID_TIME')
        return dt.timestamp()
    except (TypeError, AttributeError, ValueError) as exc:
        raise ValueError('INVALID_TIME') from exc


def norm(value):
    check(isinstance(value, str) and bool(value.strip()), 'INVALID_NAME')
    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower())


def verified_bytes(workspace, ref):
    workspace = Path(workspace).resolve()
    path = (workspace / ref['path']).resolve()
    check(path.is_relative_to(workspace), 'SOURCE_PATH_OUTSIDE_WORKSPACE')
    raw = path.read_bytes()
    check(digest(raw) == ref['sha256'], 'SOURCE_HASH_MISMATCH:' + ref['path'])
    return raw


def file_ref(workspace, path):
    path = Path(path).resolve()
    check(path.is_relative_to(Path(workspace).resolve()), 'SOURCE_PATH_OUTSIDE_WORKSPACE')
    return {'path': path.relative_to(Path(workspace).resolve()).as_posix(), 'sha256': digest(path.read_bytes())}


def next_data(raw):
    found = re.findall(r'<script\b[^>]*\bid=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', raw.decode('utf-8'), re.S)
    check(len(found) == 1, 'OFFICIAL_JSON_NOT_UNIQUE')
    return json.loads(found[0])['props']['pageProps']


def pdf_first_page(path):
    import pdfplumber
    with pdfplumber.open(path) as document:
        return document.pages[0].extract_text()


def pdf_rows(text):
    check('\nFINAL BOX\n' in text, 'PDF_NOT_FINAL')
    rows = []
    side = None
    for line in text.splitlines():
        if line.startswith('VISITOR:'): side = 'away'
        if line.startswith('HOME:'): side = 'home'
        played = re.fullmatch(r'\d+ (.+?) (?:[FCG](?:-[FCG])? )?(\d{2}:\d{2}) ((?:-?\d+\s+){15}-?\d+)', line)
        dnp = re.fullmatch(r'\d+ (.+?) (DNP|DND|NWT)\s*-\s*(.*)', line)
        if played:
            values = list(map(int, played[3].split()))
            rows.append(dict(name=played[1], side=side, minutes=played[2], points=values[15], rebounds=values[8], assists=values[9], steals=values[11], blocks=values[13], turnovers=values[12]))
        elif dnp:
            rows.append(dict(name=dnp[1], side=side, status=dnp[2], reason=dnp[3]))
    return rows


def build_outcome(observation, provider, game, player, review, *, retrieved_at, source_refs):
    """Strict identity join after independent official HTML/PDF verification."""
    o = observation
    context = o.get('context', {})
    check(review.get('contract') == 'nba-outcome-identity-review-v1', 'IDENTITY_REVIEW_CONTRACT')
    check(o.get('sport') == 'NBA' and context.get('sourceContract') == 'sgo-nba-v1', 'OBSERVATION_CONTRACT')
    check(o.get('market') in ('points', 'rebounds', 'assists') and o.get('side') in ('OVER', 'UNDER') and type(o.get('line')) in (int, float) and math.isfinite(o['line']), 'MARKET_UNSUPPORTED')
    check(re.fullmatch('[a-f0-9]{64}', o.get('identity', '')), 'OBSERVATION_IDENTITY')
    check(provider.get('leagueID') == 'NBA' and provider.get('type') == 'match' and all(provider.get('status', {}).get(k) is True for k in ('completed', 'finalized', 'ended')) and provider['status'].get('cancelled') is not True, 'PROVIDER_NOT_FINAL')
    check(o['eventID'] == game['providerEventId'] == 'sgo:' + provider['eventID'], 'EVENT_MISMATCH')
    check(o['playerID'] == player['providerPlayerId'], 'PLAYER_MISMATCH')
    check(instant(o['startsAt']) == instant(provider['status']['startsAt']) == instant(game['officialStartAt']), 'START_MISMATCH')
    check(instant(o['receivedAt']) < instant(game['officialStartAt']) < instant(retrieved_at), 'OBSERVATION_NOT_PREGAME')
    check(game.get('officialFinal') is True and re.fullmatch(r'\d{10}', game['officialGameId']), 'OFFICIAL_NOT_FINAL')
    official = {side: game['archivedPregameProvider']['matchup'][side]['id'] for side in ('home', 'away')}
    current = {side: provider['teams'][side]['teamID'] for side in ('home', 'away')}
    check(len(set(official.values())) == 2 and set(current.values()) == set(official.values()) == {context['teamId'], context['opponentTeamId']}, 'TEAM_SET_MISMATCH')
    orientation = dict(providerHome=current['home'], providerAway=current['away'], officialHome=official['home'], officialAway=official['away'])
    if current != official:
        matches = [r for r in review.get('orientations', []) if r.get('eventID') == o['eventID'] and all(r.get(k) == v for k, v in orientation.items()) and isinstance(r.get('reason'), str) and r['reason'].strip()]
        check(len(matches) == 1, 'ORIENTATION_REVIEW_REQUIRED:' + o['eventID'])
        orientation['review'] = matches[0]
    p = provider.get('players', {}).get(o['playerID'])
    check(isinstance(p, dict) and p.get('playerID') == o['playerID'], 'PROVIDER_PLAYER_MISSING')
    official_side = next((s for s in ('home', 'away') if game[s]['tricode'] == player['teamTricode']), None)
    check(official_side is not None and p.get('teamID') == context['teamId'] == official[official_side], 'PLAYER_TEAM_MISMATCH')
    check(type(player.get('nbaPersonId')) is int and player['nbaPersonId'] > 0, 'OFFICIAL_PERSON_ID_MISSING')
    provider_name = p.get('name')
    check(bool(norm(provider_name)), 'PROVIDER_PLAYER_NAME_MISSING')
    same_name = norm(provider_name) == norm(player['officialName'])
    if not same_name:
        aliases = [r for r in review.get('aliases', []) if r.get('eventID') == o['eventID'] and r.get('playerID') == o['playerID'] and r.get('providerName') == provider_name and r.get('officialName') == player['officialName'] and r.get('nbaPersonId') == player['nbaPersonId']]
        check(len(aliases) == 1, 'PLAYER_ALIAS_REVIEW_REQUIRED:' + o['playerID'] + ':' + provider_name)
    # First/last are additional evidence; a contradictory profile is not ignored.
    if p.get('firstName') and p.get('lastName'):
        profile_name = p['firstName'] + ' ' + p['lastName']
        check(norm(profile_name) in {norm(provider_name), norm(player['officialName'])}, 'PROVIDER_PROFILE_NAME_CONFLICT')
    duplicates = [q for q in provider['players'].values() if q.get('teamID') == p['teamID'] and q.get('name') and norm(q['name']) == norm(provider_name)]
    check(len(duplicates) == 1, 'PROVIDER_PLAYER_AMBIGUOUS')
    stats = provider.get('results', {}).get('game', {}).get(o['playerID'])
    check(stats is None or isinstance(stats, dict), 'PROVIDER_STATS_INVALID')
    stats = stats or {}
    for field, value in stats.items():
        check(type(value) in (int, float) and math.isfinite(value) and (field == 'plusMinus' or value >= 0), 'PROVIDER_STATS_INVALID:' + field)
    minutes = player['actualMinutes']
    evidence = dict(contract='nba-reviewed-outcome-recovery-v1', reviewed=True, sourceRefs=source_refs, officialGameId=game['officialGameId'], sources=game['sources'], orientation=orientation,
        identity=dict(playerID=o['playerID'], teamId=context['teamId'], providerName=provider_name, officialName=player['officialName'], nbaPersonId=player['nbaPersonId'], aliasReviewed=not same_name),
        officialParticipation=player['participation'], officialPdf=player.get('pdf'), officialHtmlComment=player.get('officialHtmlComment'), providerStats=stats, providerConflicts={})
    outcome = dict(identity=o['identity'], playerID=o['playerID'], officialEventId=o['eventID'], officialStartAt=game['officialStartAt'], actualMinutes=minutes, retrievedAt=retrieved_at, researchOnly=True, recoveryEvidence=evidence)
    if player['participation'] == 'POSITIVE_MINUTES':
        check(type(minutes) in (int, float) and 0 < minutes <= 70 and isinstance(player['actual'], dict), 'OFFICIAL_STATS_INVALID')
        check(all(type(stats.get(k)) is int and stats[k] >= 0 for k in ('secondsPlayed', 'points', 'rebounds', 'assists')), 'PROVIDER_STATS_INVALID:CORE_FIELDS')
        actual = player['actual'].get(o['market'])
        check(type(actual) is int and actual >= 0, 'OFFICIAL_STATS_INVALID')
        official_stats = {**player.get('pdf', {}), 'secondsPlayed': round(minutes * 60)}
        for field in ('secondsPlayed', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers'):
            if field in stats and field in official_stats and stats[field] != official_stats[field]:
                evidence['providerConflicts'][field] = {'provider': stats[field], 'official': official_stats[field]}
        outcome.update(actual=actual, outcome='PUSH' if actual == o['line'] else 'WIN' if ((actual > o['line']) == (o['side'] == 'OVER')) else 'LOSS', source='NBA official gamebook and boxscore', sourceContract='nba-official-reviewed-outcome-v1', settlementPolicy='RESEARCH_POSITIVE_MINUTE_PARTICIPATION_ONLY')
    else:
        check(player['participation'] in ('EXPLICIT_NONPARTICIPATION_ROW', 'EXPLICIT_INACTIVE_LIST') and minutes == 0 and player['actual'] is None, 'OFFICIAL_PARTICIPATION_UNVERIFIED')
        check(stats.get('secondsPlayed') is None or type(stats['secondsPlayed']) in (int, float) and stats['secondsPlayed'] == 0, 'PROVIDER_PARTICIPATION_CONFLICT')
        check(all(value == 0 for value in stats.values()), 'PROVIDER_PARTICIPATION_CONFLICT')
        for period in provider.get('results', {}).values():
            if isinstance(period, dict) and o['playerID'] in period:
                values = period[o['playerID']]
                check(isinstance(values, dict) and all(type(v) in (int, float) and math.isfinite(v) and v == 0 for v in values.values()), 'PROVIDER_PARTICIPATION_CONFLICT')
        participation = dict(eventID=o['eventID'], playerID=o['playerID'], teamId=context['teamId'], officialGameId=game['officialGameId'], officialStartAt=game['officialStartAt'], retrievedAt=retrieved_at, participation='OFFICIAL_INACTIVE', reviewed=True, gameFinal=True, sourceUrl=game['sources']['gamebook']['url'], sourceSha256=game['sources']['gamebook']['sha256'], nbaPlayerId=player['nbaPersonId'], officialParticipation=player['participation'], officialHtmlComment=player.get('officialHtmlComment'), officialPdf=player.get('pdf'), pdfInactiveSection=player.get('pdfInactiveSection'), targetedRosterEvidence=player.get('targetedRosterEvidence', []))
        outcome.update(actual=None, actualMinutes=0, outcome='INACTIVE', source='NBA official gamebook', sourceContract='nba-official-inactive-v1', settlementPolicy='RESEARCH_INACTIVE_NOT_GRADED', participationEvidence=participation)
    return outcome


def verify_official_game(workspace, game, collect_source):
    """Independently reread raw official pages and PDF; the audit is a claim."""
    sources = game['sources']
    for kind, ref in sources.items():
        host = 'statsdmz.nba.com' if kind == 'gamebook' else 'www.nba.com'
        url = urlparse(ref['url'])
        check(url.scheme == 'https' and url.hostname == host and not url.username and not url.password and not url.port, 'OFFICIAL_SOURCE_URL')
    raw = next_data(collect_source(sources['gamePage']))['game']
    check(raw['gameStatus'] == 3 and raw['gameId'] == game['officialGameId'] and raw['gameCode'] == game['officialGameCode'], 'OFFICIAL_GAME_MISMATCH')
    check(instant(raw['gameTimeUTC']) == instant(game['officialStartAt']), 'OFFICIAL_START_MISMATCH')
    day, codes = raw['gameCode'].split('/')
    check(codes == raw['awayTeam']['teamTricode'] + raw['homeTeam']['teamTricode'], 'OFFICIAL_GAME_CODE_MISMATCH')
    check(sources['gamebook']['url'] == f'https://statsdmz.nba.com/pdfs/{day}/{day}_{codes}_book.pdf', 'PDF_GAME_IDENTITY')
    collect_source(sources['gamebook'])
    text = pdf_first_page(Path(workspace) / sources['gamebook']['path'])
    rows = pdf_rows(text)
    day_label = datetime.strptime(day, '%Y%m%d').strftime('%A, %B %d, %Y').replace(' 0', ' ')
    check(day_label in text, 'PDF_DATE_MISMATCH')
    schedule = next_data(collect_source(sources['schedule']))
    cards = [c['cardData'] for module in schedule['gameCardFeed']['modules'] for c in module.get('cards', []) if 'gameId' in c.get('cardData', {})]
    cards = [c for c in cards if str(c['gameId']) == game['officialGameId']]
    check(len(cards) == 1 and instant(cards[0]['gameTimeUtc']) == instant(game['officialStartAt']), 'SCHEDULE_GAME_MISMATCH')
    archived = game['archivedPregameProvider']
    board = json.loads(collect_source(archived['source']))
    events = [e for e in board['events'] if e['eventID'].removeprefix('sgo:') == game['providerEventId'].removeprefix('sgo:')]
    check(len(events) == 1 and events[0]['matchup'] == archived['matchup'], 'ARCHIVED_PROVIDER_EVENT_MISMATCH')
    check(instant(board['fetchedAt']) == instant(archived['fetchedAt']) < instant(game['officialStartAt']) and instant(events[0]['startsAt']) == instant(archived['startsAt']) == instant(game['officialStartAt']), 'ARCHIVED_PROVIDER_TIME_MISMATCH')
    for side in ('home', 'away'):
        team = raw[side + 'Team']
        check(team['teamId'] == game[side]['teamId'] == cards[0][side + 'Team']['teamId'] and team['teamTricode'] == game[side]['tricode'] == archived['matchup'][side]['short'], 'OFFICIAL_TEAM_MISMATCH')
        check(team['score'] == game[side]['score'], 'OFFICIAL_SCORE_MISMATCH')
        label = 'HOME' if side == 'home' else 'VISITOR'
        headers = re.findall(r'^' + label + r':\s*(.+?)\s*\([\d-]+\)\s*$', text, re.M)
        check(len(headers) == 1 and norm(headers[0]) == norm(team['teamCity'] + ' ' + team['teamName']), 'PDF_TEAM_MISMATCH')
    seen = set()
    for p in game['players']:
        check(p['providerPlayerId'] not in seen, 'DUPLICATE_AUDIT_PLAYER')
        seen.add(p['providerPlayerId'])
        side = next(s for s in ('home', 'away') if game[s]['tricode'] == p['teamTricode'])
        team = raw[side + 'Team']
        people = [x for x in team['players'] if x['personId'] == p['nbaPersonId']]
        if p['participation'] == 'EXPLICIT_INACTIVE_LIST':
            check(not people and p['actual'] is None and p['actualMinutes'] == 0, 'INACTIVE_PLAYED_IN_OFFICIAL_BOX')
            roster_refs = p.get('targetedRosterEvidence', [])
            check(len(roster_refs) == 1, 'INACTIVE_ROSTER_IDENTITY')
            roster = next_data(collect_source(roster_refs[0]['source']))['team']
            check(roster['info']['TEAM_ID'] == team['teamId'] and roster['info']['SEASON_YEAR'] == '2026-27', 'INACTIVE_ROSTER_TEAM')
            selected = [x for x in roster['roster'] if x['PLAYER_ID'] == p['nbaPersonId'] and norm(x['PLAYER']) == norm(p['officialName'])]
            check(len(selected) == 1, 'INACTIVE_ROSTER_PERSON')
            surname = p['officialName'].split()[-1]
            check(sum(norm(x['PLAYER'].split()[-1]) == norm(surname) for x in roster['roster']) == 1, 'INACTIVE_SURNAME_AMBIGUOUS')
            sections = list(re.finditer(r'^Inactive:\s*([^\n]+?)\s+-\s*', text, re.M))
            selected_sections = [m for m in sections if norm(m[1]) == norm(team['teamName'])]
            check(len(selected_sections) == 1, 'INACTIVE_PDF_TEAM_SECTION')
            section = selected_sections[0]
            later = [m.start() for m in sections if m.start() > section.start()]
            end = min(later) if later else text.index('\nPoints in the Paint:', section.end())
            inactive = ' '.join(text[section.end():end].split())
            check(inactive == p['pdfInactiveSection'] and re.search(r'(?:^|,\s*)' + re.escape(surname) + r'(?:\s*\(|\s*,|$)', inactive), 'INACTIVE_PDF_PERSON')
            continue
        check(len(people) == 1, 'OFFICIAL_PERSON_NOT_UNIQUE')
        person = people[0]
        check(norm(person['firstName'] + ' ' + person['familyName']) == norm(p['officialName']), 'OFFICIAL_PERSON_NAME')
        selected_rows = [r for r in rows if r['side'] == side and norm(r['name']) == norm(p['officialName'])]
        check(len(selected_rows) == 1 and selected_rows[0] == p['pdf'], 'PDF_PLAYER_ROW_CHANGED')
        stats, pdf = person['statistics'], selected_rows[0]
        check(person['comment'] == p['officialHtmlComment'], 'OFFICIAL_COMMENT_CHANGED')
        if p['participation'] == 'POSITIVE_MINUTES':
            check(re.fullmatch(r'\d{2}:\d{2}', stats['minutes']) and stats['minutes'] == pdf['minutes'] and stats['minutes'] != '00:00', 'OFFICIAL_MINUTES_MISMATCH')
            minutes = int(stats['minutes'][:2]) + int(stats['minutes'][3:]) / 60
            check(minutes == p['actualMinutes'], 'AUDITED_MINUTES_MISMATCH')
            for field, raw_key in [('points', 'points'), ('rebounds', 'reboundsTotal'), ('assists', 'assists'), ('steals', 'steals'), ('blocks', 'blocks'), ('turnovers', 'turnovers')]:
                check(type(stats[raw_key]) is int and stats[raw_key] >= 0 and stats[raw_key] == pdf[field], 'OFFICIAL_STATISTIC_MISMATCH:' + field)
                if field in p['actual']: check(p['actual'][field] == stats[raw_key], 'AUDITED_STATISTIC_MISMATCH:' + field)
        else:
            check(p['participation'] == 'EXPLICIT_NONPARTICIPATION_ROW' and p['actual'] is None and p['actualMinutes'] == 0, 'NONPARTICIPATION_INVALID')
            check(person['comment'].split(' - ')[0] in ('DNP', 'DND', 'NWT') and pdf.get('status') in ('DNP', 'DND', 'NWT'), 'NONPARTICIPATION_NOT_EXPLICIT')
            check(stats['minutes'] in ('00:00', '') and all(v == 0 for k, v in stats.items() if k != 'minutes'), 'NONPARTICIPATION_STATS_CONFLICT')
    return raw


def partition_recovery(rows, pending_snapshot, existing_snapshot):
    pending = {r['identity']: r for r in pending_snapshot}
    existing = {r['identity']: r for r in existing_snapshot}
    check(len(pending) == len(pending_snapshot) and len(existing) == len(existing_snapshot) and not set(pending) & set(existing) and set(pending) | set(existing) == {r['identity'] for r in rows}, 'RECOVERY_PARTITION_MISMATCH')
    inserts, recovered = [], []
    for row in rows:
        identity = row['identity']
        if identity in pending:
            check(pending[identity]['observation'] == row['observation'], 'PENDING_OBSERVATION_CHANGED')
            inserts.append(row)
        else:
            outcome = existing[identity]['payload']
            expected = row['outcome']
            fields = ('identity', 'playerID', 'officialEventId', 'actual', 'actualMinutes', 'outcome', 'researchOnly')
            check(all(outcome.get(k) == expected.get(k) for k in fields) and instant(outcome['officialStartAt']) == instant(expected['officialStartAt']), 'AUTOMATIC_RECOVERY_CONFLICT:' + identity)
            check(instant(row['observation']['receivedAt']) < instant(outcome['officialStartAt']) < instant(outcome['retrievedAt']), 'AUTOMATIC_RECOVERY_TIME_INVALID')
            recovered.append(dict(identity=identity, observation=row['observation'], outcome=outcome, officialComparison={k: expected[k] for k in fields}))
    return inserts, recovered


def validate_pending_scope(original_observations, pending):
    key = lambda o: (o['eventID'], o['playerID'], o['market'])
    allowed = {key(row['observation']) for row in original_observations}
    check(len(pending) <= 500 and len({r['identity'] for r in pending}) == len(pending), 'PENDING_BATCH_LIMIT')
    for row in pending:
        check(row['identity'] == row['observation']['identity'], 'PENDING_IDENTITY_MISMATCH')
        check(key(row['observation']) in allowed, 'ADDITIONAL_QUOTE_OUTSIDE_REVIEWED_SCOPE')


def prepare_manifest(workspace, *, audit_path, observations_path, provider_path, identity_review_path, as_of, pending_path=None, existing_outcomes_path=None):
    workspace = Path(workspace).resolve()
    inputs = {key: file_ref(workspace, path) for key, path in dict(audit=audit_path, observations=observations_path, provider=provider_path, identityReview=identity_review_path).items()}
    check((pending_path is None) == (existing_outcomes_path is None), 'BOTH_PARTITION_SNAPSHOTS_REQUIRED')
    if pending_path is not None:
        inputs.update(pending=file_ref(workspace, pending_path), existing=file_ref(workspace, existing_outcomes_path))
    sources = {}
    def collect(ref):
        raw = verified_bytes(workspace, ref)
        previous = sources.get(ref['path'])
        check(previous is None or previous['sha256'] == ref['sha256'], 'CONFLICTING_SOURCE_HASH')
        sources[ref['path']] = ref
        return raw
    audit, observations, provider, review = [json.loads(collect(inputs[key])) for key in ('audit', 'observations', 'provider', 'identityReview')]
    check(len(observations) == 111 and len({o['identity'] for o in observations}) == 111, 'TARGET_SCOPE_MUST_BE_111')
    check(provider.get('schemaVersion') == 'nba-outcome-source-evidence-combined-v1', 'PROVIDER_SNAPSHOT_CONTRACT')
    games = {g['providerEventId']: g for g in audit['events']}
    events = {'sgo:' + e['eventID']: e for e in provider['events']}
    receipts = {'sgo:' + r['eventID']: r for r in provider['receipts']}
    check(len(audit['events']) == len(provider['events']) == len(provider['receipts']) == len(games) == len(events) == len(receipts) == 7 and set(games) == set(events) == set(receipts) == {o['observation']['eventID'] for o in observations}, 'EVENT_SCOPE_MISMATCH')
    missing = json.loads(collect(audit['missingInput']))
    expected = {(m['event_id'], m['player_id']): (m['selected_missing'], sorted(m['markets'])) for m in missing}
    grouped = {}
    for row in observations:
        o = row['observation']
        check(row['identity'] == o['identity'], 'OBSERVATION_IDENTITY_MISMATCH')
        grouped.setdefault((o['eventID'], o['playerID']), []).append(o)
    check(set(expected) == set(grouped) and len(grouped) == 41, 'PLAYER_SCOPE_MISMATCH')
    for key, rows in grouped.items():
        check((len(rows), sorted(r['market'] for r in rows)) == expected[key] and len({r['market'] for r in rows}) == len(rows), 'SELECTED_MARKET_SCOPE_MISMATCH')
    # Pin and verify all original retrieval receipts as well as the raw sources.
    raw_dir = Path(audit_path).parent / 'official-raw'
    official_receipts = {}
    for name in ('manifest.json', 'pdf-manifest.json', 'roster-manifest.json'):
        ref = file_ref(workspace, raw_dir / name)
        for r in json.loads(collect(ref)):
            check(r['status'] == 200 and instant(r['receivedAt']) <= instant(as_of), 'OFFICIAL_RECEIPT_INVALID')
            raw_ref = file_ref(workspace, raw_dir / r['name'])
            data = collect(raw_ref)
            check(r['sha256'] == digest(data) and r['bytes'] == len(data), 'OFFICIAL_RECEIPT_HASH_MISMATCH')
            official_receipts[r['sha256']] = r
    rows = []
    for event_id, game in games.items():
        receipt = receipts[event_id]
        check(receipt.get('requestedEventIDs') == [event_id.removeprefix('sgo:')] and receipt.get('eventCount') == 1 and receipt.get('missingEventIDs') == [] and re.fullmatch('[a-f0-9]{64}', receipt.get('rawSha256', '')) and 0 < receipt.get('rawBytes', 0) <= 4*1024*1024 and instant(receipt['receivedAt']) <= instant(as_of), 'PROVIDER_RECEIPT_INVALID')
        parsed_url = urlparse(receipt['url'])
        check(parsed_url.scheme == 'https' and parsed_url.netloc == 'api.sportsgameodds.com' and parsed_url.path == '/v2/events', 'PROVIDER_SOURCE_URL')
        verify_official_game(workspace, game, collect)
        for ref in game['sources'].values():
            r = official_receipts.get(ref['sha256'])
            check(r and r['url'] == ref['url'] and instant(r['receivedAt']) <= instant(receipt['receivedAt']), 'OFFICIAL_SOURCE_RECEIPT_MISMATCH')
        players = {p['providerPlayerId']: p for p in game['players']}
        check(set(players) == {pid for eid, pid in grouped if eid == event_id}, 'AUDIT_PLAYER_SCOPE_MISMATCH')
        for row in observations:
            o = row['observation']
            if o['eventID'] != event_id: continue
            p = players[o['playerID']]
            check(p['selectedMissing'] == len(grouped[(event_id, o['playerID'])]) and sorted(p['markets']) == sorted(x['market'] for x in grouped[(event_id, o['playerID'])]), 'AUDIT_MARKET_SCOPE_MISMATCH')
            outcome = build_outcome(o, events[event_id], game, p, review, retrieved_at=receipt['receivedAt'], source_refs={'audit': inputs['audit'], 'provider': inputs['provider'], 'identityReview': inputs['identityReview'], 'providerReceipt': receipt})
            rows.append({'identity': row['identity'], 'observation': o, 'outcome': outcome})
    rows.sort(key=lambda row: row['identity'])
    check(len(rows) == 111, 'RECOVERY_COUNT_MISMATCH')
    counts = dict(Counter(r['outcome']['outcome'] for r in rows))
    recovered = []
    additional = 0
    selected_missing = 111
    if pending_path is not None:
        pending = json.loads(collect(inputs['pending']))
        existing = json.loads(collect(inputs['existing']))
        validate_pending_scope(observations, pending)
        original_ids = {r['identity'] for r in rows}
        check({r['identity'] for r in existing} <= original_ids, 'EXISTING_OUTSIDE_SELECTED_SCOPE')
        selected_missing = len(original_ids & {r['identity'] for r in pending})
        for row in pending:
            if row['identity'] in original_ids: continue
            o = row['observation']; game = games[o['eventID']]
            p = next(p for p in game['players'] if p['providerPlayerId'] == o['playerID'])
            receipt = receipts[o['eventID']]
            outcome = build_outcome(o, events[o['eventID']], game, p, review, retrieved_at=receipt['receivedAt'], source_refs={'audit': inputs['audit'], 'provider': inputs['provider'], 'identityReview': inputs['identityReview'], 'providerReceipt': receipt})
            rows.append(dict(identity=row['identity'], observation=o, outcome=outcome)); additional += 1
        rows, recovered = partition_recovery(rows, pending, existing)
        rows.sort(key=lambda r: r['identity'])
        check(all(instant(r['outcome']['retrievedAt']) <= instant(as_of) for r in recovered), 'AUTOMATIC_RECOVERY_FROM_FUTURE')
    return dict(contract='nba-reviewed-outcome-recovery-v1', asOf=as_of, reviewRequired=True, inputs=inputs, sources=sorted(sources.values(), key=lambda r:r['path']), scope=dict(observations=111, playerGames=41, events=7, outcomes=counts, insertCandidates=len(rows), alreadyRecovered=len(recovered), selectedMissingCandidates=selected_missing, additionalQuoteIdentities=additional, insertOutcomes=dict(Counter(r['outcome']['outcome'] for r in rows))), rows=rows, alreadyRecovered=recovered)


def render_insert_sql(raw_manifest, reviewed_sha256):
    check(digest(raw_manifest) == reviewed_sha256 and re.fullmatch('[a-f0-9]{64}', reviewed_sha256), 'REVIEW_HASH_MISMATCH')
    manifest = json.loads(raw_manifest)
    check(manifest.get('contract') == 'nba-reviewed-outcome-recovery-v1', 'MANIFEST_CONTRACT')
    rows = manifest['rows']
    check(rows and len(rows) <= 500 and len({r['identity'] for r in rows}) == len(rows), 'DUPLICATE_RECOVERY_IDENTITY')
    payload = packed(rows)
    already = packed(manifest.get('alreadyRecovered', []))
    delimiter = '$nba_' + reviewed_sha256[:16] + '$'
    block_delimiter = '$nba_block_' + reviewed_sha256[:16] + '$'
    check(all(d not in text for d in (delimiter, block_delimiter) for text in (payload, already)), 'SQL_DELIMITER_COLLISION')
    return f"""-- Reviewed manifest SHA-256: {reviewed_sha256}
-- Outcome inserts only; any changed observation or existing outcome aborts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.nba_prop_observations_v1 IN SHARE MODE;
LOCK TABLE public.nba_prop_outcomes_v1 IN SHARE ROW EXCLUSIVE MODE;
DO {block_delimiter}
DECLARE batch jsonb := {delimiter}{payload}{delimiter}::jsonb; recovered jsonb := {delimiter}{already}{delimiter}::jsonb; b jsonb; n integer;
BEGIN
 IF jsonb_array_length(batch)<>{len(rows)} THEN RAISE EXCEPTION 'RECOVERY_COUNT_CHANGED'; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(recovered) LOOP
  IF NOT EXISTS (SELECT 1 FROM public.nba_prop_outcomes_v1 x JOIN public.nba_prop_observations_v1 o ON o.identity=x.identity WHERE x.identity=b->>'identity' AND x.payload=b->'outcome' AND o.payload=b->'observation') THEN RAISE EXCEPTION 'AUTOMATIC_RECOVERY_CHANGED'; END IF;
 END LOOP;
 FOR b IN SELECT value FROM jsonb_array_elements(batch) LOOP
  IF NOT EXISTS (SELECT 1 FROM public.nba_prop_observations_v1 x WHERE x.identity=b->>'identity') OR EXISTS (SELECT 1 FROM public.nba_prop_observations_v1 x WHERE x.identity=b->>'identity' AND (x.payload IS DISTINCT FROM b->'observation' OR x.starts_at IS DISTINCT FROM (b#>>'{{observation,startsAt}}')::timestamptz)) THEN RAISE EXCEPTION 'OBSERVATION_CHANGED'; END IF;
  IF EXISTS (SELECT 1 FROM public.nba_prop_outcomes_v1 x WHERE x.identity=b->>'identity') THEN RAISE EXCEPTION 'OUTCOME_ALREADY_EXISTS'; END IF;
  IF NOT coalesce(b#>>'{{outcome,identity}}'=b->>'identity' AND b#>>'{{outcome,playerID}}'=b#>>'{{observation,playerID}}' AND b#>>'{{outcome,officialEventId}}'=b#>>'{{observation,eventID}}' AND b#>'{{outcome,researchOnly}}'='true'::jsonb AND (b#>>'{{observation,receivedAt}}')::timestamptz<(b#>>'{{outcome,officialStartAt}}')::timestamptz AND (b#>>'{{observation,startsAt}}')::timestamptz=(b#>>'{{outcome,officialStartAt}}')::timestamptz AND (b#>>'{{outcome,officialStartAt}}')::timestamptz<(b#>>'{{outcome,retrievedAt}}')::timestamptz AND (b#>>'{{outcome,retrievedAt}}')::timestamptz<=now(),false) THEN RAISE EXCEPTION 'OUTCOME_IDENTITY_OR_TIME_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM public.nba_prop_outcomes_v1 x JOIN public.nba_prop_observations_v1 o ON o.identity=x.identity WHERE o.payload->>'eventID'=b#>>'{{observation,eventID}}' AND o.payload->>'playerID'=b#>>'{{observation,playerID}}' AND ((x.payload->>'outcome'='INACTIVE') IS DISTINCT FROM (b#>>'{{outcome,outcome}}'='INACTIVE'))) THEN RAISE EXCEPTION 'PARTICIPATION_CONFLICT'; END IF;
  IF EXISTS (SELECT 1 FROM public.nba_prop_outcomes_v1 x JOIN public.nba_prop_observations_v1 o ON o.identity=x.identity WHERE o.payload->>'eventID'=b#>>'{{observation,eventID}}' AND o.payload->>'playerID'=b#>>'{{observation,playerID}}' AND ((x.payload->>'actualMinutes')::numeric IS DISTINCT FROM (b#>>'{{outcome,actualMinutes}}')::numeric OR (o.payload->>'market'=b#>>'{{observation,market}}' AND (x.payload->'actual') IS DISTINCT FROM (b#>'{{outcome,actual}}')))) THEN RAISE EXCEPTION 'EXISTING_STATISTIC_CONFLICT'; END IF;
 END LOOP;
 INSERT INTO public.nba_prop_outcomes_v1(identity,payload) SELECT value->>'identity',value->'outcome' FROM jsonb_array_elements(batch);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>{len(rows)} THEN RAISE EXCEPTION 'RECOVERY_INSERT_COUNT_CHANGED'; END IF;
END {block_delimiter};
COMMIT;
"""
