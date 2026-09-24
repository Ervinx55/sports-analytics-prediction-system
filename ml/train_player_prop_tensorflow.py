"""Train the TensorFlow player-prop challenger in shadow mode.

The model is intentionally not production-authoritative. Promotion requires
broad chronological coverage and improvement over the current champion on a
held-out game-level test set.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from xgboost_challenger import select_xgboost_challenger


SEED = 42

NUMERIC_FEATURES = [
    "line",
    "model_mean",
    "raw_independent_probability",
    "model_probability",
    "push_probability",
    "market_fair_probability",
    "edge_pct_points",
    "best_odds",
    "exact_line_book_count",
    "paired_books",
    "ev_pct",
    "data_quality",
    "minutes_to_start",
]
CATEGORICAL_FEATURES = ["stat_id", "side"]

PROMOTION_POLICY = {
    "min_unique_events": 50,
    "min_coverage_days": 14.0,
    "min_unique_outcomes": 2000,
    "min_test_events": 10,
    "min_test_rows": 300,
    "min_brier_improvement": 0.003,
    "min_log_loss_improvement": 0.005,
    "max_ece_regression": 0.01,
    "min_walk_forward_folds": 5,
    "min_walk_forward_brier_win_rate": 0.60,
}


def clip_probability(values: np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(values, dtype=float), 1e-5, 1 - 1e-5)


def expected_calibration_error(
    y_true: np.ndarray,
    probs: np.ndarray,
    bins: int = 10,
) -> float:
    y = np.asarray(y_true, dtype=float)
    p = clip_probability(probs)
    edges = np.linspace(0.0, 1.0, bins + 1)
    total = len(y)
    if total == 0:
        return float("nan")
    ece = 0.0
    for i in range(bins):
        left, right = edges[i], edges[i + 1]
        if i == bins - 1:
            mask = (p >= left) & (p <= right)
        else:
            mask = (p >= left) & (p < right)
        count = int(mask.sum())
        if not count:
            continue
        ece += (count / total) * abs(float(y[mask].mean()) - float(p[mask].mean()))
    return float(ece)


def metrics(y_true: np.ndarray, probs: np.ndarray) -> dict[str, float]:
    p = clip_probability(probs)
    y = np.asarray(y_true, dtype=int)
    return {
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "ece": expected_calibration_error(y, p),
        "accuracy_50": float(accuracy_score(y, p >= 0.5)),
        "mean_probability": float(np.mean(p)),
        "win_rate": float(np.mean(y)),
    }


def load_training_frame(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    for col in [
        "captured_at",
        "starts_at",
    ]:
        df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")

    bool_map = {
        True: True,
        False: False,
        "true": True,
        "false": False,
        "True": True,
        "False": False,
        1: True,
        0: False,
        "1": True,
        "0": False,
    }
    df["won"] = df["won"].map(bool_map)
    df["pushed"] = df["pushed"].map(bool_map).fillna(False)

    for col in NUMERIC_FEATURES:
        if col == "minutes_to_start":
            continue
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df[
        df["won"].notna()
        & (~df["pushed"].astype(bool))
        & df["starts_at"].notna()
        & df["captured_at"].notna()
        & df["model_probability"].notna()
        & df["market_fair_probability"].notna()
    ].copy()

    # Strictly pregame only: no observation captured after scheduled start.
    df = df[df["captured_at"] < df["starts_at"]].copy()
    df["minutes_to_start"] = (
        (df["starts_at"] - df["captured_at"]).dt.total_seconds() / 60.0
    ).clip(lower=0.0, upper=24 * 60.0)

    df["event_key"] = df["game_pk"].fillna(df["event_id"]).astype(str)
    df["outcome_key"] = (
        df["event_id"].astype(str)
        + "|"
        + df["player_id"].astype(str)
        + "|"
        + df["stat_id"].astype(str)
        + "|"
        + df["line"].astype(str)
        + "|"
        + df["side"].astype(str)
    )

    # One pregame decision snapshot per actual prop outcome prevents repeated
    # snapshots of the same result from dominating training/evaluation.
    df = (
        df.sort_values(["outcome_key", "captured_at", "observation_id"])
        .groupby("outcome_key", as_index=False)
        .tail(1)
        .sort_values(["starts_at", "captured_at", "observation_id"])
        .reset_index(drop=True)
    )
    df["target"] = df["won"].astype(int)
    return df


def split_by_event(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    event_order = (
        df.groupby("event_key", as_index=False)["starts_at"]
        .min()
        .sort_values("starts_at")
        ["event_key"]
        .tolist()
    )
    n = len(event_order)
    if n < 5:
        raise ValueError(f"Need at least 5 distinct events to run shadow training; found {n}.")

    n_test = max(1, int(round(n * 0.2)))
    n_val = max(1, int(round(n * 0.2)))
    if n - n_test - n_val < 2:
        n_val = 1
        n_test = 1

    train_events = set(event_order[: n - n_val - n_test])
    val_events = set(event_order[n - n_val - n_test : n - n_test])
    test_events = set(event_order[n - n_test :])

    train = df[df["event_key"].isin(train_events)].copy()
    val = df[df["event_key"].isin(val_events)].copy()
    test = df[df["event_key"].isin(test_events)].copy()

    for name, part in [("train", train), ("validation", val), ("test", test)]:
        if part.empty:
            raise ValueError(f"{name} split is empty.")
    return train, val, test


def build_preprocessor() -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            (
                "numeric",
                Pipeline(
                    steps=[
                        ("scale", StandardScaler()),
                    ]
                ),
                NUMERIC_FEATURES,
            ),
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                CATEGORICAL_FEATURES,
            ),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def build_tensorflow_model(input_dim: int) -> tf.keras.Model:
    regularizer = tf.keras.regularizers.l2(1e-3)
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(input_dim,)),
            tf.keras.layers.Dense(16, activation="relu", kernel_regularizer=regularizer),
            tf.keras.layers.Dropout(0.10),
            tf.keras.layers.Dense(8, activation="relu", kernel_regularizer=regularizer),
            tf.keras.layers.Dense(1, activation="sigmoid"),
        ],
        name="player_prop_tf_shadow",
    )
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="binary_crossentropy",
        metrics=[tf.keras.metrics.BinaryAccuracy(name="accuracy")],
    )
    return model


def best_ensemble_weight(
    y_val: np.ndarray,
    champion: np.ndarray,
    challenger: np.ndarray,
) -> tuple[float, dict[str, float]]:
    best_weight = 0.0
    best_score = float("inf")
    best_metrics = metrics(y_val, champion)

    for weight in np.linspace(0.0, 0.5, 11):
        blended = (1.0 - weight) * champion + weight * challenger
        m = metrics(y_val, blended)
        objective = m["brier"] + 0.25 * m["log_loss"]
        if objective < best_score:
            best_score = objective
            best_weight = float(weight)
            best_metrics = m
    return best_weight, best_metrics


def promotion_decision(
    frame: pd.DataFrame,
    test: pd.DataFrame,
    champion_metrics: dict[str, float],
    ensemble_metrics: dict[str, float],
    walk_forward: dict | None = None,
) -> dict:
    coverage_days = max(
        0.0,
        (frame["starts_at"].max() - frame["starts_at"].min()).total_seconds()
        / 86400.0,
    )
    unique_events = int(frame["event_key"].nunique())
    unique_outcomes = int(frame["outcome_key"].nunique())
    test_events = int(test["event_key"].nunique())
    test_rows = int(len(test))

    evaluation_champion = champion_metrics
    evaluation_ensemble = ensemble_metrics
    walk_forward_folds = 0
    walk_forward_brier_win_rate = 0.0
    evaluation_source = "single_holdout"

    if walk_forward:
        aggregate = walk_forward.get("aggregate", {})
        wf_champion = aggregate.get("champion")
        wf_ensemble = aggregate.get("ensemble")
        if wf_champion and wf_ensemble:
            evaluation_champion = wf_champion
            evaluation_ensemble = wf_ensemble
            coverage = walk_forward.get("coverage", {})
            test_events = int(coverage.get("test_events", test_events))
            test_rows = int(coverage.get("test_rows", test_rows))
            walk_forward_folds = int(walk_forward.get("fold_count", 0))
            walk_forward_brier_win_rate = float(
                walk_forward.get("fold_brier_win_rate", 0.0)
            )
            evaluation_source = "walk_forward"

    brier_improvement = (
        evaluation_champion["brier"] - evaluation_ensemble["brier"]
    )
    log_loss_improvement = (
        evaluation_champion["log_loss"] - evaluation_ensemble["log_loss"]
    )
    ece_regression = (
        evaluation_ensemble["ece"] - evaluation_champion["ece"]
    )

    checks = {
        "unique_events": {
            "actual": unique_events,
            "required": PROMOTION_POLICY["min_unique_events"],
            "pass": unique_events >= PROMOTION_POLICY["min_unique_events"],
        },
        "coverage_days": {
            "actual": round(coverage_days, 3),
            "required": PROMOTION_POLICY["min_coverage_days"],
            "pass": coverage_days >= PROMOTION_POLICY["min_coverage_days"],
        },
        "unique_outcomes": {
            "actual": unique_outcomes,
            "required": PROMOTION_POLICY["min_unique_outcomes"],
            "pass": unique_outcomes >= PROMOTION_POLICY["min_unique_outcomes"],
        },
        "test_events": {
            "actual": test_events,
            "required": PROMOTION_POLICY["min_test_events"],
            "pass": test_events >= PROMOTION_POLICY["min_test_events"],
        },
        "test_rows": {
            "actual": test_rows,
            "required": PROMOTION_POLICY["min_test_rows"],
            "pass": test_rows >= PROMOTION_POLICY["min_test_rows"],
        },
        "brier_improvement": {
            "actual": round(brier_improvement, 6),
            "required": PROMOTION_POLICY["min_brier_improvement"],
            "pass": brier_improvement >= PROMOTION_POLICY["min_brier_improvement"],
        },
        "log_loss_improvement": {
            "actual": round(log_loss_improvement, 6),
            "required": PROMOTION_POLICY["min_log_loss_improvement"],
            "pass": log_loss_improvement
            >= PROMOTION_POLICY["min_log_loss_improvement"],
        },
        "ece_regression": {
            "actual": round(ece_regression, 6),
            "maximum": PROMOTION_POLICY["max_ece_regression"],
            "pass": ece_regression <= PROMOTION_POLICY["max_ece_regression"],
        },
        "walk_forward_folds": {
            "actual": walk_forward_folds,
            "required": PROMOTION_POLICY["min_walk_forward_folds"],
            "pass": (
                evaluation_source == "walk_forward"
                and walk_forward_folds
                >= PROMOTION_POLICY["min_walk_forward_folds"]
            ),
        },
        "walk_forward_brier_win_rate": {
            "actual": round(walk_forward_brier_win_rate, 4),
            "required": PROMOTION_POLICY[
                "min_walk_forward_brier_win_rate"
            ],
            "pass": (
                evaluation_source == "walk_forward"
                and walk_forward_brier_win_rate
                >= PROMOTION_POLICY["min_walk_forward_brier_win_rate"]
            ),
        },
    }
    eligible = all(check["pass"] for check in checks.values())
    return {
        "mode": "SHADOW",
        "eligible_for_production": eligible,
        "evaluation_source": evaluation_source,
        "checks": checks,
        "policy": PROMOTION_POLICY,
        "reason": (
            "All promotion gates passed."
            if eligible
            else "Shadow only: one or more coverage/performance gates failed."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--walk-forward-report",
        default="",
        help="Optional walk-forward metrics JSON; required for promotion eligibility.",
    )
    args = parser.parse_args()

    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    tf.keras.utils.set_random_seed(SEED)
    np.random.seed(SEED)

    data_path = Path(args.data)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    walk_forward = None
    if args.walk_forward_report:
        report_path = Path(args.walk_forward_report)
        if report_path.exists():
            walk_forward = json.loads(report_path.read_text(encoding="utf-8"))

    frame = load_training_frame(data_path)
    train, val, test = split_by_event(frame)

    preprocessor = build_preprocessor()
    x_train = preprocessor.fit_transform(train)
    x_val = preprocessor.transform(val)
    x_test = preprocessor.transform(test)

    y_train = train["target"].to_numpy(dtype=np.float32)
    y_val = val["target"].to_numpy(dtype=np.float32)
    y_test = test["target"].to_numpy(dtype=np.float32)

    model = build_tensorflow_model(x_train.shape[1])

    positive = float(y_train.sum())
    negative = float(len(y_train) - positive)
    class_weight = None
    if positive > 0 and negative > 0:
        total = positive + negative
        class_weight = {
            0: total / (2.0 * negative),
            1: total / (2.0 * positive),
        }

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=20,
            min_delta=1e-4,
            restore_best_weights=True,
        )
    ]
    history = model.fit(
        x_train.astype(np.float32),
        y_train,
        validation_data=(x_val.astype(np.float32), y_val),
        epochs=200,
        batch_size=min(64, max(16, len(train))),
        verbose=0,
        callbacks=callbacks,
        class_weight=class_weight,
    )

    tf_val = model.predict(x_val.astype(np.float32), verbose=0).reshape(-1)
    tf_test = model.predict(x_test.astype(np.float32), verbose=0).reshape(-1)

    champion_val = clip_probability(val["model_probability"].to_numpy(float))
    champion_test = clip_probability(test["model_probability"].to_numpy(float))
    market_test = clip_probability(test["market_fair_probability"].to_numpy(float))

    xgb_selection = select_xgboost_challenger(
        x_train,
        y_train,
        x_val,
        y_val,
        champion_val,
        seed=SEED,
    )
    xgb_test = xgb_selection.model.predict_proba(x_test)[:, 1]
    xgb_ensemble_test = (
        (1.0 - xgb_selection.blend_weight) * champion_test
        + xgb_selection.blend_weight * xgb_test
    )

    # Simple linear sanity challenger. Complex models must justify complexity.
    logistic = LogisticRegression(
        C=0.5,
        max_iter=2000,
        random_state=SEED,
    )
    logistic.fit(x_train, y_train.astype(int))
    logistic_test = logistic.predict_proba(x_test)[:, 1]

    ensemble_weight, validation_ensemble_metrics = best_ensemble_weight(
        y_val,
        champion_val,
        tf_val,
    )
    ensemble_test = (
        (1.0 - ensemble_weight) * champion_test
        + ensemble_weight * tf_test
    )

    test_metrics = {
        "champion": metrics(y_test, champion_test),
        "market": metrics(y_test, market_test),
        "logistic": metrics(y_test, logistic_test),
        "tensorflow": metrics(y_test, tf_test),
        "tensorflow_ensemble": metrics(y_test, ensemble_test),
        "xgboost": metrics(y_test, xgb_test),
        "xgboost_ensemble": metrics(y_test, xgb_ensemble_test),
        "ensemble": metrics(y_test, ensemble_test),
    }

    promotion = promotion_decision(
        frame,
        test,
        test_metrics["champion"],
        test_metrics["ensemble"],
        walk_forward=walk_forward,
    )

    coverage_days = (
        (frame["starts_at"].max() - frame["starts_at"].min()).total_seconds()
        / 86400.0
    )
    report = {
        "model": "player_prop_tensorflow_shadow_v1",
        "mode": "SHADOW",
        "tensorflow_version": tf.__version__,
        "rows": {
            "raw": int(pd.read_csv(data_path).shape[0]),
            "deduped_pregame": int(len(frame)),
            "train": int(len(train)),
            "validation": int(len(val)),
            "test": int(len(test)),
        },
        "coverage": {
            "unique_events": int(frame["event_key"].nunique()),
            "unique_outcomes": int(frame["outcome_key"].nunique()),
            "unique_players": int(frame["player_id"].nunique()),
            "coverage_days": round(float(coverage_days), 3),
            "first_start": frame["starts_at"].min().isoformat(),
            "last_start": frame["starts_at"].max().isoformat(),
            "test_events": int(test["event_key"].nunique()),
        },
        "features": {
            "numeric": NUMERIC_FEATURES,
            "categorical": CATEGORICAL_FEATURES,
            "transformed_dimension": int(x_train.shape[1]),
        },
        "training": {
            "epochs_ran": int(len(history.history.get("loss", []))),
            "best_validation_loss": float(
                min(history.history.get("val_loss", [math.nan]))
            ),
        },
        "ensemble": {
            "tensorflow_weight": ensemble_weight,
            "champion_weight": 1.0 - ensemble_weight,
            "validation_metrics": validation_ensemble_metrics,
        },
        "xgboost_challenger": {
            "params": xgb_selection.params,
            "xgboost_weight": xgb_selection.blend_weight,
            "champion_weight": 1.0 - xgb_selection.blend_weight,
            "validation_metrics": xgb_selection.validation_metrics,
            "validation_blend_metrics": xgb_selection.blend_metrics,
        },
        "test_metrics": test_metrics,
        "promotion": promotion,
        "walk_forward": walk_forward,
    }

    predictions = test[
        [
            "observation_id",
            "event_id",
            "game_pk",
            "player_id",
            "stat_id",
            "line",
            "side",
            "target",
        ]
    ].copy()
    predictions["champion_probability"] = champion_test
    predictions["tensorflow_probability"] = tf_test
    predictions["ensemble_probability"] = ensemble_test
    predictions["xgboost_probability"] = xgb_test
    predictions["xgboost_ensemble_probability"] = xgb_ensemble_test
    predictions["market_probability"] = market_test
    predictions.to_csv(output_dir / "shadow_predictions.csv", index=False)

    model.save(output_dir / "model.keras")
    joblib.dump(preprocessor, output_dir / "preprocessor.joblib")
    joblib.dump(logistic, output_dir / "logistic_sanity.joblib")
    xgb_selection.model.save_model(output_dir / "xgboost_challenger.json")

    numeric_scaler = (
        preprocessor.named_transformers_["numeric"]
        .named_steps["scale"]
    )
    categorical_encoder = preprocessor.named_transformers_["categorical"]

    dense_layers = []
    for layer in model.layers:
        weights = layer.get_weights()
        if len(weights) != 2:
            continue
        dense_layers.append(
            {
                "name": layer.name,
                "activation": layer.activation.__name__,
                "kernel": np.asarray(weights[0], dtype=float).round(10).tolist(),
                "bias": np.asarray(weights[1], dtype=float).round(10).tolist(),
            }
        )

    inference_bundle = {
        "model": report["model"],
        "mode": "SHADOW",
        "eligibleForProduction": bool(
            promotion["eligible_for_production"]
        ),
        "productionWeight": (
            float(ensemble_weight)
            if promotion["eligible_for_production"]
            else 0.0
        ),
        "selectedValidationWeight": float(ensemble_weight),
        "numericFeatures": NUMERIC_FEATURES,
        "numericMean": np.asarray(
            numeric_scaler.mean_, dtype=float
        ).round(10).tolist(),
        "numericScale": np.asarray(
            numeric_scaler.scale_, dtype=float
        ).round(10).tolist(),
        "categoricalFeatures": CATEGORICAL_FEATURES,
        "categoricalCategories": [
            [str(value) for value in values]
            for values in categorical_encoder.categories_
        ],
        "layers": dense_layers,
        "coverage": report["coverage"],
        "promotion": promotion,
        "testMetrics": test_metrics,
    }
    bundle_text = json.dumps(
        inference_bundle,
        separators=(",", ":"),
        sort_keys=True,
    )
    (output_dir / "inference_bundle.json").write_text(
        json.dumps(inference_bundle, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    (output_dir / "metrics.json").write_text(
        json.dumps(report, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    summary_lines = [
        "# TensorFlow Player-Prop Shadow Model",
        "",
        f"- Mode: **SHADOW**",
        f"- TensorFlow: {tf.__version__}",
        f"- Deduped pregame outcomes: {len(frame)}",
        f"- Distinct games: {frame['event_key'].nunique()}",
        f"- Coverage: {coverage_days:.3f} days",
        f"- Test rows: {len(test)} across {test['event_key'].nunique()} games",
        f"- Champion Brier: {test_metrics['champion']['brier']:.6f}",
        f"- TensorFlow Brier: {test_metrics['tensorflow']['brier']:.6f}",
        f"- TF ensemble Brier: {test_metrics['tensorflow_ensemble']['brier']:.6f}",
        f"- XGBoost Brier: {test_metrics['xgboost']['brier']:.6f}",
        f"- XGB ensemble Brier: {test_metrics['xgboost_ensemble']['brier']:.6f}",
        f"- Ensemble Brier: {test_metrics['ensemble']['brier']:.6f}",
        f"- Champion log loss: {test_metrics['champion']['log_loss']:.6f}",
        f"- TensorFlow log loss: {test_metrics['tensorflow']['log_loss']:.6f}",
        f"- TF ensemble log loss: {test_metrics['tensorflow_ensemble']['log_loss']:.6f}",
        f"- XGBoost log loss: {test_metrics['xgboost']['log_loss']:.6f}",
        f"- XGB ensemble log loss: {test_metrics['xgboost_ensemble']['log_loss']:.6f}",
        f"- Ensemble log loss: {test_metrics['ensemble']['log_loss']:.6f}",
        f"- Selected TensorFlow ensemble weight: {ensemble_weight:.2f}",
        f"- Selected XGBoost ensemble weight: {xgb_selection.blend_weight:.2f}",
        f"- Eligible for production: **{promotion['eligible_for_production']}**",
        "",
        "Promotion remains blocked until every coverage and performance gate passes.",
    ]
    (output_dir / "summary.md").write_text(
        "\n".join(summary_lines) + "\n",
        encoding="utf-8",
    )

    compact = {
        "eligible_for_production": promotion["eligible_for_production"],
        "unique_events": report["coverage"]["unique_events"],
        "coverage_days": report["coverage"]["coverage_days"],
        "unique_outcomes": report["coverage"]["unique_outcomes"],
        "test_metrics": test_metrics,
        "tensorflow_weight": ensemble_weight,
        "failed_gates": [
            name
            for name, check in promotion["checks"].items()
            if not check["pass"]
        ],
    }
    print("ML_SHADOW_SUMMARY=" + json.dumps(compact, sort_keys=True))
    bundle_b64 = base64.b64encode(bundle_text.encode("utf-8")).decode("ascii")
    print("ML_SHADOW_BUNDLE_B64=" + bundle_b64)


if __name__ == "__main__":
    main()
