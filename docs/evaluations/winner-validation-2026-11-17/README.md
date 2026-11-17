# NBA and NFL winner validation — November 17, 2026

**Development evaluation completed; no candidate qualifies for production. Live NBA/NFL models and approval gates remain frozen.** Rest provides a small NBA research signal; these defensive adjustments did not improve probability accuracy. Historical lineup validation and fresh prospective winner validation remain incomplete.

## What was evaluated

The [predeclared protocol](protocol.md) fixes sources, features, fitting parameters and splits. Source hashes, coefficients, calibration bins, uncertainty and limitations are saved in [NBA results](nba-report.json) and [NFL results](nfl-report.json). The [NBA game rows](nba-evaluation-predictions.csv) and [NFL game rows](nfl-evaluation-predictions.csv) allow independent recomputation of every headline metric. These are reconstructed historical forecasts from previously inspected seasons, **not an untouched holdout or saved pregame predictions**.

NBA uses 1,230 archived games and 26,306 player boxscores with identities and summed team scores reconciled. It fits on 422 games before January 2025, reports January's 227 games separately, and evaluates the same 519 later games in each arm. The 62 early-season exclusions have insufficient prior history. Every target uses only previous Eastern slate dates within 21 days, preventing earlier-start same-slate final scores from leaking into its inputs. No target-game participants or minutes enter a feature.

NFL fits on 224 regular-season games from 2023 and evaluates the same 224 games from 2024. Lagged scoring, opponent strength, rest, and offense-versus-opponent-defense EPA use strictly earlier weeks. Historical quarterback/starter names and prices cannot influence the independent models. Neither cohort has a final tie; the harness separately counts and excludes ties for conditional-on-a-decisive-result binary scoring.

## Results

Lower Brier and log loss mean better probability forecasts. Accuracy alone cannot establish calibration or a profitable edge.

| NBA, 519 later development games | Brier | Log loss | Winner accuracy |
|---|---:|---:|---:|
| Released independent margin baseline | 0.211307 | 0.613034 | 68.02% |
| Baseline + rest | 0.209615 | 0.609095 | 68.40% |
| Baseline + defensive matchup proxies | 0.211615 | 0.613705 | 67.82% |
| Baseline + both | 0.209891 | 0.609746 | 68.40% |

Rest's paired Brier change is −0.001692, with descriptive day-block 95% interval [−0.003269, −0.000073]. Its fixed-bin calibration error worsens from 0.0361 to 0.0448. January shows the same small Brier direction but also worse calibration error. Defense alone worsens Brier; the combined arm's Brier interval includes zero. Overlapping histories and multiple comparisons limit these intervals. Keep rest as a hypothesis for fresh testing; do not declare calibrated probabilities or market superiority. No matched historical NBA price pairs are available in this archive.

| NFL, 224 later development games | Brier | Log loss | Winner accuracy |
|---|---:|---:|---:|
| New independent scoring/strength baseline | 0.219633 | 0.628714 | 61.61% |
| Baseline + rest | 0.220811 | 0.630907 | 61.61% |
| Baseline + defensive EPA matchup | 0.222976 | 0.636021 | 62.95% |
| Baseline + both | 0.224268 | 0.638562 | 62.05% |
| Archived no-vig closing reference | 0.185975 | 0.556217 | 74.33% |

All NFL additions worsen Brier/log loss. Their paired week-block intervals against the independent baseline include zero; all candidates are worse than the closing reference in this descriptive comparison. Even though some calibration-bin and accuracy measures improve, there is no support for promotion. Closing prices have unknown original observation times; they are retrospective references, not executable quotes or an ROI simulation. The existing live NFL moneyline has zero independent contribution, so its market-reference output is not presented as a validated independent winner model.

## Lineups and current corrected data

True lineup effects are **not evaluable** in either historical archive: pregame publication/receipt timestamps are missing. Actual target-game starters, minutes and participation would be hindsight. NBA defense features are prior player-summed team boxscore proxies, which omit team-only rebounds/turnovers; they are not individual defender or defense-versus-position estimates. These limitations apply to both weak and strong defensive matchups.

The [read-only current-data audit](current-evidence.md) and [queries](current-evidence.sql) found zero usable NBA/NFL winner forecast/outcome pairs in the audited public ledgers. There are 44 invalid NBA moneyline rows across 11 payload events, with no settlements; there are no NFL winner rows. Corrected current NBA **prop** records cannot count as winner samples.

The latest audited collector completed at 15:51 UTC November 17 but reported 91 invalid histories remaining and no new enrolled forecasts. Across 10,218 prop forecast rows, 5,428 carry an input-revision review flag. These are row counts, not independent games. This task audits that blocker; it does not claim all current historical conflicts are repaired.

## Decision and remaining work

No weights, live forecasts, model approvals, provider configuration, database rows, or production application files change in this branch. No retrospective record is relabeled as a prospective forecast.

Next, repair the remaining source-history/paired-price blockers, then capture timestamped team-level availability and lineup/rotation context alongside independent winner predictions. Before confirmation begins, register a future window and coverage/accuracy criteria, pin candidate hashes, and store immutable pregame forecasts with matched prices and verified outcomes. The fresh comparison has **not started** in this task. NFL candidates need further development; NBA rest needs confirmation and calibration review. Keep both live models frozen while doing so.

## Reproduce

From the repository root, using the source directories pinned in the reports and a new output directory for every run:

```text
node scripts/evaluation/nba-winner-validation.mjs --source=<nba-development-recheck> --output=<new-nba-output>
node scripts/evaluation/nfl-winner-validation.mjs --cache-dir=<nfl-source-cache> --output-dir=<new-nfl-output>
node --test tests/node/*winner-validation*.test.mjs
```

Both runners are offline and reject source hash conflicts. They preserve source/model provenance and refuse to overwrite prior experiment outputs. Private raw caches remain outside the repository. The published CSVs contain reconstructed evaluation probabilities, not authorized bets.

## Verification

342 Node tests and 78 Python tests passed; the reconstruction secret scan and whitespace checks passed. Mobile research/worksheet browser fixtures passed in offline route mode; this environment denied the normal loopback navigation. No frontend changes are included.

Independent review recomputed all reported point scores and candidate-versus-baseline bootstrap intervals, checked 167,135 NBA and 100,425 NFL history references against the source chronology, and verified outcomes and artifact hashes. Review found and cleared two NFL runner safeguards: fixed protocol source pins independent of the supplied manifest, and atomic output reservation with exclusive writes. The hardened rerun produced byte-identical features, coefficients and predictions. Original and reviewed full artifacts remain separately preserved outside the repository. No review blockers remain within this retrospective scope.
