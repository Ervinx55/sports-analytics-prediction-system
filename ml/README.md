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
