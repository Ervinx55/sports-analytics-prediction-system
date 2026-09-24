from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_feature_store_features_are_in_ml_preprocessor():
    source = (ROOT / "ml" / "train_player_prop_tensorflow.py").read_text()
    for feature in (
        "market_probability_move_pp",
        "batting_order_spot",
        "opposing_starter_hand",
        "own_bullpen_score",
        "weather_impact_multiplier",
        "temp_f",
        "wind_mph",
        "pitchmix_weighted_xwoba_delta",
        "feature_source_count",
    ):
        assert f'"{feature}"' in source

    assert "SimpleImputer" in source
    assert "add_indicator=True" in source
    assert "feature_available_at" in source
    assert 'df["decision_at"] < df["starts_at"]' in source


def test_exporter_requires_feature_timestamp_and_labels():
    source = (ROOT / "ml" / "export_player_prop_snapshot.py").read_text()
    assert '"feature_available_at"' in source
    assert '"won"' in source
    assert "REQUIRED_COLUMNS" in source


def test_sparse_enrichment_is_selected_from_training_window_only():
    source = (ROOT / "ml" / "train_player_prop_tensorflow.py").read_text()
    assert "MIN_ENRICHED_FEATURE_COVERAGE = 0.20" in source
    assert "select_available_features(model_train)" in source
    assert "CORE_NUMERIC_FEATURES" in source
    assert "CORE_CATEGORICAL_FEATURES" in source

    walk_forward = (ROOT / "ml" / "walk_forward_player_prop.py").read_text()
    assert "select_available_features(model_train)" in walk_forward
    assert '"feature_coverage"' in walk_forward


def test_market_specific_feature_policies_exist_and_are_applied():
    source = (ROOT / "ml" / "train_player_prop_tensorflow.py").read_text()
    assert 'MARKET_FEATURE_POLICY_VERSION = "mlb_prop_market_features_v2"' in source
    assert '"batting_hits"' in source
    assert '"batting_totalBases"' in source
    assert '"pitching_strikeouts"' in source
    assert '"hr_multiplier"' in source
    assert '"strikeout_opportunity_multiplier"' in source
    assert "def apply_market_feature_policy" in source
    assert "model_train = apply_market_feature_policy(train)" in source

    walk_forward = (ROOT / "ml" / "walk_forward_player_prop.py").read_text()
    assert "model_train = apply_market_feature_policy(train)" in walk_forward
    assert "aggregate_by_market" in walk_forward
    assert '"by_market"' in walk_forward


def test_hybrid_market_policy_preserves_broad_hitter_features():
    source = (ROOT / "ml" / "train_player_prop_tensorflow.py").read_text()
    assert '"batting_totalBases": {' in source
    assert '"numeric": ALL_ENRICHED_NUMERIC,' in source
    assert 'ALL_ENRICHED_NUMERIC - {"hr_multiplier"}' in source
    assert '"pitching_strikeouts": {' in source
    assert '"strikeout_opportunity_multiplier"' in source


def test_market_specialists_are_separate_from_universal_challenger():
    train = (ROOT / "ml" / "train_player_prop_tensorflow.py").read_text()
    assert "select_available_features(train)" in train
    assert "select_available_features(model_train)" not in train.split(
        "def main()"
    )[-1]

    walk_forward = (
        ROOT / "ml" / "walk_forward_player_prop.py"
    ).read_text()
    assert "def market_specialist_residual_predictions" in walk_forward
    assert "market_specialist_residual_probability" in walk_forward
    assert "apply_market_feature_policy(train_part)" in walk_forward
    assert "SPECIALIST_MIN_TRAIN_ROWS" in walk_forward
