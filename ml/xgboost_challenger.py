"""XGBoost challenger utilities for leakage-safe player-prop evaluation."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from xgboost import XGBClassifier


def _clip_probability(values: np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(values, dtype=float), 1e-5, 1 - 1e-5)


def _expected_calibration_error(
    y_true: np.ndarray,
    probs: np.ndarray,
    bins: int = 10,
) -> float:
    y = np.asarray(y_true, dtype=float)
    p = _clip_probability(probs)
    edges = np.linspace(0.0, 1.0, bins + 1)
    total = len(y)
    if total == 0:
        return float("nan")
    ece = 0.0
    for i in range(bins):
        left, right = edges[i], edges[i + 1]
        mask = (
            (p >= left) & (p <= right)
            if i == bins - 1
            else (p >= left) & (p < right)
        )
        count = int(mask.sum())
        if count:
            ece += (count / total) * abs(
                float(y[mask].mean()) - float(p[mask].mean())
            )
    return float(ece)


def _metrics(y_true: np.ndarray, probs: np.ndarray) -> dict[str, float]:
    p = _clip_probability(probs)
    y = np.asarray(y_true, dtype=int)
    return {
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "ece": _expected_calibration_error(y, p),
        "accuracy_50": float(accuracy_score(y, p >= 0.5)),
        "mean_probability": float(np.mean(p)),
        "win_rate": float(np.mean(y)),
    }


def __best_ensemble_weight(
    y_val: np.ndarray,
    champion: np.ndarray,
    challenger: np.ndarray,
) -> tuple[float, dict[str, float]]:
    best_weight = 0.0
    best_score = float("inf")
    best_metrics = _metrics(y_val, champion)
    for weight in np.linspace(0.0, 0.5, 11):
        blended = (1.0 - weight) * champion + weight * challenger
        current = _metrics(y_val, blended)
        objective = current["brier"] + 0.25 * current["log_loss"]
        if objective < best_score:
            best_score = objective
            best_weight = float(weight)
            best_metrics = current
    return best_weight, best_metrics


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
        validation_metrics = _metrics(y_validation, probability)
        blend_weight, blend_metrics = _best_ensemble_weight(
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
