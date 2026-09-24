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
