# Production history and qualification audit — 2026-10-29

Read-only audit of project yeoxroijaptomomshdii. No model weights or qualification thresholds changed.

## Historical data is present

- model_audit_observations: 558 snapshots / 48 distinct games.
- market_grade_observations: 2,687 snapshots / 47 distinct games.
- player_prop_observations: 9,772 snapshots / 30 distinct games.
- All three sources contain MLB records. Game sets overlap; counts must not be summed as independent games.
- Latest observation capture: October 11 UTC. Historical graded rows remain in candidate_grades, team_market_results and player_prop_results.
- The new performance ledger is empty and its capture/settlement jobs are inactive. A successful reader response therefore does not establish restored history or functioning tracking.

## Qualification evidence

sharp_gate_history contains 72 FINAL_PLAY snapshots across nine MLB games: 16 SINGLE_BOOKMAKER_DIRECT_FALLBACK snapshots across two games and 56 SINGLE_TOP_SHARP_FALLBACK snapshots across seven games. These are historical gate outputs, not proof of wager execution or publication under the new ledger contract.

The most frequent sharp-gate reasons are absent valid two-sided sharp prices (652 + 251 pending snapshots; 240 + 72 deadline failures). These are repeated snapshots, not independent rejected opportunities.

## Active failure

At 07:20–07:30 UTC on October 29, cron dispatches succeeded but downstream HTTP calls failed:

- Verification, weather and prop CLV: HTTP 500 with PGRST303, JWT issued at future.
- Model audit: HTTP 500 through the tau deployment decision/verification chain.
- Prop grading, team grading and sharp sources: HTTP 500 with generic object errors; do not attribute these conclusively without their internal logs.
- Prop capture: HTTP 200 with rowCount 0, which is not evidence of useful capture.

The direct database repair currently applies only to prediction-performance reads. It did not repair REST authentication throughout ingestion, grading or verification. Do not report cron success as pipeline success.

## Import limitations

All 9,772 prop and 2,687 team rows lack the exact raw.quoteAt, raw.settlementRule and raw.probabilityBasis fields expected by the legacy adapter. Other nested historical evidence has not yet been audited. Importing these unchanged will create diagnostic exclusions, not eligible calibration samples. Never substitute capture time for quote time or invent historical settlement policy. Historical diagnostic results should remain visible separately from prospective qualified PLAY metrics.

## Remaining work

1. Repair/verify server-side Data API authentication across the capture and grading pipeline (or implement narrowly scoped, tested direct DB adapters). Preserve authorization on writes.
2. Restore a clearly labeled historical results view with deduplication and explicit evidence gaps.
3. Replace hard-coded coverage labels with observed runtime/capture status, keeping provider inventory unknown until actually checked.
4. Verify each sport's capture and settlement path before enabling its jobs; check persisted records and downstream HTTP outcomes.
5. Evaluate calibration on independent pregame samples and untouched holdout data. Historical MLB observations do not establish NBA/NFL model accuracy or guarantee a daily qualifying play.
