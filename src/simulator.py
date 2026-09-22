"""Simple Monte Carlo tools for binary game outcomes."""

from __future__ import annotations

import numpy as np


def simulate_win_probability(
    projected_probability: float,
    simulations: int = 100_000,
    seed: int | None = 42,
) -> dict[str, float | int]:
    """Run Bernoulli simulations for a projected win probability."""
    if not 0.0 <= projected_probability <= 1.0:
        raise ValueError("projected_probability must be between 0 and 1.")
    if simulations <= 0:
        raise ValueError("simulations must be positive.")

    rng = np.random.default_rng(seed)
    outcomes = rng.random(simulations) < projected_probability
    wins = int(outcomes.sum())
    empirical_probability = wins / simulations
    standard_error = float(
        np.sqrt(empirical_probability * (1.0 - empirical_probability) / simulations)
    )

    return {
        "simulations": simulations,
        "wins": wins,
        "losses": simulations - wins,
        "empirical_probability": empirical_probability,
        "standard_error": standard_error,
    }
