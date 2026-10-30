# NBA and NFL prop context challengers

## Intent and agreed scope
The user selected development of NBA and NFL upgrades together. Both should consider team strength/ranking, recent form, offense, defense and defense versus position. Build on Edge Lab's existing Node services and research board, without paid data or changing live eligibility gates.

## Approaches
NBA-first delivery was recommended to reduce simultaneous data work. The user selected joint NBA/NFL development. Use shared point-in-time, provenance and evaluation contracts, with separate sport-specific features and weights. Do not share statistical coefficients across sports.

## Existing state
NBA has provider quotes, current ESPN roster checks and exact-book paired market probabilities; it has no connected validated player-prop model. NFL has rolling player baselines, role/snap shares, team volume and a broad opponent yards-per-play adjustment, with development-calibrated residual weights. Production influence remains zero. Existing NFL backtesting measures projection accuracy; historical sharp prices remain a promotion requirement.

## Model design
NBA initial supported outputs: points, rebounds and assists. Baseline is pregame expected minutes multiplied by a player per-minute production estimate from completed games. Context candidates include recent versus season form, team win rate and net rating, offensive/defensive efficiency per estimated possession, pace, home/away and rest, and opponent allowance for the relevant statistic by historical player position/role. Estimate possessions only from complete required box-score fields using a documented formula; label them estimated. Position allowance is a proxy, not evidence of an actual defender assignment. Unknown projected minutes or injuries must remain explicit.

NFL supported outputs remain passing yards, passing touchdowns, rushing yards, receptions and receiving yards. Retain the existing baseline as the control. Context candidates include recent team form, offensive and defensive efficiency, projected play/pass/rush volume, and opponent allowance against QB/RB/WR/TE for the specific statistic. Historical player roles and team membership must come from the relevant game, not today's roster.

Model raw values, with league ranks as explanatory display fields. A rank is unavailable unless the comparison set is complete, eligible and from the same season/window. Use continuous efficiency rather than treating the difference between rank 1 and 2 as a fixed numerical effect. Account for opportunity and pace; avoid double-counting the same team strength across rankings, recent form and position allowances.

## Source and temporal contracts
Use existing authorized ESPN and nflverse sources where the required fields can be verified. Each feature includes value, source, observedAt/availableAt, cutoff, season/window, sample count and missing reason. Separate source retrieval time from event completion and historical availability. Reject target-game outcomes and data after the forecast cutoff. Present-day roster verification is insufficient for retrospective identity joins. Do not reconstruct historical injury knowledge from today's injury page. Missing unavailable features do not receive a fabricated neutral rank.

Deduplicate game/player observations. Use completed, final games only; identify postponed/corrected games. Do not mix preseason, playoffs and regular season without explicit evaluation cohorts. Require exact player, game, market, side, line and bookmaker identity when comparing to prices.

## Training and validation
1. Audit existing experiments and holdout access before selecting a new chronological split. Never describe an inspected or tuned-on dataset as untouched.
2. Freeze dataset manifests, split boundaries, feature definitions, minimum sample policies, weight-search bounds and acceptance rules before running evaluation.
3. Fit and shrink context adjustments on development data only. Learn weights rather than choose arbitrary boosts from ranks. Small position samples shrink toward a documented broader baseline; show sample size.
4. Ablate feature groups: baseline; plus team form; plus efficiency/pace; plus position allowance. Compare identical eligible rows and coverage.
5. Evaluate projection MAE, RMSE and bias per market first. For actual archived pregame lines/odds, evaluate calibration, Brier and log loss versus baseline and market on matched pairs, explicitly handling pushes.
6. Cluster uncertainty by game so repeated books/lines do not inflate sample size. Inspect role/minutes and market subgroups, with predeclared policies for multiplicity and small samples.
7. Run the frozen challenger once on the reserved holdout. If it fails, retain zero influence; further tuning requires a newly reserved holdout. Missing historical prices block claims about betting edge or ROI.
8. Capture prospective shadow predictions before kickoff/tipoff with immutable feature/model versions and timestamps; settle against authoritative results.

No production promotion is part of this implementation. A separate release decision requires earned gates, adequate predeclared samples and operational verification. Winning predictions or positive short-run ROI alone do not qualify.

## Research experience
For each prop show baseline projection, context-adjusted shadow projection when available, exact-line market probability, model probability only from a validated probability distribution, sample sizes, and concise reasons. Show team strength, recent form and defense-versus-position with source/window. Distinguish unavailable, exploratory and validated features. Keep NOT CLEARED separate from research signal strength.

## Delivery and checks
A. Audit source schemas and historical availability for both sports; implement typed feature contracts and fixtures.
B. Build NBA baseline and context feature pipeline; extend NFL context pipeline without changing the existing control.
C. Add versioned offline training, ablation reports and untouched-holdout manifest checks.
D. Integrate shadow explanations and prospective capture; regression-test stale data, outages, mismatched identities, missing minutes/injuries and later-arriving results.
E. Publish a preview only after code/data review and relevant Node/Python/SQL checks.

## Remaining decisions delegated to implementation
Exact source endpoints, cache limits and runtime scheduling are selected after schema/latency inspection. Numerical fitting and minimum sample policies are proposed and frozen from development-data feasibility before evaluation. Unavailable inputs are reported as blockers rather than inferred from odds. No credentials or private account data are required.
