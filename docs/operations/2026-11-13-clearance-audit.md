# NBA clearance audit — November 13, 2026

The lack of cleared plays is not evidence that every market failed a value test. The audit found incomplete connections and missing model approval, as well as genuine validation gaps.

## Reproduced faults and this repair

- The independent NBA baseline always emitted `NO_BOOK_QUOTE` without reading the odds board. All nine November 13 NBA forecasts carried this reason while the board contained their prices. The explicit `quotes=1` refresh now joins the board by NBA home/away identities and start time, allowing documented abbreviation aliases. An ambiguous match is rejected. Prices never enter model fitting.
- The NBA quote collector requested eight events and discarded `nextCursor`. The ninth game was omitted. It now requests up to two pages of 16 events, deduplicates overlapping IDs, preserves the oldest page observation timestamp, and reports incomplete pagination on a later-page failure or cap. It still covers **DraftKings points/rebounds/assists**, not every prop/book. `partialCoverage` remains true for that limited market scope.
- The research UI now separates most-likely winner forecasts from price comparisons and displays remaining checks instead of a generic uncalibrated status for every cause. Neither list is a production clearance.

## Price comparison rules

Only fresh, available, two-sided Pinnacle, Circa, and BookMaker moneylines enter the sharp reference. Quote age is limited to ten minutes; paired timestamps must be within two minutes. The board must also be recent, and started/cancelled/postponed or ambiguous events are rejected. Weights are 60/25/15, renormalized to the available sharp pairs; these are research conventions, not empirically estimated weights. One book is explicitly labelled a single reference. Retail comparison is restricted to DraftKings, FanDuel, BetMGM, Caesars and bet365; unknown books and exchanges are excluded. User account access is not verified.

`rankings.winners` sorts the independent experimental win estimates. `rankings.value` sorts their estimated return at the retail quotes, and also supplies a separate sharp-market expected return. Large model/market differences require investigation, particularly with missing injury adjustments; they are not established edges. Model approval, calibration, and injury/rotation requirements remain in place. No automatic BUY, stake or wager is enabled.

## Live verification

The November 13 replay paired a fresh `/api/board` response with a subsequent `/api/edge-vnext?mode=nba&live=1&date=2026-11-13&audit=1` response. All 21 historical dates were available. The repaired join matched **9/9 games, 9 with sharp pairs, and 18 priced forecast sides**. The remaining reasons were `NO_INJURY_ROTATION_ADJUSTMENT` and `UNCALIBRATED` for all nine games. Independent probabilities were unchanged.

A separate direct local fetch had only 15/21 historical dates available and correctly withheld probabilities. This source-reliability issue is not fixed by the price join.

Validation: `node --test tests/node/*.test.mjs` (205 passing); `PYTHONPATH=. python -m pytest -q` (78 passing, one dependency deprecation warning). Browser script behavior and escaping have executable tests. A screenshot check could not run because Chromium's socket creation was denied in this runtime; visual rendering is not claimed as verified.

## Remaining operational blockers

Read-only database checks found no rows in `nba_model_approvals_v1`. The preceding 24 hours contained 37,598 decision records, all including “No matching reviewed model approval is active.” These are repeated evaluations, not distinct bets. The main governance registry exposed four MLB entries, so it is not proof of NBA approval. Separate NBA forecast tables do contain experimental model versions; none should be described as approved solely because records exist.

The current NBA prop forecast versions still carry availability, participation, projected-minutes, cross-provider validation, settlement and promotion blockers. The official-Available-only rule also requires a targeted audit: healthy players omitted from an injury report must not be falsely called injured, but omission alone cannot be relabelled confirmed active. Complete team-report coverage, game identity, roster and any late updates need explicit handling.

The reviewed-decision HTTP endpoint returned 503 during the audit. Its underlying clearance and source issues are not resolved in this repair. Health advisors reported no health findings; that does not prove endpoint health.

## Concrete next validation work

1. Reconcile the deployed NBA prop evaluator and reviewed-decision read path with version-controlled source. Record distinct selection counts and rejection reasons, separating model-not-reviewed, source failure and negative expected value.
2. Evaluate the frozen NBA forecast versions against correctly matched, settled outcomes and contemporaneous sharp quotes. Report chronological holdout performance and uncertainty by market; do not count repeated refreshes as new samples.
3. Implement and validate projected minutes/usage and injury/rotation adjustments, with explicit states for confirmed active, expected active, questionable, out and unavailable evidence. Apply observed weather effects only where relevant, never an automatic forecast-rain downgrade.
4. Complete an evidence-backed model review only if results support it. The absence of approval is a workflow gap; inserting an approval to force more plays would conceal the underlying missing validation.

This repair fixes evaluation coverage and price attachment. It does **not** establish a profitable model or complete an all-sports clearance system.
