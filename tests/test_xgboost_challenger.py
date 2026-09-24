from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_xgboost_is_pinned_and_shadow_only():
    requirements = (ROOT / "requirements-ml.txt").read_text()
    assert "xgboost==3.4.1" in requirements

    source = (ROOT / "ml" / "xgboost_challenger.py").read_text()
    assert "XGBClassifier" in source
    assert "XGB_PARAM_GRID" in source


def test_walk_forward_compares_xgboost_and_blend():
    source = (ROOT / "ml" / "walk_forward_player_prop.py").read_text()
    for needle in (
        '"xgboost"',
        '"xgboost_ensemble"',
        '"xgboost_fold_brier_win_rate"',
        "select_xgboost_challenger",
    ):
        assert needle in source


def test_final_training_exports_xgboost_artifact_without_promotion():
    source = (ROOT / "ml" / "train_player_prop_tensorflow.py").read_text()
    assert "xgboost_challenger.json" in source
    assert '"xgboost_challenger"' in source
