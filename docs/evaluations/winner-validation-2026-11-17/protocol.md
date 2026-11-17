# NBA / NFL independent winner development validation

Declared November 17, 2026 before new candidate scores were calculated. Research only. Live source tree, model weights, historical forecasts and production approval gates must remain unchanged. This protocol does not authorize a PLAY.

## Data and evaluation status

NBA: archived ESPN regular-season games October 22, 2024–April 13, 2025 (1,230 games; 26,306 player-game rows). Games SHA-256 `d6f710ae1f196d7010506fb5205a5940a00577b606c8da40e7906d5a860c2a0a`; player stats `6b1aefaa4721c6f7eb3f04d80f3783f0af8f1b1492a0154b445186c1d7c6fa54`. Require unique game/player identities and player-summed team scores matching final game scores. This archive predates the current-season player correction work; do not attribute corrected current prop outcomes to this historical winner experiment.

NFL: November 16 nflverse cached games and 2023/2024 team statistics. Games SHA-256 `3623ec559b2fda2b54eb5f54a6fa16b8cac908f96347c9ba8a362185a645a26d`; 2023 team stats `dc5a387daabe8663deaddac492ad7020d47fb1a66048690b355b406cd8e4c454`; 2024 `b207a1430c2715d03bbf1844c4eae98695f364851ff6025f422febc2c13f5255`. Validate unique team-game pairs and opponent joins. No new source values are invented to fill gaps.

All historical seasons have previously been inspected. Every score here is **reused development evidence**, even where the new fit excludes later labels. No historical period is newly untouched. Archived final boxscores also lack original publication receipts: prior-slate/week filters reduce hindsight risk but cannot establish strict historical point-in-time availability. No odds ROI, executable EV or profit claim is allowed.

## NBA arms

Use previous Eastern slate dates only, within 21 calendar days; at least four games per team. Preserve the released independent ridge-margin formula as reference. Fit before January 1, 2025; January is diagnostics without tuning; February 1–April 13 is later reused development evaluation. All four arms use identical eligible game IDs.

Three residual logistic candidates add rest, defense, or both to the reference log-odds, without an intercept. Fixed mean log-loss L2 penalty 0.05, 2,000 gradient steps, learning rate 0.05; no hyperparameter search. Rest inputs: capped rest-day difference /4, back-to-back difference, prior-seven-day game-count difference /4. Defensive matchup inputs: lagged offense versus opponent allowed effective FG%, turnover rate, offensive rebound rate, and FT-attempt rate, each scaled by 0.10. Compute from prior player-summed team boxes; never use the target game's participants, minutes or results as features.

## NFL arms

Train 2023 regular-season weeks 4–18; evaluate 2024 weeks 4–18. Fixed ridge logistic model with training-only standardization, summed negative log-likelihood plus 0.5 × sum of squared nonintercept coefficients (lambda 1); 50 Newton steps, tolerance 1e-9. Baseline inputs: verified home/neutral indicator, lagged margin and opponent-strength-adjusted margin. Add recomputed rest, lagged EPA offense-versus-opponent-defense differential, or both. Schedule history: current/prior season, at most 12 games, recency weight exp(-0.16 × index), prior-season discount 0.45. EPA: current-season strictly prior weeks with at least three verified team/opponent game pairs per side; no absent prior-season EPA imputation. Apply the same complete-feature cohort to every arm.

Exclude and count final ties for binary moneyline evaluation; probability is conditional on a non-tie. Compare with paired archived no-vig closing moneylines descriptively; archive observation times are unknown. The released NFL moneyline is currently market-only (independent contribution zero), so do not claim it as an independent-model benchmark. No market price, target QB, injury or target-game participation enters independent features.

## Lineups, measures and decision

Neither archive supplies trustworthy timestamped pregame starters/inactives. Lineup ablation is unavailable; historical target-game participation must never stand in for known pregame availability. Defense is team-level game-winner context, not defense versus a particular player position.

Report game counts/exclusions, Brier score, log loss, accuracy (0.5 probability gives half credit), fixed ten-bin calibration, and paired score differences. Resample entire Eastern slate days (NBA) or season-weeks (NFL), 2,000 replicates, seed 20261117, percentile 95% intervals; negative candidate-minus-reference is improvement. Intervals are descriptive, not multiplicity-adjusted promotion tests. Strong/weak defense subgroup diagnostics cannot be used to tune after observing results.

No candidate earns influence from this run. A future confirmation protocol must pin source/feature/coefficient hashes and an unexamined time window before capture; preserve pregame availability and exact price timestamps, immutable predictions, verified outcomes, minimum independent-game coverage, and incumbent/market comparisons. Do not call that future collection started until actual capture is verified. Keep NBA and NFL live models frozen regardless of these historical results.
