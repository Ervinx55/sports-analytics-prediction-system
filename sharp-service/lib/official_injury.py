"""Archive and normalize the latest official NBA injury PDF; no player-ID guessing."""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import urllib.request
from zoneinfo import ZoneInfo


def parse_lines(lines):
    context = dict(gameDate='', gameTime='', matchup='', team='')
    rows = []
    for cells in lines:
        date, time, matchup, team, player, status, reason = cells
        if re.fullmatch(r'Page\d+of\d+', re.sub(r'\s+', '', ''.join(cells))):
            continue
        for key, value in zip(context, [date, time, matchup, team]):
            if value:
                context[key] = value
                if key == 'matchup':
                    context['team'] = ''
        unsubmitted = 'NOTYETSUBMITTED' in re.sub(r'\s+', '', player+status+reason)
        if not player and not status and not unsubmitted:
            if reason and rows:
                rows[-1]['reason'] += ' ' + reason
            continue
        if not all(context.values()) or not re.fullmatch(r'\d{2}/\d{2}/\d{4}', context['gameDate']) or not re.fullmatch(r'[A-Z]{2,3}@[A-Z]{2,3}', context['matchup']):
            raise ValueError('Missing report game/team context')
        if unsubmitted:
            rows.append({**context, 'player':None, 'status':'UNKNOWN', 'reason':'Team report not submitted', 'submission':'NOT_YET_SUBMITTED'})
        elif status in ['Out', 'Doubtful', 'Questionable', 'Probable', 'Available'] and ',' in player:
            rows.append({**context, 'player':player, 'status':status, 'reason':reason, 'submission':'SUBMITTED'})
        else:
            raise ValueError('Unrecognized injury row')
    if not rows:
        raise ValueError('Empty injury report')
    return rows


def extract_pdf(data):
    import pdfplumber  # Optional local collector dependency, not required to import parser tests.
    lines = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        if not 1 <= len(pdf.pages) <= 30:
            raise ValueError('Unexpected report length')
        first = pdf.pages[0].extract_words()
        labels = ['GameDate','GameTime','Matchup','Team','PlayerName','CurrentStatus','Reason']
        columns = []
        for label in labels:
            matches = [w for w in first if w['text']==label]
            if len(matches)!=1:
                raise ValueError('Report column layout changed')
            columns.append(matches[0]['x0']-2)
        header_bottom = max(w['bottom'] for w in first if w['text'] in labels)
        for page_number, page in enumerate(pdf.pages):
            if abs(page.width-pdf.pages[0].width)>1:
                raise ValueError('Inconsistent page layout')
            grouped = {}
            for w in page.extract_words():
                if w['top'] < (header_bottom if page_number == 0 else 65) or w['text'] in labels:
                    continue
                y=next((y for y in grouped if abs(y-w['top'])<2),w['top'])
                grouped.setdefault(y,[]).append(w)
            page_lines = []
            for y, words in sorted(grouped.items()):
                cells=['']*7
                for w in sorted(words,key=lambda w:w['x0']):
                    index=max((i for i,x in enumerate(columns) if w['x0']>=x),default=0)
                    cells[index]+=(' ' if cells[index] else '')+w['text']
                if any(cells) and not re.fullmatch(r'Page\d+of\d+', re.sub(r'\s+', '', ''.join(cells))):
                    page_lines.append((y, cells))
            # Player names/statuses are vertically centered against multiline
            # reasons. A reason above a name belongs to that row, not the prior
            # player. Keep page-leading continuations on the previous page's row.
            anchors = [(y, cells[:6]+['']) for y, cells in page_lines if any(cells[:6])]
            if not anchors:
                raise ValueError('No injury rows on report page')
            for y, cells in page_lines:
                if not cells[6]:
                    continue
                nearest = min(anchors, key=lambda a: abs(a[0]-y))
                if y < anchors[0][0] and abs(nearest[0]-y)>18 and lines:
                    lines[-1][6] = (lines[-1][6]+' '+cells[6]).strip()
                elif abs(nearest[0]-y)>18:
                    raise ValueError('Unrecognized injury reason layout')
                else:
                    nearest[1][6] = (nearest[1][6]+' '+cells[6]).strip()
            lines.extend(cells for _, cells in anchors)
    return parse_lines(lines)


def fetch(url, limit):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'EdgeLab-Research/1.0'}),timeout=15) as response:
        data=response.read(limit+1)
    if len(data)>limit:
        raise ValueError('Report response too large')
    return data


def fetch_report(now=None):
    now=now or datetime.now(timezone.utc)
    start_year=now.year if now.month>=9 else now.year-1
    page=f'https://official.nba.com/nba-injury-report-{start_year}-{str(start_year+1)[2:]}-season/'
    html=fetch(page,3000000).decode('utf-8')
    pattern=r'https://ak-static\.cms\.nba\.com/referee/injury/Injury-Report_(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{2})(AM|PM)\.pdf'
    matches=[]
    for m in re.finditer(pattern,html):
        published=datetime.strptime(' '.join(m.groups()),'%Y-%m-%d %I %M %p').replace(tzinfo=ZoneInfo('America/New_York')).astimezone(timezone.utc)
        if published<=now:
            matches.append((published,m.group(0)))
    if not matches:
        raise ValueError('No published official report')
    published,url=max(matches)
    if (now-published).total_seconds()>5400:
        raise ValueError('Latest report is stale')
    data=fetch(url,10000000)
    if not data.startswith(b'%PDF'):
        raise ValueError('Invalid PDF response')
    rows=extract_pdf(data)
    result={'version':1,'url':url,'publishedAt':published.isoformat(),'retrievedAt':datetime.now(timezone.utc).isoformat(),'sha256':hashlib.sha256(data).hexdigest(),'rows':rows}
    return result, data


def collect(directory):
    result, data=fetch_report()
    url=result['url']
    dest=Path(directory);dest.mkdir(parents=True,exist_ok=True)
    archive=dest/(url.rsplit('/',1)[1].replace('.pdf','')+'-'+result['sha256'][:12])
    if not archive.with_suffix('.pdf').exists():
        archive.with_suffix('.pdf').write_bytes(data)
        archive.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    temporary=dest/'latest.tmp';temporary.write_text(json.dumps(result),encoding='utf-8');os.replace(temporary,dest/'latest.json')
    print(json.dumps({'rows':len(result['rows']),'publishedAt':result['publishedAt'],'sha256':result['sha256']}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory');args=parser.parse_args();collect(args.directory)
