"""Public official-report evidence; never asserts participation or betting eligibility."""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
from pathlib import Path
import json
import sys
import threading
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lib'))
from official_injury import fetch_report
from urllib.parse import urlsplit, parse_qs
from official_inactive import fetch_final, validate_query

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

_final_cache={}
_final_lock=threading.Lock()

def final_response(query,now=None,load=fetch_final):
    now=now or datetime.now(timezone.utc)
    try:
        params=parse_qs(query,keep_blank_values=True,strict_parsing=True,max_num_fields=3)
        if set(params)!={'finalDate','away','home'} or any(len(v)!=1 for v in params.values()):
            raise ValueError('Invalid final query')
        day,away,home=(params[k][0] for k in ['finalDate','away','home'])
        validate_query(day,away,home,now)
        key=(day,away,home)
        with _final_lock:
            cached=_final_cache.get(key)
            if cached and 0<=now.timestamp()-cached[0]<300:return 200,cached[1]
        evidence=load(day,away,home,now=now)
        with _final_lock:
            if len(_final_cache)>=32:_final_cache.pop(next(iter(_final_cache)))
            _final_cache[key]=(now.timestamp(),evidence)
        return 200,evidence
    except Exception:
        return 503,{'status':'UNAVAILABLE','reason':'OFFICIAL_FINAL_EVIDENCE_UNAVAILABLE','productionEligible':False}

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query=urlsplit(self.path).query
        final=bool(query)
        status,body=final_response(query) if final else report_response()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        ttl=(300 if final else cache_seconds(body)) if status==200 else 0
        self.send_header('Cache-Control',f'public, max-age=0, s-maxage={ttl}' if ttl>0 else 'no-store')
        self.end_headers()
        self.wfile.write(json.dumps(body).encode('utf-8'))
