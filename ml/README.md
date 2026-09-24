# TensorFlow shadow challenger

This directory contains the first neural-network challenger for Edge Lab.

## Safety model

The TensorFlow model is **shadow-only**. It does not change PLAY/PENDING/PASS
decisions and does not receive production ensemble weight until every promotion
gate passes on a chronological, game-level holdout.

Promotion requires:

- at least 50 distinct games,
- at least 14 days of labeled coverage,
- at least 2,000 unique prop outcomes,
- at least 10 held-out test games and 300 test rows,
- at least 0.003 Brier-score improvement versus the current champion,
- at least 0.005 log-loss improvement versus the current champion,
- no more than 0.01 ECE calibration regression.

The committed snapshot is deliberately reproducible and contains only sports/model
features and resolved outcomes. Training uses the latest strictly pregame snapshot
per unique prop outcome and splits entire games chronologically to reduce leakage.

The existing statistical/sharp model remains the champion until the challenger
earns promotion.
