# Statistical forecasting: implementation and next model requirements

## Purpose

Estimate the distribution of player statistics and game scores before comparing an exact betting line and price. A recent hit rate, a favorable matchup description, or a simulation of an assumed probability is insufficient to establish a calibrated forecast.

This release implements joint NBA historical statistics, explicit minutes sensitivity, and paired evaluation of immutable NBA forecasts. It does not retrain or promote the existing collector, change prior recommendations, or place wagers.

## Implemented analysis

The Probability Lab at `/edge-vnext#nba-prop-scenarios` now accepts a current, uniquely matched NBA player/game, a statistic, exact thresholds, and optional assumed minutes. Its explicit load action uses the existing cached server-side snapshot. It makes no new paid odds-provider call and does not poll.

Supported statistics are points, rebounds, assists, P+A, P+R, R+A and P+R+A. Source records require exact player/team identity, archived final-game headers, matching recorded totals, and observation timestamps before the calculation cutoff. Conflicting records are excluded; repeated books and provider aliases do not expand the historical sample. A source start may differ from the accepted summary by at most the existing 15-minute collector identity tolerance. Archive retrieval must follow the source game start.

The analysis uses up to 20 verified positive-minute same-team appearances, requiring at least three. It reports mean, median, sample standard deviation, descriptive quantiles, source dates, source count, and exact threshold counts. Available verified history may omit recent games whose source evidence is incomplete; the displayed date range makes this limitation visible.

For a combined statistic, components remain paired within each game. For example, histories `(10 points, 0 assists)` and `(0 points, 10 assists)` both yield ten P+A. Independent resampling would manufacture a twenty-P+A outcome that did not occur in either observation.

For an assumed workload `m`, the sensitivity calculation is:

`component_i(m) = round(component_i × m / observed_minutes_i)`

Combined outcomes sum those coherent integer components. Each minutes assumption remains separate: no fitted probability or arbitrary scenario weight is assigned. Extreme unsupported scaled outcomes invalidate the scenario rather than being clipped. Rounding can affect small-count thresholds. Historical proportions and scenario proportions remain separate from `modelProbability`, which is null. Descriptive sample quantiles are not forecast intervals.

The endpoint is:

`GET /api/edge-vnext?mode=nba-prop-scenarios&live=1`

With no selection, it returns upcoming target metadata. An analysis additionally supplies `eventId`, `playerId`, `market`, `thresholds` (comma-separated), `direction` (`at_least`, `over`, `under`, or `at_most`) and optionally `minutes`. Integer pushes and “10+” versus “over 10” are distinct. Raw source archives and player crosswalks remain server-side.

## Paired forecast evaluation

`scripts/evaluation/nba-prop-probability-review.mjs` reviews the actual v47 forecast/outcome contract, rather than the unrelated legacy calibration table. It accepts an offline export with an explicit `asOf` timestamp. It separates model hash, market and full-game period, selects the earliest eligible exact selection before looking at probability coverage or outcome, and regrades the exact line against the recorded actual.

Model-versus-market Brier and log loss use identical decisive rows. Separate coverage summaries are not subtracted from each other. Pushes are excluded from conditional binary scores and included in three-way win/push/loss scores. Missing, invalid or contradictory probabilities are counted. Repeated quotes do not become independent games. The report is descriptive and does not certify dataset authenticity, full-slate completeness, statistical superiority, calibration or production approval.

The complete bounded November 27 saved-record query is summarized in `docs/evaluations/nba-prop-review-2026-11-28/summary.json`. Its 160 forecasts represent two model versions, 80 exact side/line identities, 12 players and only two source events. OVER and UNDER records are both present, so these are not 80 selected bets. Forecasts were issued on November 26, rather than at the final November 27 review. These limitations prevent treating the report as a full-slate or final-pregame validation.

Offline use:

```sh
node scripts/evaluation/nba-prop-probability-review.mjs --input /path/to/export.json --out /path/to/new-report.json
```

## Requirements for a predictive model

1. **Playing time and role:** fit a distribution of minutes/rotation outcomes from historical pregame evidence, starter status, restrictions and teammate availability. Missing availability remains unknown. A user's fixed minutes assumption is not a fitted minutes forecast.
2. **Opportunity and conversion:** estimate shots, rebound opportunities, potential assists, routes/targets/carries or possessions as appropriate, then estimate conversion. Fit and shrink role, pace, opponent and lineup effects; do not assign arbitrary injury/defense multipliers.
3. **Joint outcomes:** preserve shared minutes, possession and teammate effects. P+A variance includes covariance; same-game slip legs require a joint model rather than automatic probability multiplication.
4. **Exact periods:** full-game winner, spread and total forecasts should derive from a coherent joint score distribution. First-half markets require their own period data and model; dividing a full-game forecast by two is insufficient.
5. **Chronological assessment:** freeze pregame forecasts and source cutoffs, evaluate on later games, and keep an untouched confirmation period. Report accuracy of the statistic distribution, probability calibration, Brier/log loss, coverage and game-level uncertainty. Benchmark against simple baselines and same-time no-vig sharp references.
6. **Actionable output:** expected statistic, a validated outcome range, exact-line win/push/loss probabilities, input source dates, missing inputs and sensitivity. Rank likelihood separately from return at the quoted price. A probability or interval must carry the model and evaluation evidence that supports it.

The current source audit found no independent first-half forecast model, no joint NBA P+A/PRA forecast in the frozen collector, and no validated current-role adjustment in the public quote readiness path. The existing minutes challenger is an EWMA point estimate multiplied by historical per-minute production. These are the next fitting and coverage gaps, rather than a reason to increase Monte Carlo draw counts.

## Verification

Regression tests cover joint dependence, monotonic threshold ladders, pushes, cutoff exclusion, archive consistency, duplicate/conflicting histories, input limits, conditional scoring and asymmetric probability coverage. Browser checks cover explicit loading, changing inputs during requests, exact submitted markets, source disclosure and phone/desktop layout. These verify software behavior, not predictive superiority.
