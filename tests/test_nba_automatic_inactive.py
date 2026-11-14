import sys,json,copy,importlib.util
from pathlib import Path
from datetime import datetime,timezone
import pytest
sys.path.insert(0,str(Path('sharp-service/lib').resolve()))
NOW=datetime(2026,11,10,12,tzinfo=timezone.utc)

def api():
    spec=importlib.util.spec_from_file_location('availability_auto',Path('sharp-service/api/nbaavailability.py'))
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def test_automatic_endpoint_is_present():
    assert hasattr(api(),'final_response')

def test_comma_suffix_remains_one_exact_roster_identity():
    from official_inactive import parse_inactive,resolve_roster
    game,card,rosters,text=fixture_sources()
    text=text.replace('Reaves (Illness)','Udeh, Jr. (Illness), Reaves (Illness)')
    teams=[{'name':'Los Angeles Lakers','shortName':'Lakers','tricode':'LAL'},{'name':'Atlanta Hawks','shortName':'Hawks','tricode':'ATL'}]
    names=parse_inactive(text,'2026-11-09',teams)['LAL']
    assert names==['Udeh, Jr.','Reaves']
    rosters[0]['roster'].append({'PLAYER_ID':1643640,'PLAYER':'Ernest Udeh, Jr.'})
    result=resolve_roster(rosters[0],{'teamId':1610612747,'tricode':'LAL','name':'Los Angeles Lakers'},names,'2026-27')
    assert result[0]['fullName']=='Ernest Udeh, Jr.'
    assert result[0]['firstName']=='Ernest' and result[0]['lastName']=='Udeh, Jr.'

def test_orphan_suffix_is_rejected():
    from official_inactive import parse_inactive
    _,_,_,text=fixture_sources()
    teams=[{'name':'Los Angeles Lakers','shortName':'Lakers','tricode':'LAL'},{'name':'Atlanta Hawks','shortName':'Hawks','tricode':'ATL'}]
    with pytest.raises(ValueError):parse_inactive(text.replace('Reaves (Illness)','Jr. (Illness)'),'2026-11-09',teams)

def test_strict_first_page_explicit_inactive():
    from official_inactive import parse_inactive
    text="FINAL BOX\nMonday, November 9, 2026 Arena\nVISITOR: Los Angeles Lakers (1-0)\nHOME: ATLANTA HAWKS (0-1)\nInactive: Lakers - Reaves (Injury (illness)), Grimes (Right\n Finger)\nInactive: Hawks - None\nPoints in the Paint: Lakers 10"
    teams=[{'name':'Los Angeles Lakers','shortName':'Lakers','tricode':'LAL'},{'name':'Atlanta Hawks','shortName':'Hawks','tricode':'ATL'}]
    assert parse_inactive(text,'2026-11-09',teams)=={'LAL':['Reaves','Grimes'],'ATL':[]}
    for bad in [text.replace('FINAL BOX','1st QUARTER ONLY'),text.replace('November 9','November 8'),text.replace('Los Angeles Lakers','Boston Celtics'),text.replace('Reaves (Injury (illness))','Reaves (Injury (illness)'),text.replace('Inactive: Lakers -','DNP: Lakers -')]:
        with pytest.raises(ValueError):parse_inactive(bad,'2026-11-09',teams)

def test_bad_params_fail_closed_without_fetch():
    m=api()
    for query in ['finalDate=2026-10-01&away=LAL&home=ATL','finalDate=2026-11-11&away=LAL&home=ATL','finalDate=2026-11-09&away=LAL&home=LAL','finalDate=2026-11-09&away=LAL','finalDate=2026-11-09&away=LAL&home=ATL&home=BOS','finalDate=2026-11-09&away=XXX&home=ATL']:
        assert m.final_response(query,now=NOW,load=lambda *a,**k:pytest.fail('invalid query fetched'))[0]==503
def fixture_sources():
    game={'gameId':'0022600203','gameCode':'20261109/LALATL','gameStatus':3,'gameTimeUTC':'2026-11-10T00:00:00Z'}
    for side,code,tid,city,name in [('away','LAL',1610612747,'Los Angeles','Lakers'),('home','ATL',1610612737,'Atlanta','Hawks')]:
        game[side+'Team']={'teamId':tid,'teamTricode':code,'teamCity':city,'teamName':name,'players':[]}
    card={**game,'gameTimeUtc':game['gameTimeUTC']}
    rosters=[]
    for t in [game['awayTeam'],game['homeTeam']]:
        rosters.append({'info':{'TEAM_ID':t['teamId'],'TEAM_ABBREVIATION':t['teamTricode'],'TEAM_CITY':t['teamCity'],'TEAM_NAME':t['teamName'],'SEASON_YEAR':'2026-27'},'roster':[{'PLAYER_ID':1630559,'PLAYER':'Austin Reaves'},{'PLAYER_ID':1,'PLAYER':'Bronny James'}]})
    text='FINAL BOX\nMonday, November 9, 2026 Arena\nVISITOR: Los Angeles Lakers (1-0)\nHOME: ATLANTA HAWKS (0-1)\nInactive: Lakers - Reaves (Illness)\nInactive: Hawks - None\nPoints in the Paint: 10'
    return game,card,rosters,text

def run_fixture(game,card,rosters,text):
    from official_inactive import fetch_final
    html=lambda data:('<script id="__NEXT_DATA__" type="application/json">'+json.dumps({'props':{'pageProps':data}})+'</script>').encode()
    responses=[html({'gameCardFeed':{'modules':[{'cards':[{'cardData':card}]}]}}),html({'game':game}),b'%PDF-test',html({'team':rosters[0]}),html({'team':rosters[1]})]
    return fetch_final('2026-11-09','LAL','ATL',now=NOW,fetch=lambda url,deadline:responses.pop(0),extract=lambda data:text)

def test_full_pipeline_has_only_explicit_names_and_source_hashes():
    result=run_fixture(*fixture_sources())
    assert [p['fullName'] for p in result['inactive']]==['Austin Reaves']
    assert result['gameFinal'] is True and result['contract']=='nba-official-inactive-auto-v1'
    assert result['inactive'][0]['nbaPlayerId']==1630559
    assert result['sourceUrl']=='https://statsdmz.nba.com/pdfs/20261109/20261109_LALATL_book.pdf'
    assert len(result['sourceSha256'])==64 and len(result['rosterSha256'])==2
    assert 'reviewed' not in result

@pytest.mark.parametrize('mutation',['not_final','wrong_day','wrong_team','stale_roster','ambiguous','positive_minutes','unknown_name','duplicate_game','time_mismatch'])
def test_source_contradictions_are_rejected(mutation):
    game,card,rosters,text=fixture_sources()
    card=copy.deepcopy(card)
    if mutation=='not_final':game['gameStatus']=2
    if mutation=='wrong_day':game['gameCode']='20261108/LALATL'
    if mutation=='wrong_team':game['awayTeam']['teamTricode']='BOS'
    if mutation=='stale_roster':rosters[0]['info']['SEASON_YEAR']='2025-26'
    if mutation=='ambiguous':rosters[0]['roster'].append({'PLAYER_ID':123,'PLAYER':'John Reaves'})
    if mutation=='positive_minutes':game['awayTeam']['players']=[{'personId':1630559,'firstName':'Austin','familyName':'Reaves','statistics':{'minutes':'00:01'}}]
    if mutation=='unknown_name':text=text.replace('Reaves','Nobody')
    if mutation=='duplicate_game':card['gameId']='../invalid'
    if mutation=='time_mismatch':card['gameTimeUtc']='2026-11-10T01:00:00Z'
    with pytest.raises(ValueError):run_fixture(game,card,rosters,text)

def test_first_page_real_gamebooks_only():
    from official_inactive import first_page,parse_inactive
    path=Path('tests/fixtures/nba-automatic-inactive/LALATL.pdf')
    text=first_page(path.read_bytes())
    names=parse_inactive(text,'2026-11-09',[{'name':'Los Angeles Lakers','shortName':'Lakers','tricode':'LAL'},{'name':'Atlanta Hawks','shortName':'Hawks','tricode':'ATL'}])
    assert names['LAL']==['Grimes','Kaluma','Mañon','Reaves']
    assert names['ATL']==['Dennis','Gilbert','Gueye','Newell','Veesaar','Wilson']
def test_explicit_bare_surname_is_allowed_inside_inactive_section():
    from official_inactive import parse_inactive
    text='FINAL BOX\nMonday, November 9, 2026 Arena\nVISITOR: Los Angeles Lakers\nHOME: Atlanta Hawks\nInactive: Lakers - Reaves, James (Illness)\nInactive: Hawks - None\nPoints in the Paint: 1'
    teams=[{'name':'Los Angeles Lakers','shortName':'Lakers','tricode':'LAL'},{'name':'Atlanta Hawks','shortName':'Hawks','tricode':'ATL'}]
    assert parse_inactive(text,'2026-11-09',teams)['LAL']==['Reaves','James']
@pytest.mark.parametrize('gid,pair,expected',[
    ('0022600204','CLECHA',['Ernest Udeh, Jr.','Moussa Diabaté']),
    ('0022600203','LALATL',['Austin Reaves','Quentin Grimes']),
    ('0022600206','MEMTOR',['Scottie Barnes','Immanuel Quickley','Collin Murray-Boyles']),
    ('0022600209','SASPHX',['Mark Williams','Devin Vassell']),
    ('0022600210','NOPGSW',['Zion Williamson','Kristaps Porziņģis','Trey Murphy III']),
])
def test_real_audited_game_replay(gid,pair,expected):
    from official_inactive import fetch_final
    base=Path('tests/fixtures/nba-automatic-inactive')
    page=json.loads((base/f'{gid}.json').read_text(encoding='utf-8'));game=page['game']
    html=lambda data:('<script id="__NEXT_DATA__" type="application/json">'+json.dumps({'props':{'pageProps':data}})+'</script>').encode()
    def fetch(url,deadline):
        if '/games?' in url:return html(json.loads((base/'schedule.json').read_text(encoding='utf-8')))
        if '/game/' in url:return html(page)
        if '/pdfs/' in url:return (base/f'{pair}.pdf').read_bytes()
        code=pair[:3] if str(game['awayTeam']['teamId']) in url else pair[3:]
        return html(json.loads((base/f'{code}.json').read_text(encoding='utf-8')))
    result=fetch_final('2026-11-09',pair[:3],pair[3:],now=NOW,fetch=fetch)
    assert set(expected)<=set(p['fullName'] for p in result['inactive'])
def test_ambiguous_family_name_with_suffix_is_not_resolved():
    from official_inactive import resolve_roster
    game,card,rosters,text=fixture_sources()
    rosters[0]['roster']=[{'PLAYER_ID':1,'PLAYER':'John Reaves'},{'PLAYER_ID':2,'PLAYER':'Mike Reaves Jr.'}]
    with pytest.raises(ValueError):resolve_roster(rosters[0],{'teamId':1610612747,'tricode':'LAL','name':'Los Angeles Lakers'},['Reaves'],'2026-27')

def test_endpoint_caches_only_success_and_bounds_entries():
    m=api();calls=[]
    def load(*args,**kwargs):calls.append(1);return {'gameFinal':True}
    query='finalDate=2026-11-09&away=LAL&home=ATL'
    assert m.final_response(query,NOW,load)[0]==200
    assert m.final_response(query,NOW,load)[0]==200
    assert len(calls)==1
    def fail(*args,**kwargs):raise RuntimeError('private')
    for _ in range(2):
        status,body=m.final_response(query.replace('ATL','BOS'),NOW,fail)
        assert status==503 and 'private' not in str(body)
    assert len(m._final_cache)==1
def test_http_dispatch_preserves_injury_route_and_no_store_on_final_failure(monkeypatch):
    import io
    m=api()
    seen=[]
    monkeypatch.setattr(m,'report_response',lambda:(seen.append('injury') or (200,{'publishedAt':datetime.now(timezone.utc).isoformat()})))
    monkeypatch.setattr(m,'final_response',lambda q:(seen.append(q) or (503,{'status':'UNAVAILABLE'})))
    for path,route in [('/api/nbaavailability','injury'),('/api/nbaavailability?finalDate=2026-11-09&away=LAL&home=ATL','finalDate=2026-11-09&away=LAL&home=ATL')]:
        h=object.__new__(m.handler);h.path=path;h.wfile=io.BytesIO();headers={};statuses=[]
        h.send_response=statuses.append;h.send_header=lambda k,v:headers.update({k:v});h.end_headers=lambda:None
        h.do_GET()
        assert seen[-1]==route
        if route!='injury':assert statuses==[503] and headers['Cache-Control']=='no-store'

def test_oversized_sources_rejected():
    from official_inactive import fetch_final,MAX_BYTES
    with pytest.raises(ValueError):fetch_final('2026-11-09','LAL','ATL',now=NOW,fetch=lambda *a:b'x'*(MAX_BYTES+1))
