"""Streamlit dashboard for the sports analytics portfolio project."""

from __future__ import annotations

import pandas as pd
import streamlit as st

from src.market_analysis import (
    american_to_implied_probability,
    expected_value_per_unit,
    kelly_fraction,
    no_vig_two_way_probability,
    probability_edge,
)
from src.simulator import simulate_win_probability


st.set_page_config(page_title="Sports Analytics Model", layout="wide")
st.title("Sports Analytics & Predictive Modeling System")
st.caption(
    "Compare market-implied probabilities with model projections, estimate expected value, "
    "and run Monte Carlo simulations."
)

uploaded = st.file_uploader("Upload market CSV", type="csv")

if uploaded is None:
    df = pd.read_csv("data/example_market.csv")
    st.info("Showing the included example dataset. Upload a CSV to analyze your own data.")
else:
    df = pd.read_csv(uploaded)

required_columns = {
    "team",
    "opponent",
    "american_odds",
    "opponent_odds",
    "model_probability",
}

missing = required_columns.difference(df.columns)
if missing:
    st.error(f"Missing required columns: {', '.join(sorted(missing))}")
    st.stop()

analysis = df.copy()
analysis["implied_probability"] = analysis["american_odds"].apply(
    american_to_implied_probability
)
analysis["fair_market_probability"] = analysis.apply(
    lambda row: no_vig_two_way_probability(
        row["american_odds"], row["opponent_odds"]
    ),
    axis=1,
)
analysis["model_edge"] = analysis.apply(
    lambda row: probability_edge(
        row["model_probability"], row["fair_market_probability"]
    ),
    axis=1,
)
analysis["ev_per_unit"] = analysis.apply(
    lambda row: expected_value_per_unit(
        row["model_probability"], row["american_odds"]
    ),
    axis=1,
)
analysis["full_kelly_fraction"] = analysis.apply(
    lambda row: kelly_fraction(row["model_probability"], row["american_odds"]),
    axis=1,
)

display = analysis.copy()
for column in [
    "implied_probability",
    "fair_market_probability",
    "model_probability",
    "model_edge",
    "ev_per_unit",
    "full_kelly_fraction",
]:
    display[column] = display[column].map(lambda value: round(float(value), 4))

st.subheader("Market analysis")
st.dataframe(display, use_container_width=True)

st.subheader("Simulation")
selected_team = st.selectbox("Select a team", analysis["team"].tolist())
selected_row = analysis.loc[analysis["team"] == selected_team].iloc[0]

simulation_count = st.select_slider(
    "Simulations",
    options=[1_000, 10_000, 50_000, 100_000, 250_000],
    value=100_000,
)

result = simulate_win_probability(
    float(selected_row["model_probability"]),
    simulations=int(simulation_count),
)

c1, c2, c3 = st.columns(3)
c1.metric("Projected win probability", f"{selected_row['model_probability']:.1%}")
c2.metric("Simulated win rate", f"{result['empirical_probability']:.1%}")
c3.metric("Model edge vs no-vig market", f"{selected_row['model_edge']:.1%}")

st.caption(
    "Educational analytics only. Probabilities are estimates and do not guarantee outcomes."
)
