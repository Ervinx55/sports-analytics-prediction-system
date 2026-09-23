from __future__ import annotations

import importlib.util
import json
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
    items = manifest["items"]
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
