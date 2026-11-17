# Current winner evidence audit — 2026-11-17

Read-only Supabase project yeoxroijaptomomshdii audit, captured 2026-11-17 15:59:53 UTC. No production data, models, gates, or code were modified.

| Evidence | NBA | NFL |
|---|---:|---:|
| Valid typed winner predictions in audited ledgers | 0 | 0 |
| Legacy winner observations (model_audit_observations / market_grade_observations) | 0 | 0 |
| Moneyline performance_predictions, recognizing sport inside payload | 44 rows / 11 events | 0 |
| Those winner rows with any settlement | 0 | 0 |
| Usable valid pregame winner forecast + binary outcome pairs | 0 | 0 |
| Evaluable full-feature prospective winner samples | 0 | 0 |

The 44 NBA winner rows were captured at 2026-10-29T23:41:12.299Z, model NBA Team Markets v1-espn-shadow. All are invalid SHADOW rows; typed sport and event_key are NULL. Their payload declares NBA and gives 11 event IDs. All have rawIndependentProbability in provenance, but final forecasts have NON_INDEPENDENT_MODEL, missing exact-result mapping, missing contract identity, missing settlement rule, and unknown probability basis. UNKNOWN_PROBABILITY_BASIS appears twice per row in the stored reason array; query 18 therefore returns 88 reason occurrences, not 88 forecasts. None can be promoted to a usable independent forecast pair.

All public base-table names were inventoried. No other NBA/NFL winner-specific forecast table was identified. The dedicated cfb_prospective_forecasts table is for CFB. game_results has only 46 MLB rows; both legacy observation tables have only MLB. This zero-pair finding is scoped to the audited ledgers; it is not a claim that no offline historical winner dataset exists.

## Corrected NBA props are a separate sample

| Prop evidence | Count |
|---|---:|
| Quote observations | 7,950 / 63 events |
| Forecast rows | 10,218 / 58 events |
| Outcome identities | 6,702 / 56 event IDs |
| Outcome WIN or LOSS identities | 6,384 |
| Official INACTIVE outcomes | 318 |
| Forecast rows joined to binary outcomes | 9,360 |
| Binary forecast rows without current input-revision-review flag | 4,564 |
| Forecast rows requiring input revision review | 5,428 |
| Pregame official availability published and retrieved by forecast issue time | 9,970 / 10,218 |
| Forecast rows with confirmed participation | 0 |
| Forecast rows with production-eligible minutes or forecast | 0 |

Forecast counts can include multiple model hashes/scopes, both sides, lines and books. These are not independent games or winner samples. The 4,564 unflagged binary prop rows are not asserted to pass every validation rule. No rest/lineup feature coverage for an eligible winner cohort can be established because that cohort is empty. Prop injury timestamps do not establish team-level injury, rest, confirmed lineup, or rotation snapshots for the historical winner model.

2,130 stored summary objects comprise 1,882 game snapshot rows for 194 distinct payload game IDs, plus 248 raw BDL documents. 242 game snapshot rows covering 30 distinct payload game IDs carry official correction metadata. Summaries are observed after their own games, as final-result data should be; they cannot establish what was known before those games. Dedupe by payload game ID and apply correction provenance before any offline use.

Latest collector report completed 2026-11-17T15:51:15.089665Z:
- history.games=106; history.invalid=91; reconciliation.remaining=91; history.complete=true means retrieval completion, not zero invalid games.
- participationConflicts=0; blocked=356.
- faults: SGO_OWN_TEAM_HISTORY_NOT_COMPLETE and QUOTE_NOT_CURRENT_PAIRED.
- enrolledForecasts=0; matchesFrozenModel=true; productionWeight=0.

Therefore corrected data must not be described as globally zero-issue. This report does not attempt to re-adjudicate the remaining 91 invalid histories.

## Model classification and local sources

- work/winner-validation-2026-11-17/sharp-service/lib/nba-vnext-baseline.js: independent research-only score-margin ridge baseline; no odds, injury, rotation or pace inputs; model version nba-independent-margin-ridge-v0-unvalidated; productionEligible=false.
- work/winner-validation-2026-11-17/sharp-service/lib/nba-vnext-backtest.js: historical score-only walk-forward audit. It synthesizes forecastAt as start minus 1ms and uses earlier scheduled starts; it does not prove historical receipt timestamps or prospective forecast issuance. It explicitly has no closing-market baseline or ROI evidence.
- work/winner-validation-2026-11-17/sharp-service/lib/nfl-model.js: NFL_MARKET_SHRINKAGE moneyline=0, spread=0, total=0.25. Moneyline output is a market reference under this configuration.
- work/winner-validation-2026-11-17/sharp-service/lib/edge-vnext-board.js: recognizes market_only versus market_blend, explicitly sets independentForecast=false and keeps AVOID, productionEligible=false.
- work/winner-validation-2026-11-17/supabase/migrations/20260922234532_create_model_audit_and_grading_ledger.sql: legacy audit/results schema.
- work/winner-validation-2026-11-17/supabase/migrations/20260923034936_create_team_market_results_ledger.sql: team-market result schema.

Historical completed winner tests can remain valid as limited retrospective tests on their own sources. They are not prospective full-feature validation of the current corrected NBA prop dataset. Retain the live model/gate freeze.

Exact SQL is in current-evidence.sql. The complete decoded query results are retained in the local outputs/winner-validation-2026-11-17/current-evidence/audit.json artifact; this repository copy contains the aggregate readout. Query 05's strict typed sport filter returned no rows; query 09 intentionally inspected payload sport to find the invalid NBA records. Stored query 10 initially labels distinct storage IDs as events for summaries; query 20 supplies the correct 194 payload game IDs.
