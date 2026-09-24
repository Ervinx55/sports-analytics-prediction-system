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
    assert "select_available_features(train)" in source
    assert "CORE_NUMERIC_FEATURES" in source
    assert "CORE_CATEGORICAL_FEATURES" in source

    walk_forward = (ROOT / "ml" / "walk_forward_player_prop.py").read_text()
    assert "select_available_features(train)" in walk_forward
    assert '"feature_coverage"' in walk_forward
