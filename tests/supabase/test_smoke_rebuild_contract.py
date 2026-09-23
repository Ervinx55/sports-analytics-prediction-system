from scripts.supabase.smoke_rebuild import validate_report


def test_smoke_rebuild_report_contract():
    report = {
        "database_ok": True,
        "security_ok": True,
        "functions_ok": True,
        "cron_ok": True,
        "errors": [],
    }
    assert validate_report(report) == []


def test_smoke_rebuild_report_rejects_failures():
    report = {
        "database_ok": True,
        "security_ok": False,
        "functions_ok": True,
        "cron_ok": True,
        "errors": ["security failed"],
    }
    assert validate_report(report)
