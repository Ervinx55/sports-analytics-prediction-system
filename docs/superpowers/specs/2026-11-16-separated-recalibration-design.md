# Separate NBA/NFL recalibration and evidence repair

## Authorization and purpose
The user approved the November 16 readiness-audit recommendation: develop separate NBA and NFL recalibration candidates and fix missing outcomes and price data. This document records the implementation choices within that approved scope. Current NBA/NFL production models and registered November NBA feasibility comparisons remain frozen.

## Approach
Build independent offline candidates from declared historical development data. Compare each market against its identified baseline using chronological development partitions and preserve all variant results. Reusing old evaluated data is allowed only with an explicit development label; it is not a new untouched holdout. Do not fit on the ongoing November 2026 comparison.

Changing live weights now would contaminate the comparison. Waiting for every outcome would unnecessarily delay historical development. Separate candidates plus evidence repairs allow both tasks to proceed without either problem.

## Candidate boundaries
- NBA: a standalone historical probability experiment, preserving prior-only projection construction and testing residual dispersion conditional on projected minutes. Save source hashes, partitions, deduplicated/game-balanced denominators, all variants, selected configuration, and zero production influence. Synthetic thresholds cannot establish sportsbook profitability.
- NFL: a separately versioned 2024-only chronological recalibration with explicit current v2.1 baseline identity, pregame feature chronology, shrunk market-specific bias/residual parameters, and selection/confirmation reporting. Never silently rerun 2025 or overwrite the incumbent.
- Neither candidate is a live approval, and neither is wired into production decisions by this change. A new future untouched cohort is required for promotion review.

## Missing evidence
Trace unresolved NBA outcomes to authoritative results and participation evidence. Preserve quarantine for actual identity/stat conflicts, keep inactive separate, and use existing immutable outcome contracts. Only append verified absent outcomes; never guess or rewrite frozen forecasts.

NFL exact price capture must retain event/player/stat/line/side/book identity, both opposing prices, provider timestamps, receipt time, kickoff, and model version where available. Reject stale, mismatched, in-play or incomplete pairs. Preserve unpriced observations as excluded evidence, never reconstruct past prices from current quotes. Provide a runnable durable forward collector and report any source/hosting blocker explicitly.

## Validation and release
Use the existing isolated worktree, targeted chronology/identity/freshness tests, full applicable regression checks, and independent review. Commit logical changes. Production data repairs require verified source evidence and before/after counts; any collector release must pass checks and retain zero model influence. Provider data unavailable or unverifiable remains an explicit blocker.
