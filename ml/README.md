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


## Walk-forward evaluation and automatic retraining

The challenger now uses expanding-window walk-forward evaluation before final
training. Each fold trains only on earlier games, reserves the most recent past
games for validation/ensemble-weight selection, and scores the next unseen game
block. Promotion is impossible unless the walk-forward report is present.

Additional promotion gates require at least 5 walk-forward folds and the
champion+TensorFlow ensemble must beat the current champion on Brier score in at
least 60% of folds.

The GitHub Actions workflow also runs daily. When repository secrets
`SUPABASE_URL` plus either `SUPABASE_SECRET_KEY` or
`SUPABASE_SERVICE_ROLE_KEY` are configured, it refreshes the labeled snapshot
through the service-role-only `export_player_prop_training_rows()` RPC before
evaluation and retraining. If those secrets are unavailable, the job safely uses
the committed reproducible snapshot and clearly labels the run as such.

Scheduled retraining does not automatically promote a model. It only refreshes
evidence and artifacts; the promotion gates remain authoritative.


## Gradient-boosting challenger

XGBoost 3.4.1 is evaluated as a second shadow challenger alongside TensorFlow.
Each walk-forward fold selects one conservative XGBoost configuration using only
the validation games, chooses a champion+XGBoost blend weight from the same
validation block, freezes both choices, and then scores the next unseen games.

The walk-forward report records raw XGBoost performance, champion+XGBoost blend
performance, fold win rates, selected hyperparameters, and selected weights.
XGBoost does not affect PLAY/PENDING/PASS or production probabilities until its
out-of-sample evidence satisfies the same governance standards and a production
inference path is explicitly promoted.


## Market-residual challenger

The strongest current baseline is the sharp-market fair probability, so the
third challenger no longer predicts the binary outcome from scratch. It trains
an XGBoost regressor on the residual target
`actual_outcome - market_fair_probability`.

The model's raw correction is capped at ±20 percentage points. A shrinkage
factor from 0%, 25%, 50%, 75%, or 100% is selected using validation games only;
a small complexity penalty favors leaving the market untouched when performance
is effectively tied. The selected model and shrinkage are then frozen before
the next unseen games are scored.

This challenger remains shadow-only. Its walk-forward score is compared directly
against the market baseline, because the question is whether the learned
correction adds information beyond the market—not merely whether it beats a
weaker internal model.
