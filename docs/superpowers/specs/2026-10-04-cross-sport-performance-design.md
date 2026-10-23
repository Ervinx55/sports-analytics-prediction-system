# Cross-sport prediction performance and model improvement

Status: written design approved by the user on October 4, 2026. No production model promotion is authorized by this document.

## Intended outcome

Track every supported model's saved pregame predictions and eventual outcomes so Edge Lab can identify weak market types and evaluate revisions. Show MLB, NFL, NBA and CFB coverage honestly, including sports with no connected model. Preserve existing betting qualification gates and zero influence for unvalidated challengers.

## Evidence motivating the change

Production result ledgers currently contain MLB only. The October audit has 1,290 deduplicated settled markets across 39 games. Total-bases and strikeout PLAY probabilities underperform the market in small samples. A fixed additional market blend improves those model scores but does not beat the market; it is not ready for promotion. The dashboard's audit ROI is not an actual wager ledger.

## Capture and identity

Add an append-only prediction ledger and append-only decision issuance records. Each prediction stores canonical sport/event identity, source event IDs, start time, captured time, model version, team/player identity, market type, side, exact line, model and market probabilities, push probability where applicable, contemporaneous odds/book and provider timestamp. Raw provenance is retained. Model availability is explicit; a schedule event or raw sportsbook quote is never a model prediction.

Use an idempotency key based on source observation identity/version for ingestion. Canonical event mappings must be unambiguous; ambiguous matches are unresolved. Link legacy MLB records rather than replacing them. NFL/NBA team and prop adapters capture model outputs prospectively through authenticated jobs. CFB displays `model unavailable` until an independent model adapter exists; it must not relabel sportsbook implied probability as a model.

Capture genuine saved predictions only before the recorded event start and preserve all revisions. The default all-predictions view selects the last valid pregame snapshot for each exact market and model version. The PLAY portfolio selects the first actually issued, fully qualified PLAY with the odds available at that time. Later snapshots cannot retroactively turn a PASS into a PLAY or improve the entry price. Legacy reconstructed decisions are separately labeled and excluded from prospective promotion evidence unless issuance can be established from contemporaneous records.

## Settlement

Reuse the tested MLB grading rules and add official-final-score/stat adapters for NFL and NBA using authorized public sources (ESPN where supported). CFB settlement support can share the football result adapter once model predictions exist. Match exact canonical event and player IDs; reject fuzzy ambiguous settlement.

Only final events with complete required values settle. Outcomes are WIN, LOSS, PUSH, VOID, or UNRESOLVED, with source/time and settlement policy version. Missing stats are not zero. A known nonparticipant is voided only under an explicitly recorded market participation rule; otherwise remains unresolved. Postponed games remain unresolved until a final result or authoritative cancellation/void rule exists. Corrections append a revision and supersede the prior settlement without erasing audit history. Retry outages with bounded backoff. Paginate backlog processing and resume beyond seven days so old unsettled events are not abandoned.

## Results and improvement evidence

Extend Results with sport, model version, team/prop, market, date and decision-cohort filters. Separate all model predictions, cleared PLAYs, shadow predictions, and PASS counterfactuals. Show W/L/push/void/unresolved, win rate excluding pushes and voids, number of distinct games, settlement coverage, and missing-data counts. Empty sports show no captured predictions, not 0% accuracy.

ROI uses one unit at the captured American price, with explicit priced denominator and hypothetical label. Missing/malformed odds exclude both winning and losing rows from ROI. Actual wager profit is unavailable without execution records. Pushes return zero; voids are excluded from the staked denominator. Equivalent half-hit/half-total-base outcomes are deduplicated in portfolio summaries under a deterministic pre-outcome selection rule, while exact-market research remains separately inspectable.

Compare model and market Brier/log loss on identical complete rows, conditioning on no push when market probabilities are conditional. Display reliability bins and sample coverage. Group uncertainty and train/test partitions by game and chronological period; repeated snapshots and mirrored market sides do not count as independent games. Preserve first-issued PLAY performance separately from latest-snapshot predictive diagnostics.

## Research and release boundaries

The current audit is development evidence only. Freeze any proposed challenger formula and evaluation protocol before obtaining its future evaluation outcomes. Existing examined NBA/NFL holdouts are not reused as untouched tests. Promotion requires prospectively collected, paired evidence against the market and current model with game-level uncertainty; sample-size/power and acceptance criteria are defined in the specific frozen experiment before it starts. Tracking alone never changes weights or authorizes a PLAY.

## Security and production rollout

New tables have RLS enabled; only service-role jobs write. Public APIs expose read-only aggregate/result projections, not service credentials. Use existing pipeline job authentication and add capture/settlement coverage to health reporting. Avoid the Vercel function-count limit by extending existing routes. Deploy migration and adapters behind disabled capture flags, verify on fixtures and a preview, enable prospective capture per supported sport, reconcile legacy MLB by IDs, then expose the Results view. Rollback disables jobs and UI exposure while preserving audit records.

## Acceptance criteria

- Duplicate capture/retry does not change records or portfolio counts.
- Post-start prediction, stale odds, missing probability and ambiguous identity never enter valid pregame performance cohorts.
- All supported team sides, spreads, totals and prop outcomes grade correctly, including pushes, missing stats, postponed events and corrected finals.
- A later better price cannot improve the recorded first-issued PLAY return.
- Repeated/mirrored/equivalent observations have explicit deterministic counting rules.
- Model and market scores share identical rows and push conventions; null prices/probabilities are never coerced to zero.
- Empty NFL/NBA/CFB coverage is visible until real predictions are captured and settled.
- Capture and settlement outages preserve unresolved records and recover through paginated retries.
- Full Node/Python suites and mobile/desktop Results rendering pass; no NBA/NFL influence or production weights change as a side effect.
