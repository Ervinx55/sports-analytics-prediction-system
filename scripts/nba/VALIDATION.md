# ESPN historical validation

NBA season `2024` means 2024–25; ESPN calls it season `2025`. The importer
requires all 1,230 regular-season games and excludes the NBA Cup championship.
Each boxscore must reconcile player points to both final team scores. Raw
responses remain in the cache with source URLs and retrieval timestamps.

Run development before requesting the holdout:

```sh
node scripts/nba/import-espn-history.mjs --season=2024 --output-dir=artifacts/nba-development-input
node scripts/nba/backtest-nba-team-model.mjs --season=2024 --input=artifacts/nba-development-input/games.json --output-dir=artifacts/nba-team-development
node scripts/nba/backtest-nba-player-props.mjs --season=2024 --input=artifacts/nba-development-input/player-stats.json --output-dir=artifacts/nba-props-development
node scripts/nba/validate-nba-holdout.mjs --phase=freeze --team-report=artifacts/nba-team-development/report.json --props-report=artifacts/nba-props-development/report.json --input-manifest=artifacts/nba-development-input/manifest.json --output-dir=artifacts/nba-validation
node scripts/nba/import-espn-history.mjs --season=2025 --frozen-policy=artifacts/nba-validation/frozen-policy.json --output-dir=artifacts/nba-holdout-input
node scripts/nba/validate-nba-holdout.mjs --phase=holdout --frozen-policy=artifacts/nba-validation/frozen-policy.json --games=artifacts/nba-holdout-input/games.json --player-stats=artifacts/nba-holdout-input/player-stats.json --output-dir=artifacts/nba-validation
```

The frozen policy records model code hashes, input/report hashes, parameters,
and development-selected predictors. The holdout rejects changed model code,
incomplete schedules, duplicate rows, and unbalanced boxscores. A start marker
prevents accidental repeat evaluation. Preserve this marker and all reports;
do not rerun or tune against an evaluated holdout. An interrupted import can
resume from its cache before holdout evaluation starts.

ESPN has an obsolete Olbrich identity in some 2025–26 summaries. The importer
recovers the canonical athlete and game statistics from ESPN's core API,
records every correction URL in the manifest, and then reconciles the score.
It never fills a missing stat from the difference in team totals.

This is retrospective projection validation. The source does not provide
historical sportsbook prices or publication-time injury/lineup availability.
Team-win Brier is compared with a naive baseline, not with the betting market.
These scripts never enable production influence. The runtime NBA provider is
separate from this historical importer and still needs operational validation.
