"""Expanding-window walk-forward evaluation for the player-prop challenger.

Each fold trains only on games that occurred before the test block. The latest
past games are reserved for validation and ensemble-weight selection. No event
appears in more than one split within a fold.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.linear_model import LogisticRegression

from xgboost_challenger import select_xgboost_challenger
from market_residual_challenger import (
    corrected_probability as residual_corrected_probability,
    correction_from_model as residual_correction_from_model,
    select_market_residual_challenger,
)

from train_player_prop_tensorflow import (
    SEED,
    best_ensemble_weight,
    build_preprocessor,
    build_tensorflow_model,
    clip_probability,
    load_training_frame,
    metrics,
)


def event_order(frame: pd.DataFrame) -> list[str]:
    return (
        frame.groupby("event_key", as_index=False)["starts_at"]
        .min()
        .sort_values(["starts_at", "event_key"])["event_key"]
        .tolist()
    )


def class_weights(y: np.ndarray) -> dict[int, float] | None:
    positive = float(np.sum(y))
    negative = float(len(y) - positive)
    if positive <= 0 or negative <= 0:
        return None
    total = positive + negative
    return {
        0: total / (2.0 * negative),
        1: total / (2.0 * positive),
    }


def fold_layout(events: list[str]) -> list[dict]:
    n = len(events)
    if n < 5:
        raise ValueError(
            f"Need at least 5 distinct games for walk-forward evaluation; found {n}."
        )

    min_train_events = max(4, min(10, n // 2))
    test_block_events = max(1, min(5, n // 10 or 1))
    folds = []

    test_start = min_train_events
    fold_id = 1
    while test_start < n:
        history = events[:test_start]
        validation_count = max(1, min(3, int(round(len(history) * 0.2))))
        core_train = history[:-validation_count]
        validation = history[-validation_count:]
        test = events[test_start : test_start + test_block_events]
        if len(core_train) < 3 or not test:
            break
        folds.append(
            {
                "fold": fold_id,
                "train_events": core_train,
                "validation_events": validation,
                "test_events": test,
            }
        )
        fold_id += 1
        test_start += test_block_events

    if not folds:
        raise ValueError("No valid walk-forward folds could be constructed.")
    return folds


def train_fold(
    frame: pd.DataFrame,
    layout: dict,
    output_predictions: list[pd.DataFrame],
) -> dict:
    train = frame[frame["event_key"].isin(layout["train_events"])].copy()
    validation = frame[
        frame["event_key"].isin(layout["validation_events"])
    ].copy()
    test = frame[frame["event_key"].isin(layout["test_events"])].copy()

    preprocessor = build_preprocessor()
    x_train = preprocessor.fit_transform(train)
    x_validation = preprocessor.transform(validation)
    x_test = preprocessor.transform(test)

    y_train = train["target"].to_numpy(dtype=np.float32)
    y_validation = validation["target"].to_numpy(dtype=np.float32)
    y_test = test["target"].to_numpy(dtype=np.float32)

    tf.keras.backend.clear_session()
    tf.keras.utils.set_random_seed(SEED + int(layout["fold"]))
    model = build_tensorflow_model(x_train.shape[1])
    history = model.fit(
        x_train.astype(np.float32),
        y_train,
        validation_data=(x_validation.astype(np.float32), y_validation),
        epochs=100,
        batch_size=min(64, max(16, len(train))),
        verbose=0,
        class_weight=class_weights(y_train),
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                monitor="val_loss",
                patience=10,
                min_delta=1e-4,
                restore_best_weights=True,
            )
        ],
    )

    tf_validation = model.predict(
        x_validation.astype(np.float32), verbose=0
    ).reshape(-1)
    tf_test = model.predict(
        x_test.astype(np.float32), verbose=0
    ).reshape(-1)

    champion_validation = clip_probability(
        validation["model_probability"].to_numpy(float)
    )
    champion_test = clip_probability(
        test["model_probability"].to_numpy(float)
    )
    market_train = clip_probability(
        train["market_fair_probability"].to_numpy(float)
    )
    market_validation = clip_probability(
        validation["market_fair_probability"].to_numpy(float)
    )
    market_test = clip_probability(
        test["market_fair_probability"].to_numpy(float)
    )

    weight, validation_ensemble = best_ensemble_weight(
        y_validation,
        champion_validation,
        tf_validation,
    )
    ensemble_test = (1.0 - weight) * champion_test + weight * tf_test

    xgb_selection = select_xgboost_challenger(
        x_train,
        y_train,
        x_validation,
        y_validation,
        champion_validation,
        seed=SEED + int(layout["fold"]),
    )
    xgb_test = xgb_selection.model.predict_proba(x_test)[:, 1]
    xgb_ensemble_test = (
        (1.0 - xgb_selection.blend_weight) * champion_test
        + xgb_selection.blend_weight * xgb_test
    )

    residual_selection = select_market_residual_challenger(
        x_train,
        y_train,
        market_train,
        x_validation,
        y_validation,
        market_validation,
        seed=SEED + int(layout["fold"]),
    )
    residual_correction_test = residual_correction_from_model(
        residual_selection.model,
        x_test,
    )
    residual_raw_test = residual_corrected_probability(
        market_test,
        residual_correction_test,
        1.0,
    )
    residual_test = residual_corrected_probability(
        market_test,
        residual_correction_test,
        residual_selection.shrinkage,
    )

    logistic = LogisticRegression(
        C=0.5,
        max_iter=2000,
        random_state=SEED + int(layout["fold"]),
    )
    logistic.fit(x_train, y_train.astype(int))
    logistic_test = logistic.predict_proba(x_test)[:, 1]

    fold_metrics = {
        "champion": metrics(y_test, champion_test),
        "market": metrics(y_test, market_test),
        "logistic": metrics(y_test, logistic_test),
        "tensorflow": metrics(y_test, tf_test),
        "tensorflow_ensemble": metrics(y_test, ensemble_test),
        "xgboost": metrics(y_test, xgb_test),
        "xgboost_ensemble": metrics(y_test, xgb_ensemble_test),
        "market_residual_raw": metrics(y_test, residual_raw_test),
        "market_residual": metrics(y_test, residual_test),
        "ensemble": metrics(y_test, ensemble_test),
    }

    pred = test[
        [
            "observation_id",
            "event_id",
            "game_pk",
            "player_id",
            "stat_id",
            "line",
            "side",
            "target",
            "starts_at",
        ]
    ].copy()
    pred["fold"] = int(layout["fold"])
    pred["champion_probability"] = champion_test
    pred["market_probability"] = market_test
    pred["tensorflow_probability"] = tf_test
    pred["logistic_probability"] = logistic_test
    pred["ensemble_probability"] = ensemble_test
    pred["tensorflow_weight"] = weight
    pred["xgboost_probability"] = xgb_test
    pred["xgboost_ensemble_probability"] = xgb_ensemble_test
    pred["xgboost_weight"] = xgb_selection.blend_weight
    pred["market_residual_correction"] = residual_correction_test
    pred["market_residual_raw_probability"] = residual_raw_test
    pred["market_residual_probability"] = residual_test
    pred["market_residual_shrinkage"] = residual_selection.shrinkage
    output_predictions.append(pred)

    return {
        "fold": int(layout["fold"]),
        "train_events": len(layout["train_events"]),
        "validation_events": len(layout["validation_events"]),
        "test_events": len(layout["test_events"]),
        "train_rows": int(len(train)),
        "validation_rows": int(len(validation)),
        "test_rows": int(len(test)),
        "tensorflow_weight": float(weight),
        "xgboost_weight": float(xgb_selection.blend_weight),
        "xgboost_params": xgb_selection.params,
        "market_residual_shrinkage":
            float(residual_selection.shrinkage),
        "market_residual_params": residual_selection.params,
        "market_residual_validation":
            residual_selection.validation_metrics,
        "market_residual_mean_abs_correction":
            residual_selection.mean_abs_correction,
        "epochs_ran": int(len(history.history.get("loss", []))),
        "validation_ensemble": validation_ensemble,
        "xgboost_validation": xgb_selection.validation_metrics,
        "xgboost_validation_blend": xgb_selection.blend_metrics,
        "metrics": fold_metrics,
    }


def aggregate_predictions(predictions: pd.DataFrame) -> dict:
    y = predictions["target"].to_numpy(dtype=int)
    return {
        "champion": metrics(y, predictions["champion_probability"]),
        "market": metrics(y, predictions["market_probability"]),
        "logistic": metrics(y, predictions["logistic_probability"]),
        "tensorflow": metrics(y, predictions["tensorflow_probability"]),
        "tensorflow_ensemble": metrics(y, predictions["ensemble_probability"]),
        "xgboost": metrics(y, predictions["xgboost_probability"]),
        "xgboost_ensemble": metrics(
            y, predictions["xgboost_ensemble_probability"]
        ),
        "market_residual_raw": metrics(
            y, predictions["market_residual_raw_probability"]
        ),
        "market_residual": metrics(
            y, predictions["market_residual_probability"]
        ),
        "ensemble": metrics(y, predictions["ensemble_probability"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    np.random.seed(SEED)
    tf.keras.utils.set_random_seed(SEED)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    frame = load_training_frame(Path(args.data))
    events = event_order(frame)
    layouts = fold_layout(events)

    fold_reports = []
    prediction_parts: list[pd.DataFrame] = []
    for layout in layouts:
        fold_reports.append(
            train_fold(frame, layout, prediction_parts)
        )

    predictions = pd.concat(prediction_parts, ignore_index=True)
    aggregate = aggregate_predictions(predictions)

    brier_wins = sum(
        1
        for fold in fold_reports
        if fold["metrics"]["ensemble"]["brier"]
        < fold["metrics"]["champion"]["brier"]
    )
    log_loss_wins = sum(
        1
        for fold in fold_reports
        if fold["metrics"]["ensemble"]["log_loss"]
        < fold["metrics"]["champion"]["log_loss"]
    )
    xgb_brier_wins = sum(
        1
        for fold in fold_reports
        if fold["metrics"]["xgboost_ensemble"]["brier"]
        < fold["metrics"]["champion"]["brier"]
    )
    xgb_log_loss_wins = sum(
        1
        for fold in fold_reports
        if fold["metrics"]["xgboost_ensemble"]["log_loss"]
        < fold["metrics"]["champion"]["log_loss"]
    )
    residual_brier_wins = sum(
        1
        for fold in fold_reports
        if fold["metrics"]["market_residual"]["brier"]
        < fold["metrics"]["market"]["brier"]
    )
    residual_log_loss_wins = sum(
        1
        for fold in fold_reports
        if fold["metrics"]["market_residual"]["log_loss"]
        < fold["metrics"]["market"]["log_loss"]
    )

    report = {
        "mode": "WALK_FORWARD",
        "fold_count": len(fold_reports),
        "fold_brier_win_rate": brier_wins / len(fold_reports),
        "fold_log_loss_win_rate": log_loss_wins / len(fold_reports),
        "xgboost_fold_brier_win_rate":
            xgb_brier_wins / len(fold_reports),
        "xgboost_fold_log_loss_win_rate":
            xgb_log_loss_wins / len(fold_reports),
        "market_residual_fold_brier_win_rate":
            residual_brier_wins / len(fold_reports),
        "market_residual_fold_log_loss_win_rate":
            residual_log_loss_wins / len(fold_reports),
        "coverage": {
            "unique_events": int(frame["event_key"].nunique()),
            "unique_outcomes": int(frame["outcome_key"].nunique()),
            "coverage_days": round(
                (
                    frame["starts_at"].max() - frame["starts_at"].min()
                ).total_seconds()
                / 86400.0,
                3,
            ),
            "test_events": int(predictions["event_id"].nunique()),
            "test_rows": int(len(predictions)),
            "first_test_start": predictions["starts_at"].min().isoformat(),
            "last_test_start": predictions["starts_at"].max().isoformat(),
        },
        "aggregate": aggregate,
        "folds": fold_reports,
    }

    predictions.to_csv(
        output_dir / "walk_forward_predictions.csv",
        index=False,
    )
    (output_dir / "metrics.json").write_text(
        json.dumps(report, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    brier_improvement = (
        aggregate["champion"]["brier"] - aggregate["ensemble"]["brier"]
    )
    log_loss_improvement = (
        aggregate["champion"]["log_loss"]
        - aggregate["ensemble"]["log_loss"]
    )
    summary = [
        "# Player-Prop Walk-Forward Evaluation",
        "",
        f"- Folds: **{len(fold_reports)}**",
        f"- Walk-forward test rows: **{len(predictions)}**",
        f"- Walk-forward test events: **{report['coverage']['test_events']}**",
        f"- Champion Brier: {aggregate['champion']['brier']:.6f}",
        f"- TensorFlow Brier: {aggregate['tensorflow']['brier']:.6f}",
        f"- TF ensemble Brier: {aggregate['tensorflow_ensemble']['brier']:.6f}",
        f"- XGBoost Brier: {aggregate['xgboost']['brier']:.6f}",
        f"- XGB ensemble Brier: {aggregate['xgboost_ensemble']['brier']:.6f}",
        f"- Market residual Brier: {aggregate['market_residual']['brier']:.6f}",
        f"- Market Brier: {aggregate['market']['brier']:.6f}",
        f"- Brier improvement vs champion: {brier_improvement:+.6f}",
        f"- Champion log loss: {aggregate['champion']['log_loss']:.6f}",
        f"- TensorFlow log loss: {aggregate['tensorflow']['log_loss']:.6f}",
        f"- TF ensemble log loss: {aggregate['tensorflow_ensemble']['log_loss']:.6f}",
        f"- XGBoost log loss: {aggregate['xgboost']['log_loss']:.6f}",
        f"- XGB ensemble log loss: {aggregate['xgboost_ensemble']['log_loss']:.6f}",
        f"- Market residual log loss: {aggregate['market_residual']['log_loss']:.6f}",
        f"- Log-loss improvement vs champion: {log_loss_improvement:+.6f}",
        f"- TF ensemble Brier fold win rate: {report['fold_brier_win_rate']:.1%}",
        f"- XGB ensemble Brier fold win rate: {report['xgboost_fold_brier_win_rate']:.1%}",
        f"- Residual vs market Brier fold win rate: {report['market_residual_fold_brier_win_rate']:.1%}",
        "",
        "Every test prediction was generated by a model trained only on earlier games.",
    ]
    (output_dir / "summary.md").write_text(
        "\n".join(summary) + "\n",
        encoding="utf-8",
    )

    compact = {
        "fold_count": report["fold_count"],
        "test_rows": report["coverage"]["test_rows"],
        "test_events": report["coverage"]["test_events"],
        "fold_brier_win_rate": report["fold_brier_win_rate"],
        "xgboost_fold_brier_win_rate":
            report["xgboost_fold_brier_win_rate"],
        "market_residual_fold_brier_win_rate":
            report["market_residual_fold_brier_win_rate"],
        "aggregate": aggregate,
    }
    print("WALK_FORWARD_SUMMARY=" + json.dumps(compact, sort_keys=True))


if __name__ == "__main__":
    main()
