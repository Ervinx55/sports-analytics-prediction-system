# NBA recalibration candidate — development only

Built and evaluated a separate probability-distribution candidate without editing either frozen November model, its protocol, or its forecasts. This experiment tests whether residual variation differs by projected minutes. Its version is `nba-minutes-distribution-recalibration-2026-11-16-v1`; production eligibility is false and production weight is zero.

## Result

The new minute-band distributions made small descriptive improvements for points and rebounds, but **no market earned the predeclared development selection margin**. The saved candidate therefore retains the pooled distribution for every market. This is useful negative evidence, not a reason to lower the selection rule after seeing the results.

| Market | January pooled Brier | Best January band Brier | Gain | Selected |
|---|---:|---:|---:|---|
| Points | 0.191250 | 0.191119 | 0.000131 | Pooled |
| Rebounds | 0.189011 | 0.188799 | 0.000212 | Pooled |
| Assists | 0.208935 | 0.208863 | 0.000072 | Pooled |

Lower Brier is better. The selection rule requires at least 0.0005 improvement with non-worse log loss on January games, with ties favoring the simpler distribution. This margin is a conservative builder choice saved before execution, not an inherited production approval threshold. All alternatives, reliability bins, and secondary fixed-threshold results remain visible in `report.json`.

On the 526 later development games, pooled minutes probabilities scored 0.196270 points, 0.195011 rebounds, and 0.214205 assists. A last-ten mean reference scored 0.197821, 0.196667 and 0.215402 respectively on identical rows and thresholds. These common-cohort refits are not replays of the frozen live artifacts. They cannot be compared directly with current sportsbook-line Brier scores.

## Data and method

- Only the SHA-256-pinned ESPN 2024-season development archive is accepted. Input hashes, code hash, artifact hash and fixed choices are recorded.
- Fit on 408 games / 7,887 player-games before January 2025; select on 224 January games / 4,661 player-games; describe 526 later games / 10,505 player-games. These counts apply per market. Markets share player-games and must not be added as independent observations.
- Validate final games, canonical player/game identity, both team point totals, nonnegative integer stats, and minutes. Duplicate or inconsistent rows fail closed.
- Means use the last ten same-team positive-minute games, requiring at least five, an earlier UTC date, and an eight-hour interval from the prior start. Exponential projected minutes have a three-game half-life and 48-minute cap. Current outcomes enter history after forecast construction.
- Fit empirical standardized residuals on training data only. Compare pooled residuals with 50% and 100% mixtures of residuals in fixed projected-minute bands below 20, 20–30, and 30-plus. Bands with fewer than 50 training games or 200 rows fall back to pooled.
- Primary diagnostic lines are common to all alternatives: nonnegative half-point thresholds near the pregame last-ten mean, with fixed offsets. Secondary diagnostics use the previous fixed line grid. These are synthetic lines, not bookmaker prices.
- Average threshold scores within players and players within games, then weight games equally. Candidate choice is made before later results are evaluated. Reported game-bootstrap intervals are descriptive, not promotion tests.

## Boundaries and next evidence

All historical data were previously inspected. The February-and-later cohort is reused development data, not an untouched holdout. No 2025-season holdout or November 2026 prospective outcome was loaded. Historical injury-publication times are unavailable, and the population includes actual positive-minute participants. This does not validate player availability, market edge, ROI, or clearance of a wager.

The method and fitted artifacts are ready for further offline investigation. A new candidate that merits advancement still needs frozen prospective registration and exact timestamped prices, verified availability, and reconciled outcomes. Existing NBA model influence stays unchanged.

## Reproduction and verification

From the repository root, use a new output directory (overwriting an existing experiment is refused):

```sh
python -m ml.nba_recalibration_candidate --source ../nba-development-recheck --output path/to/new-experiment
python -m unittest discover -s tests -p test_nba_recalibration_candidate.py -v
```

Eight behavioral tests cover current-outcome invariance, chronology, wrong-season and conflicting boxscore rejection, training cutoff/duplicate protection, sparse-band fallback, complementary probabilities including pushes, equal-game weighting, selection guards, refusal to overwrite an existing experiment, and canonical LF artifact bytes on Windows. The overwrite integration check uses the external pinned archive and skips when that archive is absent; the other tests are self-contained. Branch-wide verification is recorded separately. No model deployment or approval write was made.

The final artifacts were regenerated with explicit UTF-8/LF serialization so Git checkout does not change their recorded hashes. Algorithm, settings, selections, and all reported metrics are unchanged from the original run; original CRLF artifacts are retained outside the repository in the local experiment archive.
