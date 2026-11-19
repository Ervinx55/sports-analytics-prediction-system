from datetime import datetime, timedelta, timezone
import pytest
from src.sharp_money_research import SplitSnapshot, evaluate_split, closing_line_delta

NOW = datetime(2026, 11, 19, 18, tzinfo=timezone.utc)


def sample(**changes):
    data = dict(event_id="test-event", league="NBA", market="spread",
        selection="HOME", book="DraftKings", source="VSiN",
        observed_at=NOW-timedelta(minutes=5),
        start_at=NOW+timedelta(hours=3), ticket_pct=28.0,
        handle_pct=67.0, ticket_count=2000, open_line=-5.5,
        current_line=-3.5, line_moved_toward_selection=True,
        source_authorized=True)
    data.update(changes)
    return SplitSnapshot(**data)


def test_gap_is_percentage_points():
    r = evaluate_split(sample(), NOW)
    assert r.status == "RESEARCH_ONLY"
    assert r.divergence_points == 39
    assert "LARGE_MONEY_TICKET_DIVERGENCE" in r.research_flags


def test_no_permission_no_signal():
    assert evaluate_split(sample(source_authorized=False), NOW).status == "UNVERIFIED"


def test_missing_is_not_zero():
    r = evaluate_split(sample(handle_pct=None), NOW)
    assert r.divergence_points is None


def test_future_and_stale_rejected():
    assert evaluate_split(sample(observed_at=NOW+timedelta(minutes=1)), NOW).status == "UNVERIFIED"
    assert evaluate_split(sample(observed_at=NOW-timedelta(hours=2)), NOW).status == "UNVERIFIED"


def test_postgame_leakage_rejected():
    assert evaluate_split(sample(start_at=NOW-timedelta(hours=1)), NOW).status == "UNVERIFIED"


def test_invalid_percent_rejected():
    assert evaluate_split(sample(ticket_pct=150), NOW).status == "UNVERIFIED"


def test_no_inferred_line_movement():
    r = evaluate_split(sample(line_moved_toward_selection=None), NOW)
    assert "POTENTIAL_REVERSE_LINE_MOVEMENT" not in r.research_flags


def test_clv_probability_delta():
    assert closing_line_delta(.48, .50, .54) == pytest.approx(.04)


def test_no_buy_label():
    assert evaluate_split(sample(), NOW).status != "BUY"
