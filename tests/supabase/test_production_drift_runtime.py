import json
import sys

import pytest

from scripts.supabase import production_drift as drift


PROJECT = "yeoxroijaptomomshdii"
TOKEN = "test-access-token-do-not-print"
PASSWORD = "test-database-password-do-not-print"


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    root = tmp_path / "repository"
    manifests = root / "supabase" / "manifests"
    manifests.mkdir(parents=True)
    inventory = {"project_ref": PROJECT}
    for name, value in {
        "production-inventory": inventory,
        "cron-jobs": {"items": []},
        "migrations": {"items": []},
        "edge-functions": {"items": []},
    }.items():
        (manifests / f"{name}.json").write_text(json.dumps(value))
    monkeypatch.setattr(drift, "ROOT", root)
    for name in ("SUPABASE_PROJECT_ID", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(drift, "live_inventory", lambda project: inventory)
    monkeypatch.setattr(drift, "live_migrations", lambda: [])
    monkeypatch.setattr(drift, "live_cron", lambda: [])
    monkeypatch.setattr(drift, "live_functions", lambda project, token: [])
    return manifests, tmp_path / "drift-report.json"


def invoke(monkeypatch, output, *args):
    monkeypatch.setattr(sys, "argv", ["production_drift.py", "--output", str(output), *args])
    status = drift.main()
    return status, json.loads(output.read_text())


def configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_PROJECT_ID", PROJECT)
    monkeypatch.setenv("SUPABASE_ACCESS_TOKEN", TOKEN)
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", PASSWORD)


def test_missing_credentials_produce_a_report_without_querying_production(runtime, monkeypatch, capsys):
    _, output = runtime
    monkeypatch.setattr(drift, "live_inventory", lambda project: pytest.fail("must not query without credentials"))
    status, report = invoke(monkeypatch, output)
    assert status == 2
    assert report["status"] == "blocked"
    assert report["project_ref"] == PROJECT
    assert report["read_only"] is True
    assert report["drift"] is None
    assert report["error"]["missing_variables"] == ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"]
    assert "SUPABASE_ACCESS_TOKEN" in capsys.readouterr().out


def test_preflight_uses_the_manifest_project_without_requiring_a_project_secret(runtime, monkeypatch):
    _, output = runtime
    configured(monkeypatch)
    monkeypatch.delenv("SUPABASE_PROJECT_ID")
    monkeypatch.setattr(drift, "live_inventory", lambda project: pytest.fail("preflight must not query production"))
    status, report = invoke(monkeypatch, output, "--preflight-only")
    assert status == 0
    assert report["status"] == "preflight_passed"
    assert report["project_ref"] == PROJECT
    assert report["drift"] is None
    assert TOKEN not in output.read_text()
    assert PASSWORD not in output.read_text()


def test_preflight_rejects_a_different_project_before_making_requests(runtime, monkeypatch):
    _, output = runtime
    configured(monkeypatch)
    monkeypatch.setenv("SUPABASE_PROJECT_ID", "different-project")
    monkeypatch.setattr(drift, "live_inventory", lambda project: pytest.fail("wrong project must not be queried"))
    status, report = invoke(monkeypatch, output)
    assert status == 2
    assert report["status"] == "blocked"
    assert report["error"]["code"] == "project_mismatch"
    assert report["drift"] is None


def test_connection_failure_writes_a_safe_report_and_fails_closed(runtime, monkeypatch, capsys):
    _, output = runtime
    configured(monkeypatch)

    def failed_connection(project):
        raise RuntimeError(f"connection rejected {TOKEN} {PASSWORD}")

    monkeypatch.setattr(drift, "live_inventory", failed_connection)
    status, report = invoke(monkeypatch, output)
    assert status == 2
    assert report["status"] == "error"
    assert report["error"]["stage"] == "schema_security"
    assert report["error"]["type"] == "RuntimeError"
    assert report["drift"] is None
    rendered = output.read_text() + capsys.readouterr().out
    assert TOKEN not in rendered
    assert PASSWORD not in rendered


def test_recorded_production_migrations_use_deployed_versions_and_exclude_local_only(runtime, monkeypatch):
    manifests, output = runtime
    configured(monkeypatch)
    items = [
        {"version": "100", "name": "historical", "recoveredFromProduction": True},
        {"version": "200", "name": "applied", "appliedToProduction": True},
        {"version": "300", "productionVersion": "301", "name": "remapped", "appliedToProduction": True},
        {"version": "400", "name": "local_catchup", "catchup": True},
        {"version": "500", "name": "pending", "appliedToProduction": False},
    ]
    (manifests / "migrations.json").write_text(json.dumps({"items": items}))
    monkeypatch.setattr(drift, "live_migrations", lambda: [
        {"version": "100", "name": "historical"},
        {"version": "200", "name": "applied"},
        {"version": "301", "name": "remapped"},
    ])
    status, report = invoke(monkeypatch, output)
    assert status == 0
    assert report["status"] == "complete"
    assert report["drift"] is False
    assert report["migration_diff"] == {"missing": [], "unexpected": [], "changed": []}


def test_unexpected_objects_still_fail_the_drift_check(runtime, monkeypatch):
    _, output = runtime
    configured(monkeypatch)
    monkeypatch.setattr(drift, "live_inventory", lambda project: {
        "project_ref": PROJECT,
        "tables": [{"schema": "public", "name": "unreviewed", "structure_sha256": "new"}],
    })
    status, report = invoke(monkeypatch, output)
    assert status == 1
    assert report["status"] == "complete"
    assert report["drift"] is True
    assert report["schema_security_diff"]["unexpected"][0]["identity"] == "public.unreviewed"
