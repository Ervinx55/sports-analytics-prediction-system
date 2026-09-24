"""Market-residual challenger for player-prop probabilities.

The model does not predict outcomes from scratch. It predicts a bounded
correction to the sharp-market fair probability and selects correction strength
using validation games only.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from xgboost import XGBRegressor


MAX_ABS_CORRECTION = 0.20
SHRINKAGE_GRID = (0.0, 0.25, 0.50, 0.75, 1.0)

RESIDUAL_PARAM_GRID = [
    {
        "n_estimators": 80,
        "max_depth": 2,
        "learning_rate": 0.03,
        "min_child_weight": 10.0,
        "subsample": 0.85,
        "colsample_bytree": 0.85,
        "reg_lambda": 6.0,
        "reg_alpha": 0.35,
    },
    {
        "n_estimators": 120,
        "max_depth": 2,
        "learning_rate": 0.02,
        "min_child_weight": 12.0,
        "subsample": 0.80,
        "colsample_bytree": 0.80,
        "reg_lambda": 8.0,
        "reg_alpha": 0.50,
    },
    {
        "n_estimators": 80,
        "max_depth": 3,
        "learning_rate": 0.02,
        "min_child_weight": 16.0,
        "subsample": 0.80,
        "colsample_bytree": 0.80,
        "reg_lambda": 10.0,
        "reg_alpha": 0.60,
    },
]


def _clip_probability(values: np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(values, dtype=float), 1e-5, 1 - 1e-5)


def _ece(y_true: np.ndarray, probs: np.ndarray, bins: int = 10) -> float:
    y = np.asarray(y_true, dtype=float)
    p = _clip_probability(probs)
    edges = np.linspace(0.0, 1.0, bins + 1)
    total = len(y)
    if total == 0:
        return float("nan")
    value = 0.0
    for i in range(bins):
        left, right = edges[i], edges[i + 1]
        mask = (
            (p >= left) & (p <= right)
            if i == bins - 1
            else (p >= left) & (p < right)
        )
        count = int(mask.sum())
        if count:
            value += (count / total) * abs(
                float(y[mask].mean()) - float(p[mask].mean())
            )
    return float(value)


def _metrics(y_true: np.ndarray, probs: np.ndarray) -> dict[str, float]:
    y = np.asarray(y_true, dtype=int)
    p = _clip_probability(probs)
    return {
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "ece": _ece(y, p),
        "accuracy_50": float(accuracy_score(y, p >= 0.5)),
        "mean_probability": float(np.mean(p)),
        "win_rate": float(np.mean(y)),
    }


def _objective(y_true: np.ndarray, probs: np.ndarray) -> tuple[float, dict]:
    current = _metrics(y_true, probs)
    value = (
        current["brier"]
        + 0.25 * current["log_loss"]
        + 0.05 * current["ece"]
    )
    return float(value), current


def make_residual_regressor(params: dict, seed: int) -> XGBRegressor:
    return XGBRegressor(
        objective="reg:squarederror",
        tree_method="hist",
        random_state=seed,
        n_jobs=2,
        **params,
    )


def correction_from_model(model: XGBRegressor, x: np.ndarray) -> np.ndarray:
    raw = np.asarray(model.predict(x), dtype=float)
    return np.clip(raw, -MAX_ABS_CORRECTION, MAX_ABS_CORRECTION)


def corrected_probability(
    market_probability: np.ndarray,
    correction: np.ndarray,
    shrinkage: float,
) -> np.ndarray:
    market = np.asarray(market_probability, dtype=float)
    delta = np.asarray(correction, dtype=float)
    return _clip_probability(market + float(shrinkage) * delta)


@dataclass(frozen=True)
class ResidualSelection:
    model: XGBRegressor
    params: dict
    shrinkage: float
    validation_metrics: dict
    validation_raw_metrics: dict
    mean_abs_correction: float
    max_abs_correction: float


def select_market_residual_challenger(
    x_train: np.ndarray,
    y_train: np.ndarray,
    market_train: np.ndarray,
    x_validation: np.ndarray,
    y_validation: np.ndarray,
    market_validation: np.ndarray,
    seed: int,
) -> ResidualSelection:
    target_residual = (
        np.asarray(y_train, dtype=float)
        - np.asarray(market_train, dtype=float)
    )

    best = None
    best_objective = float("inf")

    for params in RESIDUAL_PARAM_GRID:
        model = make_residual_regressor(params, seed)
        model.fit(x_train, target_residual)

        correction = correction_from_model(model, x_validation)
        raw_probability = corrected_probability(
            market_validation,
            correction,
            1.0,
        )
        _, raw_metrics = _objective(y_validation, raw_probability)

        for shrinkage in SHRINKAGE_GRID:
            probability = corrected_probability(
                market_validation,
                correction,
                shrinkage,
            )
            objective, current = _objective(y_validation, probability)
            # Small complexity penalty favors market-only when performance is tied.
            objective += 0.00025 * float(shrinkage)
            if objective < best_objective:
                best_objective = objective
                best = ResidualSelection(
                    model=model,
                    params=dict(params),
                    shrinkage=float(shrinkage),
                    validation_metrics=current,
                    validation_raw_metrics=raw_metrics,
                    mean_abs_correction=float(np.mean(np.abs(correction))),
                    max_abs_correction=float(np.max(np.abs(correction))),
                )

    if best is None:
        raise RuntimeError("Market-residual challenger selection failed.")
    return best
