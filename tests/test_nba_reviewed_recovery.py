import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import pytest

MODULE = Path(__file__).parents[1] / 'ml' / 'nba_reviewed_recovery.py'

def api():
    assert MODULE.exists(), 'Reviewed outcome recovery is not implemented'
    spec = importlib.util.spec_from_file_location('nba_reviewed_recovery', MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def fixture():
    observation = dict(identity='a'*64, eventID='sgo:event', playerID='PLAYER_1_NBA', sport='NBA', market='points', side='OVER', line=9.5, startsAt='2026-11-15T00:00:00Z', receivedAt='2026-11-14T23:00:00Z', context=dict(sourceContract='sgo-nba-v1', teamId='MIAMI_HEAT_NBA', opponentTeamId='DETROIT_PISTONS_NBA'))
    provider = dict(eventID='event', leagueID='NBA', type='match', status=dict(startsAt=observation['startsAt'], completed=True, finalized=True, ended=True), teams=dict(home=dict(teamID='MIAMI_HEAT_NBA', names=dict(long='Miami Heat')), away=dict(teamID='DETROIT_PISTONS_NBA', names=dict(long='Detroit Pistons'))), players={'PLAYER_1_NBA':dict(playerID='PLAYER_1_NBA', teamID='MIAMI_HEAT_NBA', name='Test Player', firstName='Test', lastName='Player')}, results={'game':{'PLAYER_1_NBA':dict(secondsPlayed=1200, points=9,rebounds=2,assists=1)}})
    game = dict(providerEventId='sgo:event', officialGameId='0022600001', officialStartAt=observation['startsAt'], officialFinal=True, away=dict(tricode='DET', teamId=1610612765), home=dict(tricode='MIA', teamId=1610612748), archivedPregameProvider=dict(matchup=dict(home=dict(id='MIAMI_HEAT_NBA'),away=dict(id='DETROIT_PISTONS_NBA'))), sources={'gamebook':dict(url='https://statsdmz.nba.com/pdfs/20261114/20261114_DETMIA_book.pdf',sha256='b'*64), 'gamePage':dict(sha256='c'*64), 'schedule':dict(sha256='d'*64)})
    player = dict(providerPlayerId='PLAYER_1_NBA', officialName='Test Player', nbaPersonId=12345, teamTricode='MIA', participation='POSITIVE_MINUTES', actualMinutes=20, actual={'points':10}, pdf=dict(minutes='20:00',points=10,rebounds=2,assists=1,steals=0,blocks=0,turnovers=1))
    review = dict(contract='nba-outcome-identity-review-v1', aliases=[], orientations=[])
    return observation, provider, game, player, review

def build(parts):
    return api().build_outcome(*parts, retrieved_at='2026-11-16T18:00:00Z', source_refs={'provider':{'sha256':'e'*64},'audit':{'sha256':'f'*64}})

def test_positive_outcome_uses_official_stats_and_preserves_provider_conflict():
    parts=fixture(); before=copy.deepcopy(parts)
    outcome=build(parts)
    assert outcome['outcome']=='WIN' and outcome['actual']==10 and outcome['actualMinutes']==20
    assert outcome['recoveryEvidence']['providerStats']=={'secondsPlayed':1200,'points':9,'rebounds':2,'assists':1}
    assert outcome['recoveryEvidence']['providerConflicts']['points']=={'provider':9,'official':10}
    assert parts==before
    for side,line,want in [('UNDER',9.5,'LOSS'),('OVER',10,'PUSH')]:
        altered=copy.deepcopy(parts);altered[0].update(side=side,line=line)
        assert build(altered)['outcome']==want

def test_inactive_is_ungraded_and_positive_provider_minutes_block_it():
    parts=fixture();parts[3].update(participation='EXPLICIT_NONPARTICIPATION_ROW', actualMinutes=0,actual=None,pdf={'status':'DND'},officialHtmlComment='DNP - Injury')
    with pytest.raises(ValueError,match='PROVIDER_PARTICIPATION_CONFLICT'):build(parts)
    parts[1]['results']['game']['PLAYER_1_NBA']['secondsPlayed']=0
    parts[1]['results']['game']['PLAYER_1_NBA']['points']=0
    parts[1]['results']['game']['PLAYER_1_NBA']['rebounds']=0
    parts[1]['results']['game']['PLAYER_1_NBA']['assists']=0
    out=build(parts)
    assert (out['outcome'],out['actual'],out['actualMinutes'])==('INACTIVE',None,0)
    assert out['sourceContract']=='nba-official-inactive-v1'
    assert out['settlementPolicy']=='RESEARCH_INACTIVE_NOT_GRADED'
    assert out['participationEvidence']['reviewed'] is True
    assert out['participationEvidence']['participation']=='OFFICIAL_INACTIVE'
    assert 'contract' not in out['participationEvidence']
    parts[1]['results']['game']['PLAYER_1_NBA']['points']=1
    with pytest.raises(ValueError,match='PROVIDER_PARTICIPATION_CONFLICT'):build(parts)

def test_existing_automatic_recovery_is_validated_and_excluded_from_inserts():
    parts=fixture();out=build(parts);row={'identity':parts[0]['identity'],'observation':parts[0],'outcome':out}
    pending,existing=api().partition_recovery([row],[],[{'identity':row['identity'],'payload':out}])
    assert pending==[] and existing[0]['outcome']==out
    changed=copy.deepcopy(out);changed['actual']=11
    with pytest.raises(ValueError,match='AUTOMATIC_RECOVERY_CONFLICT'):
        api().partition_recovery([row],[],[{'identity':row['identity'],'payload':changed}])

def test_additional_quotes_cannot_expand_reviewed_player_market_scope():
    observation=fixture()[0]
    extra=copy.deepcopy(observation);extra.update(identity='b'*64,line=10.5,side='UNDER')
    api().validate_pending_scope([{'identity':observation['identity'],'observation':observation}],[{'identity':extra['identity'],'observation':extra}])
    extra['market']='steals'
    with pytest.raises(ValueError,match='ADDITIONAL_QUOTE_OUTSIDE_REVIEWED_SCOPE'):
        api().validate_pending_scope([{'identity':observation['identity'],'observation':observation}],[{'identity':extra['identity'],'observation':extra}])

def test_inactive_rejects_participation_in_another_provider_period():
    parts=fixture()
    parts[3].update(participation='EXPLICIT_NONPARTICIPATION_ROW',actualMinutes=0,actual=None,pdf={'status':'DND'})
    parts[1]['results']={'game':{},'1q':{'PLAYER_1_NBA':{'secondsPlayed':120,'points':2}}}
    with pytest.raises(ValueError,match='PROVIDER_PARTICIPATION_CONFLICT'):build(parts)

def test_positive_source_core_statistics_must_be_present_and_valid():
    for value in [None,-1,True,1.5,'9']:
        parts=fixture();parts[1]['results']['game']['PLAYER_1_NBA']['points']=value
        with pytest.raises(ValueError,match='PROVIDER_STATS_INVALID'):build(parts)
    parts=fixture();del parts[1]['results']['game']['PLAYER_1_NBA']['points']
    with pytest.raises(ValueError,match='PROVIDER_STATS_INVALID'):build(parts)

def test_reversed_orientation_requires_exact_review_and_is_preserved():
    parts=fixture();parts[1]['teams']['home'],parts[1]['teams']['away']=parts[1]['teams']['away'],parts[1]['teams']['home']
    with pytest.raises(ValueError,match='ORIENTATION_REVIEW_REQUIRED'):build(parts)
    parts[4]['orientations']=[dict(eventID='sgo:event', providerHome='DETROIT_PISTONS_NBA',providerAway='MIAMI_HEAT_NBA',officialHome='MIAMI_HEAT_NBA',officialAway='DETROIT_PISTONS_NBA',reason='Pinned official gamebook and archived pregame fixture agree.')]
    out=build(parts)
    assert out['recoveryEvidence']['orientation']['providerHome']=='DETROIT_PISTONS_NBA'
    assert out['recoveryEvidence']['orientation']['officialHome']=='MIAMI_HEAT_NBA'
    parts[4]['orientations'][0]['providerHome']='OTHER_NBA'
    with pytest.raises(ValueError,match='ORIENTATION_REVIEW_REQUIRED'):build(parts)

def test_aliases_require_exact_reviewed_person_team_and_provider_name():
    parts=fixture();parts[1]['players']['PLAYER_1_NBA'].update(name='T. Player',firstName='T.',lastName='Player')
    with pytest.raises(ValueError,match='PLAYER_ALIAS_REVIEW_REQUIRED'):build(parts)
    parts[4]['aliases']=[dict(eventID='sgo:event',playerID='PLAYER_1_NBA',providerName='T. Player',officialName='Test Player',nbaPersonId=12345)]
    assert build(parts)['recoveryEvidence']['identity']['aliasReviewed'] is True
    parts[1]['players']['PLAYER_1_NBA']['teamID']='DETROIT_PISTONS_NBA'
    with pytest.raises(ValueError,match='PLAYER_TEAM_MISMATCH'):build(parts)

def test_event_time_and_pregame_identity_are_strict():
    for change,reason in [(lambda p:p[0].update(receivedAt=p[0]['startsAt']),'OBSERVATION_NOT_PREGAME'),(lambda p:p[1]['status'].update(startsAt='2026-11-15T00:01:00Z'),'START_MISMATCH'),(lambda p:p[1].update(eventID='different'),'EVENT_MISMATCH'),(lambda p:p[0].update(market='steals'),'MARKET_UNSUPPORTED')]:
        parts=fixture();change(parts)
        with pytest.raises(ValueError,match=reason):build(parts)

def test_source_hash_and_workspace_boundary_are_enforced(tmp_path):
    path=tmp_path/'source.json';path.write_text('{"final":true}',encoding='utf-8')
    ref={'path':'source.json','sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    assert api().verified_bytes(tmp_path,ref)==path.read_bytes()
    path.write_text('{"final":false}',encoding='utf-8')
    with pytest.raises(ValueError,match='SOURCE_HASH_MISMATCH'):api().verified_bytes(tmp_path,ref)
    with pytest.raises(ValueError,match='SOURCE_PATH_OUTSIDE_WORKSPACE'):api().verified_bytes(tmp_path,{'path':'../escape','sha256':'a'*64})

def test_sql_requires_exact_review_hash_and_aborts_existing_outcomes():
    parts=fixture();out=build(parts)
    manifest={'contract':'nba-reviewed-outcome-recovery-v1','rows':[{'identity':parts[0]['identity'],'observation':parts[0],'outcome':out}],'sources':[]}
    raw=json.dumps(manifest).encode();sha=hashlib.sha256(raw).hexdigest()
    with pytest.raises(ValueError,match='REVIEW_HASH_MISMATCH'):api().render_insert_sql(raw,'0'*64)
    sql=api().render_insert_sql(raw,sha)
    assert 'OUTCOME_ALREADY_EXISTS' in sql and 'OBSERVATION_CHANGED' in sql and 'PARTICIPATION_CONFLICT' in sql
    assert 'INSERT INTO public.nba_prop_outcomes_v1' in sql
    assert 'UPDATE ' not in sql and 'DELETE ' not in sql and 'ON CONFLICT' not in sql
    assert 'LOCK TABLE public.nba_prop_outcomes_v1' in sql
    assert "x.payload IS DISTINCT FROM b->'observation'" in sql
