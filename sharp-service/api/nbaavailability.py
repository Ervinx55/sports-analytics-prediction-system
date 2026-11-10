"""Public official-report evidence; never asserts participation or betting eligibility."""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
from pathlib import Path
import json
import sys
import threading
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lib'))
from official_injury import fetch_report

_cache={}
_lock=threading.Lock()

def report_response(now=None,load=fetch_report):
    live_clock=now is None
    now=now or datetime.now(timezone.utc)
    with _lock:
        cached=_cache.get('report')
        if cached and 0 <= now.timestamp()-_cache['at'] < 300 and 0 <= (now-datetime.fromisoformat(cached['publishedAt'])).total_seconds() <= 5400:
            return 200,cached
        try:
            report,_=load()
            if live_clock:now=datetime.now(timezone.utc)
            published=datetime.fromisoformat(report['publishedAt'])
            received=datetime.fromisoformat(report['retrievedAt'])
            if not published <= received <= now or not 0 <= (now-published).total_seconds() <= 5400:
                raise ValueError('Stale/future report')
            _cache.update(report=report,at=now.timestamp())
            return 200,report
        except Exception as error:
            _cache.clear()
            return 503,{'status':'UNAVAILABLE','reason':'OFFICIAL_REPORT_UNAVAILABLE_OR_STALE','productionEligible':False,'diagnostic':{'category':type(error).__name__,'httpStatus':getattr(error,'code',None) if isinstance(getattr(error,'code',None),int) else None}}

def cache_seconds(report,now=None):
    now=now or datetime.now(timezone.utc)
    age=(now-datetime.fromisoformat(report['publishedAt'])).total_seconds()
    return max(0,min(300,int(5400-age))) if age>=0 else 0

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        status,body=report_response()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        ttl=cache_seconds(body) if status==200 else 0
        self.send_header('Cache-Control',f'public, max-age=0, s-maxage={ttl}' if ttl>0 else 'no-store')
        self.end_headers()
        self.wfile.write(json.dumps(body).encode('utf-8'))

