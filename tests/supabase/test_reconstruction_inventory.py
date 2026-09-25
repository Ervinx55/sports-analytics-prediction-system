from __future__ import annotations

import importlib.util
import json
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "scripts" / "supabase" / "validate_reconstruction.py"


def _load_validator():
    if not VALIDATOR.exists():
        pytest.fail("reconstruction validator is not implemented")
    spec = importlib.util.spec_from_file_location("validate_reconstruction", VALIDATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reconstruction_tree_is_complete():
    module = _load_validator()
    errors = module.validate_repository(ROOT)
    assert errors == []


def test_secret_files_are_ignored():
    gitignore = (ROOT / ".gitignore").read_text()
    assert "supabase/.env" in gitignore
    assert "supabase/.temp/" in gitignore


EXPECTED_HISTORICAL_MIGRATIONS = [
    ("20260922210537", "enable_snapshot_scheduler_extensions"),
    ("20260922210637", "create_market_snapshot_tables"),
    ("20260922234532", "create_model_audit_and_grading_ledger"),
    ("20260922234613", "extend_candidate_grade_clv_fields"),
    ("20260922235011", "create_model_calibration_view"),
    ("20260923003108", "create_sharp_gate_history"),
    ("20260923005752", "create_market_grade_observations_and_expand_sharp_history"),
    ("20260923012236", "create_player_prop_audit_and_results"),
    ("20260923034936", "create_team_market_results_ledger"),
    ("20260923060509", "upgrade_sharp_gate_reliability_v2"),
    ("20260923061150", "harden_analytics_backend_access"),
    ("20260923061220", "lock_down_internal_rpc_functions"),
    ("20260923061948", "add_sharp_source_quote_pipeline"),
    ("20260923062037", "schedule_sharp_source_refresh"),
    ("20260923062439", "retain_sharp_quote_history_14_days"),
    ("20260923063003", "add_sharp_market_clv_tracking"),
    ("20260923063049", "schedule_sharp_clv_capture"),
]


def test_historical_migration_inventory_is_exact():
    manifest = json.loads(
        (ROOT / "supabase" / "manifests" / "migrations.json").read_text()
    )
    items = [
        item for item in manifest["items"]
        if item.get("recoveredFromProduction") is True
    ]
    actual = [(str(item["version"]), item["name"]) for item in items]
    assert actual == EXPECTED_HISTORICAL_MIGRATIONS

    for item in items:
        assert item["recoveredFromProduction"] is True
        assert item["sha256"]
        expected_path = (
            f"supabase/migrations/{item['version']}_{item['name']}.sql"
        )
        assert item["path"] == expected_path
        assert (ROOT / expected_path).exists()


EXPECTED_EDGE_FUNCTION_COUNT = 53


def test_edge_function_recovery_is_complete_and_configured():
    manifest = json.loads(
        (ROOT / "supabase" / "manifests" / "edge-functions.json").read_text()
    )
    items = manifest["items"]
    assert len(items) == EXPECTED_EDGE_FUNCTION_COUNT

    slugs = [item["slug"] for item in items]
    assert len(slugs) == len(set(slugs))

    functions_dir = ROOT / "supabase" / "functions"
    dirs = sorted(
        p.name
        for p in functions_dir.iterdir()
        if p.is_dir() and not p.name.startswith("_")
    )
    assert sorted(slugs) == dirs

    config = tomllib.loads((ROOT / "supabase" / "config.toml").read_text())
    configured = config.get("functions", {})

    for item in items:
        assert item["status"] == "ACTIVE"
        assert item["bundle_sha256"]
        assert item["files"]
        assert item["slug"] in configured
        assert configured[item["slug"]]["verify_jwt"] is item["verify_jwt"]

        for file_entry in item["files"]:
            path = ROOT / file_entry["path"]
            assert path.exists()
            assert file_entry["sha256"]


def test_production_inventory_shape_is_non_secret_and_complete():
    inv = json.loads(
        (ROOT / "supabase" / "manifests" / "production-inventory.json").read_text()
    )
    for key in ("tables", "views", "functions", "indexes", "extensions", "rls", "grants"):
        assert key in inv
        assert isinstance(inv[key], list)

    assert inv.get("project_ref") == "yeoxroijaptomomshdii"
    assert inv.get("captured_at")


def test_cron_inventory_is_redacted_and_complete():
    cron = json.loads(
        (ROOT / "supabase" / "manifests" / "cron-jobs.json").read_text()
    )
    assert cron.get("project_ref") == "yeoxroijaptomomshdii"
    assert cron.get("captured_at")
    assert isinstance(cron.get("items"), list)

    for item in cron["items"]:
        assert item["jobname"]
        assert item["schedule"]
        assert isinstance(item["active"], bool)
        assert item["command_sha256"]
        serialized = json.dumps(item)
        assert "snapshot_publishable_key" not in serialized
        assert "snapshot_project_url" not in serialized
        assert "Authorization" not in serialized


def test_catchup_objects_are_fully_assigned():
    manifest = json.loads(
        (ROOT / "supabase" / "manifests" / "catchup-objects.json").read_text()
    )
    assert len(manifest["items"]) == 89
    for item in manifest["items"]:
        represented = item.get("represented_by")
        assert represented
        assert (ROOT / represented).exists()


def test_catchup_migration_chain_is_unique_and_hardened():
    manifest = json.loads(
        (ROOT / "supabase" / "manifests" / "migrations.json").read_text()
    )
    catchup = [item for item in manifest["items"] if item.get("catchup")]
    assert len(catchup) == 10
    assert len({item["version"] for item in catchup}) == 10

    for item in catchup:
        sql = (ROOT / item["path"]).read_text()
        assert "revoke " in sql.lower()
        assert "service_role" in sql
        assert "sb_secret_" not in sql
        assert "sb_publishable_" not in sql


def test_catchup_tables_and_views_keep_security_controls():
    manifest = json.loads(
        (ROOT / "supabase" / "manifests" / "catchup-objects.json").read_text()
    )
    by_file = {}
    for item in manifest["items"]:
        by_file.setdefault(item["represented_by"], []).append(item["identity"])

    for path, identities in by_file.items():
        sql = (ROOT / path).read_text().lower()
        if any(identity.startswith("table:") for identity in identities):
            assert "enable row level security" in sql
        if any(identity.startswith("view:") for identity in identities):
            assert "security_invoker = true" in sql


def test_normal_ci_runs_full_supabase_reconstruction_checks():
    workflow = (ROOT / ".github" / "workflows" / "tests.yml").read_text()
    assert "pytest -q" in workflow
    assert "python scripts/supabase/validate_reconstruction.py --check-secrets ." in workflow


def test_ml_training_export_rpc_is_service_role_only():
    sql = (
        ROOT
        / "supabase"
        / "migrations"
        / "20260924084342_add_player_prop_training_export_rpc.sql"
    ).read_text().lower()
    assert "security invoker" in sql
    assert "revoke all on function public.export_player_prop_training_rows()" in sql
    assert "from public, anon, authenticated" in sql
    assert "grant execute on function public.export_player_prop_training_rows()" in sql
    assert "to service_role" in sql


def test_player_prop_feature_store_is_temporal_and_server_only():
    sql = (
        ROOT
        / "supabase"
        / "migrations"
        / "20260924091806_add_player_prop_feature_store.sql"
    ).read_text().lower()
    assert "security_invoker = true" in sql
    assert "feature_available_at < s.starts_at" in sql
    assert "enable row level security" in sql
    assert "mlb_pitchmix_feature_snapshots" in sql
    assert "service_role" in sql


def test_pitchmix_capture_is_scheduled_and_authenticated():
    config = tomllib.loads((ROOT / "supabase" / "config.toml").read_text())
    assert config["functions"]["capture-pitchmix-features"]["verify_jwt"] is True
    cron = json.loads(
        (ROOT / "supabase" / "manifests" / "cron-jobs.json").read_text()
    )
    match = [
        item for item in cron["items"]
        if item["jobname"] == "mlb-pitchmix-features-10min"
    ]
    assert len(match) == 1
    assert match[0]["schedule"] == "*/10 * * * *"
