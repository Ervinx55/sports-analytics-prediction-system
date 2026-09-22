import pytest

from src.market_analysis import (
    american_to_decimal,
    american_to_implied_probability,
    expected_value_per_unit,
    kelly_fraction,
    no_vig_two_way_probability,
    probability_edge,
)


def test_american_to_implied_probability_negative_odds():
    assert american_to_implied_probability(-150) == pytest.approx(0.60)


def test_american_to_implied_probability_positive_odds():
    assert american_to_implied_probability(200) == pytest.approx(1 / 3)


def test_american_to_decimal():
    assert american_to_decimal(-120) == pytest.approx(1.8333333333)
    assert american_to_decimal(150) == pytest.approx(2.5)


def test_no_vig_probability_sums_to_one():
    a = no_vig_two_way_probability(-120, 110)
    b = no_vig_two_way_probability(110, -120)
    assert a + b == pytest.approx(1.0)


def test_probability_edge():
    assert probability_edge(0.57, 0.53) == pytest.approx(0.04)


def test_positive_expected_value():
    assert expected_value_per_unit(0.60, -110) > 0


def test_kelly_is_never_negative():
    assert kelly_fraction(0.40, -110) == 0.0


def test_invalid_probability_raises():
    with pytest.raises(ValueError):
        probability_edge(1.2, 0.5)
