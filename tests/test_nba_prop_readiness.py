from src.nba_prop_readiness import PropInputs, project_prop


def valid(**changes):
    values = dict(
        baseline_minutes=24.0, baseline_per36=9.0,
        projected_minutes=28.0, opponent_pace_factor=1.0,
        defense_position_factor=1.0, role_usage_factor=1.0,
        minutes_sample_size=10, rotation_confirmed=True,
        injury_report_confirmed=True, line=6.5, observed_stddev=2.0,
        offered_american_odds=-110, pregame_timestamp="2026-11-19T17:00:00-06:00"
    )
    values.update(changes)
    return PropInputs(**values)


def test_minutes_change_projection():
    a = project_prop(valid(projected_minutes=24))
    b = project_prop(valid(projected_minutes=30))
    assert a.status == b.status == "SHADOW_ONLY_UNCALIBRATED"
    assert b.projection > a.projection


def test_missing_injury_status_blocks_probability():
    r = project_prop(valid(injury_report_confirmed=False))
    assert r.status == "AVOID_UNVERIFIED"
    assert r.over_probability is None
    assert "INJURY_STATUS_UNCONFIRMED" in r.reasons


def test_unconfirmed_rotation_blocks():
    assert project_prop(valid(rotation_confirmed=False)).status == "AVOID_UNVERIFIED"


def test_missing_role_factor_blocks():
    assert project_prop(valid(role_usage_factor=None)).status == "AVOID_UNVERIFIED"


def test_small_sample_blocks():
    assert project_prop(valid(minutes_sample_size=3)).status == "AVOID_UNVERIFIED"


def test_whole_line_blocks_without_push_model():
    r = project_prop(valid(line=6.0))
    assert "PUSH_PROBABILITY_NOT_MODELED" in r.reasons


def test_odds_do_not_change_model_probability():
    a = project_prop(valid(offered_american_odds=-110))
    b = project_prop(valid(offered_american_odds=-150))
    assert a.over_probability == b.over_probability
    assert a.expected_value_over != b.expected_value_over


def test_no_official_buy_output():
    assert project_prop(valid()).status != "BUY"
