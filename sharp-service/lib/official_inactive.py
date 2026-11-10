"""Fail-closed evidence from official final NBA gamebooks and current rosters."""
from datetime import datetime, timezone, date
from zoneinfo import ZoneInfo
import hashlib, io, json, re, time, unicodedata
import urllib.request

TRICODES=set('ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split())
MAX_BYTES=5_000_000

def validate_query(day,away,home,now):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day or '') or away not in TRICODES or home not in TRICODES or away==home:
        raise ValueError('Invalid game query')
    if not 0 <= (now.astimezone(ZoneInfo('America/New_York')).date()-date.fromisoformat(day)).days < 7:
        raise ValueError('Game outside evidence window')

def norm(value):
    return ' '.join(unicodedata.normalize('NFC',value).casefold().split())

def parse_inactive(text,day,teams):
    lines=text.splitlines()
    if not any(line.strip()=='FINAL BOX' for line in lines):raise ValueError('Not final box')
    d=date.fromisoformat(day)
    label=f'{d.strftime("%A, %B")} {d.day}, {d.year}'
    if not any(line.startswith(label+' ') or line==label for line in lines):raise ValueError('Wrong PDF date')
    for prefix,team in zip(['VISITOR','HOME'],teams):
        headers=re.findall(r'^'+prefix+r':\s*(.+?)(?:\s+\([\d-]+\))?\s*$',text,re.M)
        if len(headers)!=1 or norm(headers[0])!=norm(team['name']):raise ValueError('Wrong PDF teams')
    matches=list(re.finditer(r'^Inactive:\s*([^\n]+?)\s+-\s*',text,re.M))
    if len(matches)!=2:raise ValueError('Missing explicit inactive lists')
    result={}
    for i,m in enumerate(matches):
        team=next((t for t in teams if norm(t['shortName'])==norm(m[1])),None)
        if team is None or team['tricode'] in result:raise ValueError('Unknown inactive team')
        end=matches[i+1].start() if i+1<len(matches) else text.find('\nPoints in the Paint:',m.end())
        if end<0:raise ValueError('Unknown inactive section boundary')
        content=' '.join(text[m.end():end].split()).strip()
        names=[]
        if content.casefold()!='none':
            tokens=[];depth=0;start=0
            for pos,char in enumerate(content):
                if char=='(':depth+=1
                elif char==')':
                    depth-=1
                    if depth<0:raise ValueError('Unbalanced inactive reason')
                elif char==',' and depth==0:
                    tokens.append(content[start:pos].strip());start=pos+1
            if depth:raise ValueError('Unbalanced inactive reason')
            tokens.append(content[start:].strip())
            for token in tokens:
                opening=token.find('(')
                name=(token if opening<0 else token[:opening]).strip()
                if not name or any(c in name for c in ':,()') or not all(c.isalpha() or c in " '-.\u2019" for c in name):raise ValueError('Invalid inactive name')
                if opening>=0 and (not token.endswith(')') or not token[opening+1:-1].strip()):raise ValueError('Unexpected inactive reason')
                names.append(name)
        if len({norm(n) for n in names})!=len(names):raise ValueError('Duplicate inactive name')
        result[team['tricode']]=names
    return result

def next_data(raw):
    if len(raw)>MAX_BYTES:raise ValueError('Oversized response')
    matches=re.findall(r'<script\b[^>]*\bid=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',raw.decode('utf-8'),re.S)
    if len(matches)!=1:raise ValueError('Missing official page data')
    return json.loads(matches[0])['props']['pageProps']

def first_page(raw):
    import pdfplumber
    if len(raw)>MAX_BYTES or not raw.startswith(b'%PDF'):raise ValueError('Invalid gamebook')
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        if not 1<=len(pdf.pages)<=40:raise ValueError('Unexpected gamebook length')
        return pdf.pages[0].extract_text() or ''

def fetch_bytes(url,deadline):
    remaining=deadline-time.monotonic()
    if remaining<=0:raise TimeoutError('Evidence deadline')
    request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(request,timeout=min(8,remaining)) as response:
        chunks=[];size=0
        while True:
            if time.monotonic()>=deadline:raise TimeoutError('Evidence deadline')
            chunk=response.read(min(65536,MAX_BYTES+1-size))
            if not chunk:break
            chunks.append(chunk);size+=len(chunk)
            if size>MAX_BYTES:raise ValueError('Oversized evidence response')
    return b''.join(chunks)

def resolve_roster(roster,team,names,season):
    info=roster['info']
    if info['SEASON_YEAR']!=season or str(info['TEAM_ID'])!=str(team['teamId']) or info['TEAM_ABBREVIATION']!=team['tricode'] or norm(info['TEAM_CITY']+' '+info['TEAM_NAME'])!=norm(team['name']):raise ValueError('Wrong roster context')
    result=[]
    for name in names:
        # Match an exact trailing family name, never a substring or fuzzy alias.
        matches=[p for p in roster['roster'] if norm(p['PLAYER']).endswith(' '+norm(name)) or re.sub(r' (?:jr\.?|sr\.?|ii|iii|iv|v)$','',norm(p['PLAYER'])).endswith(' '+norm(name))]
        if len(matches)!=1 or not norm(matches[0]['PLAYER']).endswith(' '+norm(name)):raise ValueError('Inactive name not uniquely identified')
        p=matches[0];full=p['PLAYER'];first=full[:len(full)-len(name)].strip()
        if not first or not str(p['PLAYER_ID']).isdigit():raise ValueError('Invalid roster identity')
        result.append({'nbaPlayerId':p['PLAYER_ID'],'firstName':first,'lastName':full[len(first):].strip(),'fullName':full,'teamTricode':team['tricode']})
    return result

def fetch_final(day,away,home,now=None,fetch=fetch_bytes,extract=first_page):
    now=now or datetime.now(timezone.utc)
    validate_query(day,away,home,now);deadline=time.monotonic()+35
    def get(url):
        raw=fetch(url,deadline)
        if len(raw)>MAX_BYTES or time.monotonic()>deadline:raise ValueError('Evidence bounds exceeded')
        return raw
    schedule=next_data(get('https://www.nba.com/games?date='+day))
    cards=[c['cardData'] for m in schedule['gameCardFeed']['modules'] for c in m.get('cards',[]) if 'gameId' in c.get('cardData',{})]
    matches=[c for c in cards if c['awayTeam']['teamTricode']==away and c['homeTeam']['teamTricode']==home]
    if len(matches)!=1:raise ValueError('Game not unique')
    card=matches[0];gid=str(card['gameId'])
    if not re.fullmatch(r'\d{10}',gid):raise ValueError('Invalid game identity')
    game_url=f'https://www.nba.com/game/{away.lower()}-vs-{home.lower()}-{gid}/box-score'
    game_raw=get(game_url);game=next_data(game_raw)['game']
    starts=datetime.fromisoformat(game['gameTimeUTC'].replace('Z','+00:00'))
    if game['gameStatus']!=3 or str(game['gameId'])!=gid or game['gameCode']!=day.replace('-','')+'/'+away+home or starts.astimezone(ZoneInfo('America/New_York')).date().isoformat()!=day or starts>now or starts!=datetime.fromisoformat(card['gameTimeUtc'].replace('Z','+00:00')):raise ValueError('Game final/date mismatch')
    teams=[]
    for side,code in [('away',away),('home',home)]:
        t=game[side+'Team']
        if t['teamTricode']!=code or str(t['teamId'])!=str(card[side+'Team']['teamId']):raise ValueError('Game team mismatch')
        teams.append({'teamId':t['teamId'],'name':t['teamCity']+' '+t['teamName'],'shortName':t['teamName'],'tricode':code})
    pdf_url=f'https://statsdmz.nba.com/pdfs/{day.replace("-", "")}/{day.replace("-", "")}_{away}{home}_book.pdf'
    pdf_raw=get(pdf_url);names=parse_inactive(extract(pdf_raw),day,teams)
    inactive=[];roster_urls=[];roster_hashes=[]
    year=now.year if now.month>=9 else now.year-1;season=f'{year}-{str(year+1)[2:]}'
    for side,t in zip(['away','home'],teams):
        slug=re.sub(r'[^a-z0-9]+','-',t['shortName'].lower()).strip('-')
        url=f'https://www.nba.com/team/{t["teamId"]}/{slug}/roster'
        raw=get(url);roster=next_data(raw)['team']
        players=resolve_roster(roster,t,names[t['tricode']],season)
        for p in players:
            for actual in game[side+'Team']['players']:
                if str(actual['personId'])==str(p['nbaPlayerId']) or norm(actual['firstName']+' '+actual['familyName'])==norm(p['fullName']):
                    minutes=str(actual.get('statistics',{}).get('minutes',''))
                    if not re.fullmatch(r'(?:0+:0+(?:\.0+)?|PT0+M0+(?:\.0+)?S|0(?:\.0+)?|)',minutes):raise ValueError('Inactive participation conflict')
        inactive.extend(players);roster_urls.append(url);roster_hashes.append(hashlib.sha256(raw).hexdigest())
    if time.monotonic()>deadline:raise TimeoutError('Evidence deadline')
    clean=lambda t:{k:v for k,v in t.items() if k!='shortName'}
    return {'contract':'nba-official-inactive-auto-v1','gameId':gid,'gameDate':day,'startsAt':starts.isoformat(),'away':clean(teams[0]),'home':clean(teams[1]),'inactive':inactive,'sourceUrl':pdf_url,'sourceSha256':hashlib.sha256(pdf_raw).hexdigest(),'gamePageUrl':game_url,'gamePageSha256':hashlib.sha256(game_raw).hexdigest(),'rosterUrls':roster_urls,'rosterSha256':roster_hashes,'retrievedAt':datetime.now(timezone.utc).isoformat(),'gameFinal':True}
