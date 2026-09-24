"""XGBoost challenger utilities for leakage-safe player-prop evaluation."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from xgboost import XGBClassifier

from train_player_prop_tensorflow import best_ensemble_weight, metrics


@dataclass(frozen=True)
class XGBSelection:
    model: XGBClassifier
    params: dict
    validation_metrics: dict
    blend_weight: float
    blend_metrics: dict


XGB_PARAM_GRID = [
    {
        "n_estimators": 120,
        "max_depth": 2,
        "learning_rate": 0.03,
        "min_child_weight": 8.0,
        "subsample": 0.85,
        "colsample_bytree": 0.85,
        "reg_lambda": 3.0,
        "reg_alpha": 0.15,
    },
    {
        "n_estimators": 180,
        "max_depth": 2,
        "learning_rate": 0.02,
        "min_child_weight": 10.0,
        "subsample": 0.80,
        "colsample_bytree": 0.80,
        "reg_lambda": 5.0,
        "reg_alpha": 0.25,
    },
    {
        "n_estimators": 120,
        "max_depth": 3,
        "learning_rate": 0.025,
        "min_child_weight": 12.0,
        "subsample": 0.80,
        "colsample_bytree": 0.80,
        "reg_lambda": 6.0,
        "reg_alpha": 0.30,
    },
]


def make_xgb(params: dict, seed: int) -> XGBClassifier:
    return XGBClassifier(
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
        random_state=seed,
        n_jobs=2,
        **params,
    )


def select_xgboost_challenger(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_validation: np.ndarray,
    y_validation: np.ndarray,
    champion_validation: np.ndarray,
    seed: int,
) -> XGBSelection:
    best = None
    best_objective = float("inf")

    for params in XGB_PARAM_GRID:
        model = make_xgb(params, seed)
        model.fit(x_train, y_train.astype(int))
        probability = model.predict_proba(x_validation)[:, 1]
        validation_metrics = metrics(y_validation, probability)
        blend_weight, blend_metrics = best_ensemble_weight(
            y_validation,
            champion_validation,
            probability,
        )
        objective = (
            blend_metrics["brier"]
            + 0.25 * blend_metrics["log_loss"]
            + 0.05 * blend_metrics["ece"]
        )
        if objective < best_objective:
            best_objective = objective
            best = XGBSelection(
                model=model,
                params=dict(params),
                validation_metrics=validation_metrics,
                blend_weight=float(blend_weight),
                blend_metrics=blend_metrics,
            )

    if best is None:
        raise RuntimeError("XGBoost challenger selection failed.")
    return best
