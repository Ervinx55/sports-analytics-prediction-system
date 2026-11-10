import importlib.util
from pathlib import Path
from datetime import datetime,timezone

def test_report_endpoint_fails_closed_and_caches_valid_evidence():
    spec=importlib.util.spec_from_file_location('nbaavailability',Path('sharp-service/api/nbaavailability.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    now=datetime(2026,11,9,17,tzinfo=timezone.utc)
    report={'publishedAt':'2026-11-09T16:30:00+00:00','retrievedAt':'2026-11-09T16:31:00+00:00','rows':[{}]}
    calls=[]
    def load():calls.append(1);return report,b'pdf'
    assert module.report_response(now,load)[0]==200
    assert module.report_response(now,load)[0]==200
    assert len(calls)==1
    module._cache.clear()
    report['publishedAt']='2026-11-09T14:00:00+00:00'
    assert module.report_response(now,load)[0]==503
    module._cache.clear()
    def fail():raise RuntimeError('private details')
    status,body=module.report_response(now,fail)
    assert status==503 and 'private details' not in str(body)

def test_local_archive_entrypoint_finishes_after_shared_parser_refactor(tmp_path,monkeypatch,capsys):
    spec=importlib.util.spec_from_file_location('shared_official',Path('sharp-service/lib/official_injury.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    report={'url':'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-09_11_30AM.pdf','sha256':'a'*64,'publishedAt':'2026-11-09T16:30:00Z','rows':[{}]}
    monkeypatch.setattr(module,'fetch_report',lambda:(report,b'%PDF-fixture'))
    module.collect(str(tmp_path))
    assert (tmp_path/'latest.json').exists()
    assert '"rows": 1' in capsys.readouterr().out
