"""Research-only sportsbook split signals. No scraping, wagering or BUY outputs.

Splits must be obtained through an authorized source and matched by
book, market, event, side and timestamp. Missing data is never zero.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from math import isfinite
from typing import Optional


@dataclass(frozen=True)
class SplitSnapshot:
    event_id: str
    league: str
    market: str
    selection: str
    book: str
    source: str
    observed_at: datetime
    start_at: datetime
    ticket_pct: Optional[float]
    handle_pct: Optional[float]
    ticket_count: Optional[int]
    open_line: Optional[float]
    current_line: Optional[float]
    # Positive means the selected side's price/line became more favorable
    # to the bookmaker (i.e. moved in the selected side's direction).
    line_moved_toward_selection: Optional[bool]
    source_authorized: bool = False


@dataclass(frozen=True)
class SplitSignal:
    status: str
    divergence_points: Optional[float]
    reasons: tuple[str, ...]
    # A flag to investigate, not a bet recommendation.
    research_flags: tuple[str, ...]


def evaluate_split(x: SplitSnapshot, as_of: datetime, max_age_minutes: int = 30) -> SplitSignal:
    reasons = []
    if not x.source_authorized:
        reasons.append("SOURCE_NOT_AUTHORIZED")
    if not x.event_id or not x.book or not x.source or not x.market or not x.selection:
        reasons.append("MISSING_EVENT_OR_PROVENANCE")
    if x.observed_at.tzinfo is None or x.start_at.tzinfo is None or as_of.tzinfo is None:
        reasons.append("TIMESTAMP_WITHOUT_TIMEZONE")
    else:
        age = (as_of - x.observed_at).total_seconds() / 60
        if age < 0 or age > max_age_minutes:
            reasons.append("STALE_OR_FUTURE_SNAPSHOT")
        if x.observed_at >= x.start_at or as_of >= x.start_at:
            reasons.append("NOT_PREGAME")
    if x.ticket_pct is None or x.handle_pct is None:
        reasons.append("MISSING_SPLITS")
    else:
        if not all(isfinite(v) and 0 <= v <= 100 for v in (x.ticket_pct, x.handle_pct)):
            reasons.append("INVALID_PERCENTAGE")
    if x.ticket_count is not None and x.ticket_count < 0:
        reasons.append("INVALID_TICKET_COUNT")
    if reasons:
        return SplitSignal("UNVERIFIED", None, tuple(reasons), ())
    gap = x.handle_pct - x.ticket_pct
    flags = []
    if gap >= 15 and x.ticket_pct <= 45:
        flags.append("LARGE_MONEY_TICKET_DIVERGENCE")
    if x.ticket_pct <= 40 and x.line_moved_toward_selection is True:
        flags.append("POTENTIAL_REVERSE_LINE_MOVEMENT")
    if x.ticket_count is None or x.ticket_count < 100:
        flags.append("LOW_OR_UNKNOWN_SAMPLE")
    if x.line_moved_toward_selection is None:
        flags.append("LINE_MOVEMENT_UNVERIFIED")
    return SplitSignal("RESEARCH_ONLY", round(gap, 2), (), tuple(flags))


def closing_line_delta(open_implied: float, bet_implied: float, close_implied: float) -> float:
    """Closing minus entry no-vig implied probability for the selected side.

    Positive values suggest the market moved toward the selection after entry;
    this is NOT realized ROI or proof of predictive skill.
    """
    values = (open_implied, bet_implied, close_implied)
    if not all(isfinite(v) and 0 < v < 1 for v in values):
        raise ValueError("Probabilities must be finite and between 0 and 1")
    return close_implied - bet_implied
