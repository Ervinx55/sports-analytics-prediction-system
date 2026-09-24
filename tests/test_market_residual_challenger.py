from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_market_residual_targets_market_error_not_raw_outcome_probability():
    source = (ROOT / "ml" / "market_residual_challenger.py").read_text()
    assert "y_train" in source
    assert "- np.asarray(market_train" in source
    assert "MAX_ABS_CORRECTION = 0.20" in source
    assert "SHRINKAGE_GRID" in source


def test_walk_forward_scores_residual_against_market():
    source = (ROOT / "ml" / "walk_forward_player_prop.py").read_text()
    assert '"market_residual"' in source
    assert '"market_residual_fold_brier_win_rate"' in source
    assert "select_market_residual_challenger" in source


def test_final_training_exports_residual_artifact():
    source = (ROOT / "ml" / "train_player_prop_tensorflow.py").read_text()
    assert "market_residual_challenger.json" in source
    assert '"market_residual_challenger"' in source
    assert "Selected market-residual shrinkage" in source
