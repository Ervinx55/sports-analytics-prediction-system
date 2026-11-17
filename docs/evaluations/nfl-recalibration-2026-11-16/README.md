# Separate NFL recalibration candidate — November 16, 2026

This is an offline development candidate. The production NFL v2.1 model and all live weights are unchanged. The candidate is not approved for betting decisions, and no new untouched holdout has been run.

## Experiment

The runner replays 2024 regular-season weeks 4–18 using the existing v2.1 projection engine, exact Eastern-time schedule kickoff conversion, and its existing point-in-time feature filters. It excludes historical closing spread/total values because their original observation timestamps are absent. Historical weather is also excluded. Aggregate schedule/NGS files can contain later seasons, but later rows are excluded from target selection and pregame features. The historical sample is conditional on the players appearing in the weekly stat archive; it is not a verified injury/availability timeline.

There are 8,460 player-market rows. Weeks 4–10 (104 distinct games) select one mean-residual correction from shrinkages 0, 0.25, 0.5 and 1, separately by market. Weeks 11–18 (120 games) check the fixed selection. Metrics first average within games, then weight games equally. Acceptance requires a later-development MAE improvement of at least 0.01 stat units or 0.25%, whichever is greater, with at least 25 rows and 10 games in each partition. These are development rules, not statistical significance or promotion gates.

| Market | Later baseline MAE | Tested candidate MAE | Location correction retained? |
|---|---:|---:|---|
| Passing yards | 72.3161 | 72.3419 | No |
| Passing TDs | 0.8947 | 0.8947 | No |
| Rushing yards | 19.5177 | 19.4026 | Yes, −1.1699 yards |
| Receptions | 1.4409 | 1.4407 | No, gain below threshold |
| Receiving yards | 19.3820 | 19.3251 | Yes, −0.2811 yards |

Gains are modest. The rushing adjustment slightly worsens RMSE despite improving MAE. The residual probability distribution uses early development errors only, with integer support and nonnegative counts for touchdowns/receptions. Yards retain negative support. Integer-line pushes are removed from conditional win probability.

The report also compares Brier/log loss at synthetic half-integer thresholds derived from the prior model mean. These are diagnostic thresholds, not historical sportsbook lines, no-vig comparisons, ROI or evidence of profitable selections. They do not select candidate parameters. Receptions' residual probability diagnostic worsens, so the residual distribution must not be treated as a universal accuracy upgrade.

The attached candidate records exact input, baseline-source, candidate-source and raw-source hashes. The script refuses to overwrite an existing result directory. The 2025 evaluation was already inspected in earlier work; it cannot become an untouched test of this candidate.

## Reproduction

From the repository root, run:

```powershell
node scripts/nfl/recalibrate-props.mjs --fetch --output-dir=artifacts/nfl-recalibration-new-run
```

For a deterministic replay of cached raw sources, omit `--fetch` and pass `--cache-dir=PATH_TO_SOURCE_CACHE`, using a new output directory. The historical target season is fixed to 2024; the fitting function rejects any 2025/2026 rows. Raw source bytes and URL/hash receipts are saved in the cache. `candidate.json` contains fitted residuals and `report.json` contains compact metrics.

## Exact price evidence

The old NFL API returned forecasts but did not persist both sides of each priced prop. Estimates-only responses retain one update time and cannot reconstruct two independently timestamped sides.

The new portable `scripts/nfl/price-capture-lib.mjs` reads the full NFL response and checks:

- Exact event, player, stat, game period and over/under odd IDs.
- Same sportsbook and exact line; both odds valid and both sides explicitly available.
- Both quote timestamps and response publication no older than five minutes, never future-dated or received after kickoff.
- Known provider and a non-stale response; DFS payouts and exchange contracts are excluded from this fixed-odds path.

The collector preserves each side's timestamp, both odds, raw source receipt, no-vig probability, and the API's separate independent probability when its exact quote matches. Quote collection is not model approval: the model hash and fresh prospective protocol remain unset, validation eligibility remains false, and production weight remains zero.

```powershell
node scripts/nfl/collect-prices.mjs --output-dir=artifacts/nfl-price-capture
```

This saves content-addressed raw responses, an append-only deduplicated price ledger and collection run receipts. It accepts `--input=ARCHIVE.json` for investigation, but never backdates an archive import into prospective evidence. Hosted persistence/scheduling is documented in the branch's collection deployment report.

## Next validation

Preserve the existing NBA/NFL trials. Review this separate candidate's residual diagnostics, bind exact source/config hashes to a new prospective protocol, and then collect fresh paired prices, forecasts and verified outcomes. Promotion requires market-relative probability/calibration improvement and continued price/availability checks. None of this experiment authorizes immediate PLAY influence.
