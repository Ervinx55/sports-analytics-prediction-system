"""Market probability and expected-value utilities."""

from __future__ import annotations


def american_to_decimal(odds: float) -> float:
    """Convert American odds to decimal odds."""
    if odds == 0:
        raise ValueError("American odds cannot be 0.")
    if odds > 0:
        return 1.0 + (odds / 100.0)
    return 1.0 + (100.0 / abs(odds))


def american_to_implied_probability(odds: float) -> float:
    """Convert American odds to implied probability."""
    if odds == 0:
        raise ValueError("American odds cannot be 0.")
    if odds > 0:
        return 100.0 / (odds + 100.0)
    return abs(odds) / (abs(odds) + 100.0)


def no_vig_two_way_probability(side_odds: float, opponent_odds: float) -> float:
    """Return the normalized fair probability for one side of a two-way market."""
    side = american_to_implied_probability(side_odds)
    opponent = american_to_implied_probability(opponent_odds)
    total = side + opponent
    if total <= 0:
        raise ValueError("Total implied probability must be positive.")
    return side / total


def probability_edge(model_probability: float, fair_market_probability: float) -> float:
    """Return model probability minus fair market probability."""
    _validate_probability(model_probability)
    _validate_probability(fair_market_probability)
    return model_probability - fair_market_probability


def expected_value_per_unit(model_probability: float, american_odds: float) -> float:
    """Expected profit per 1 unit risked.

    Positive values indicate positive expected value under the supplied model probability.
    """
    _validate_probability(model_probability)
    decimal_odds = american_to_decimal(american_odds)
    profit_if_win = decimal_odds - 1.0
    loss_probability = 1.0 - model_probability
    return (model_probability * profit_if_win) - loss_probability


def kelly_fraction(model_probability: float, american_odds: float) -> float:
    """Full Kelly fraction for a binary wager, floored at zero."""
    _validate_probability(model_probability)
    b = american_to_decimal(american_odds) - 1.0
    if b <= 0:
        return 0.0
    q = 1.0 - model_probability
    fraction = ((b * model_probability) - q) / b
    return max(0.0, fraction)


def _validate_probability(value: float) -> None:
    if not 0.0 <= value <= 1.0:
        raise ValueError("Probability must be between 0 and 1.")
