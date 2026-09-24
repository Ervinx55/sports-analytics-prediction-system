from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_ml_workflow_runs_walk_forward_before_training():
    workflow = (
        ROOT / ".github" / "workflows" / "ml-shadow.yml"
    ).read_text()
    assert "walk_forward_player_prop.py" in workflow
    assert "--walk-forward-report" in workflow
    assert 'cron: "17 10 * * *"' in workflow


def test_promotion_requires_walk_forward_evidence():
    source = (
        ROOT / "ml" / "train_player_prop_tensorflow.py"
    ).read_text()
    assert '"min_walk_forward_folds": 5' in source
    assert '"min_walk_forward_brier_win_rate": 0.60' in source
    assert 'evaluation_source == "walk_forward"' in source


def test_live_snapshot_export_is_not_public():
    migration = (
        ROOT
        / "supabase"
        / "migrations"
        / "20260924084342_add_player_prop_training_export_rpc.sql"
    ).read_text().lower()
    assert "security invoker" in migration
    assert "from public, anon, authenticated" in migration
    assert "to service_role" in migration
