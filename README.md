# Sports Analytics & Predictive Modeling System

A Python-based portfolio project for analyzing sportsbook markets, converting odds into probabilities, comparing model projections with market prices, estimating expected value, and running Monte Carlo simulations.

## What this project demonstrates

- Python data analysis
- Probability and expected-value calculations
- Sports-market data normalization
- No-vig / fair-probability estimation
- Monte Carlo simulation
- Reusable analytics functions
- Streamlit dashboard development
- Unit testing and project organization

## Features

### Market probability tools
Convert American odds into implied probabilities and remove bookmaker margin from two-way markets.

### Edge and expected value
Compare a model probability with the market-implied price to estimate:

- probability edge
- expected value per unit risked
- optional Kelly criterion sizing

### Monte Carlo simulation
Simulate repeated game outcomes from a projected win probability to estimate empirical win rates and uncertainty.

### Interactive dashboard
Upload a CSV of market data or use the included example dataset to inspect implied probability, fair probability, model edge, expected value, and simulated results.

## Project structure

```
.
├── app.py
├── data/
│   └── example_market.csv
├── src/
│   ├── __init__.py
│   ├── market_analysis.py
│   └── simulator.py
├── tests/
│   └── test_market_analysis.py
├── requirements.txt
└── README.md
```

## Quick start

1. Clone the repository.
2. Create and activate a Python virtual environment.
3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Run the dashboard:

```bash
streamlit run app.py
```

5. Run tests:

```bash
pytest
```

## Example input

The dashboard expects columns similar to:

| team | opponent | american_odds | opponent_odds | model_probability |
|---|---|---:|---:|---:|
| Houston | Seattle | -120 | 110 | 0.57 |
| Atlanta | Miami | 135 | -145 | 0.46 |

`model_probability` is expressed as a decimal between 0 and 1.

## Core methodology

For American odds:

- Negative odds: `|odds| / (|odds| + 100)`
- Positive odds: `100 / (odds + 100)`

For two-way markets, bookmaker margin is removed by normalizing both implied probabilities so they sum to 1.

Expected value is calculated from the model probability and the payout implied by the offered odds.

The simulation module uses repeated Bernoulli trials to estimate the empirical win rate for a projected probability.

## Why I built it

I am developing this project as part of my transition into AI, machine learning, data analysis, and automation. The goal is to turn raw market information into a reproducible analytics workflow while practicing software engineering, probability, API/data-pipeline design, and model evaluation.

## Current status

This is an actively developed portfolio project. The current public version focuses on the analytics foundation and reproducible calculations. Planned extensions include:

- automated API ingestion
- historical result storage
- sport-specific predictive models
- calibration and backtesting
- line-movement tracking
- model-vs-market performance reporting
- richer dashboards and visualizations

## Tech stack

Python, pandas, NumPy, Streamlit, pytest

## Responsible use

This repository is an educational analytics project. Model outputs are uncertain estimates, not guarantees.

## Backend source of truth (Supabase)

The version-controlled Supabase backend now lives under `supabase/`. Database migrations, Edge Function source, per-function `verify_jwt` configuration, cron/security inventories, and reconstruction verification tooling are maintained in Git.

Key references:

- [Supabase hybrid reconstruction design](docs/architecture/2026-09-23-supabase-hybrid-reconstruction-design.md)
- [Supabase hybrid reconstruction implementation plan](docs/superpowers/plans/2026-09-23-supabase-hybrid-reconstruction.md)
- [Supabase recovery and deployment operations guide](docs/operations/supabase-recovery-and-deploy.md)

Future Supabase database changes must be represented by migrations, and Edge Function changes must be committed with their configuration before or alongside deployment. Production-only Dashboard/SQL edits are not considered authoritative until they are recovered into Git.

