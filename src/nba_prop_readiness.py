"""Conservative NBA prop projection and readiness gates.

This is a shadow-only research module. It does not approve wagers.
All inputs must be timestamped pregame observations; no postgame leakage.
"""
from dataclasses import dataclass
from math import erf, isfinite, sqrt
from typing import Optional


@dataclass(frozen=True)
class PropInputs:
    baseline_minutes: float
    baseline_per36: float
    projected_minutes: Optional[float]
    opponent_pace_factor: Optional[float]
    defense_position_factor: Optional[float]
    role_usage_factor: Optional[float]
    minutes_sample_size: int
    rotation_confirmed: bool
    injury_report_confirmed: bool
    line: float
    observed_stddev: Optional[float]
    offered_american_odds: int
    pregame_timestamp: str


@dataclass(frozen=True)
class PropResearch:
    projection: Optional[float]
    over_probability: Optional[float]
    under_probability: Optional[float]
    expected_value_over: Optional[float]
    expected_value_under: Optional[float]
    status: str
    reasons: tuple[str, ...]


def _american_profit(odds: int) -> float:
    if odds == 0 or abs(odds) < 100:
        raise ValueError("American odds must be <= -100 or >= +100")
    return 100 / abs(odds) if odds < 0 else odds / 100


def project_prop(x: PropInputs) -> PropResearch:
    """Return a shadow-only estimate or abstain if pregame inputs are unreliable.

    Normal approximation is exploratory, not calibrated. Whole-number push
    probability is not modeled, so those lines are withheld.
    """
    reasons = []
    if not x.pregame_timestamp:
        reasons.append("MISSING_PREGAME_TIMESTAMP")
    if not x.injury_report_confirmed:
        reasons.append("INJURY_STATUS_UNCONFIRMED")
    if not x.rotation_confirmed:
        reasons.append("ROTATION_UNCONFIRMED")
    if x.minutes_sample_size < 5:
        reasons.append("INSUFFICIENT_MINUTES_SAMPLE")
    if x.projected_minutes is None:
        reasons.append("MISSING_PROJECTED_MINUTES")
    if x.observed_stddev is None:
        reasons.append("MISSING_STAT_VARIANCE")
    factors = (x.opponent_pace_factor, x.defense_position_factor, x.role_usage_factor)
    if any(v is None for v in factors):
        reasons.append("MISSING_MATCHUP_OR_ROLE_FACTOR")
    numbers = [x.baseline_minutes, x.baseline_per36, x.line]
    numbers += [v for v in (x.projected_minutes, x.observed_stddev, *factors) if v is not None]
    if any(not isfinite(v) for v in numbers):
        reasons.append("INVALID_NONFINITE_INPUT")
    if x.baseline_minutes <= 0 or x.baseline_per36 < 0 or x.line < 0:
        reasons.append("INVALID_BASELINE_OR_LINE")
    if x.projected_minutes is not None and not 0 <= x.projected_minutes <= 48:
        reasons.append("INVALID_PROJECTED_MINUTES")
    if x.observed_stddev is not None and x.observed_stddev <= 0:
        reasons.append("INVALID_VARIANCE")
    if any(v is not None and not 0.5 <= v <= 1.5 for v in factors):
        reasons.append("UNSUPPORTED_FACTOR_MAGNITUDE")
    try:
        payout = _american_profit(x.offered_american_odds)
    except ValueError:
        payout = None
        reasons.append("INVALID_ODDS")
    if x.line.is_integer():
        reasons.append("PUSH_PROBABILITY_NOT_MODELED")
    if reasons:
        return PropResearch(None, None, None, None, None, "AVOID_UNVERIFIED", tuple(reasons))
    projection = x.baseline_per36 * (x.projected_minutes / 36)
    projection *= x.opponent_pace_factor * x.defense_position_factor * x.role_usage_factor
    z = (x.line - projection) / x.observed_stddev
    under = 0.5 * (1 + erf(z / sqrt(2)))
    over = 1 - under
    return PropResearch(
        projection, over, under,
        over * payout - (1 - over),
        under * payout - (1 - under),
        "SHADOW_ONLY_UNCALIBRATED",
        (),
    )
