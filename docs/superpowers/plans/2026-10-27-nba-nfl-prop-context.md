# NBA and NFL Prop Context Implementation Plan
> Use subagent-driven-development with disjoint NBA/NFL tasks and shared validation owned by the coordinator.
Goal: implement evidence-backed NBA and NFL shadow context challengers without promoting live plays.
Architecture: source adapters -> timestamped normalized observations -> sport-specific context and baseline -> frozen evaluation artifacts -> research explanations.
Tech stack: existing Node ESM, Python analysis tools, ESPN and nflverse; no new paid dependencies.
Spec: docs/superpowers/specs/2026-10-27-nba-nfl-prop-context-design.md

## Global constraints
Production eligibility false and weight zero. No unearned NBA probability estimates. No present-day rosters or injury knowledge in retrospective joins. Do not consume an unverified holdout while tuning. No fabrication of missing rankings, minutes, possessions or game logs.
Existing feature/private-accounts worktree is isolated from master. Preserve unrelated SQL modifications and untracked preview assets.

## Review focus
Same-game/post-cutoff leakage; duplicate observations; missing minutes/position/possessions; incomplete league ranks; sparse position samples; stale or failed requests; double-counted opponent adjustments.

## Task 1: NBA source and baseline/context challenger
Files: new sharp-service/lib/nba-prop-context.js, NBA source adapter as needed, tests/node/nba-prop-context.test.mjs and fixture data.
- [x] Inspect ESPN historical summary shape and source limits.
- [x] Add failing tests for cutoff/final/identity validation and complete/missing features.
- [x] Implement completed-game player baseline and team form/efficiency/position context with provenance and sample counts.
- [x] Provide source loader with bounded cache/timeouts; unknown source availability must not imply point-in-time historical eligibility.
- [x] Run tests and document what is supported versus blocked.

## Task 2: NFL context challenger
Files: new sharp-service/lib/nfl-prop-context.js, integration in nfl-player-props.js or nfl-event-projections.js, tests/node/nfl-prop-context.test.mjs.
- [x] Inspect existing nflverse schedules/stats and use historical player positions.
- [x] Test pre-cutoff game filtering, deduplication, missing values and position-specific allowance.
- [x] Expose team form/offense/defense/position evidence alongside current baseline, preserving current calibrated projections.
- [x] Version challenger features; do not invent learned coefficients.
- [x] Run targeted tests.

## Task 3: Frozen evaluation contract
Files: scripts/props/evaluate-context.mjs, tests/node/prop-context-evaluation.test.mjs.
- [x] Define auditable input and experiment manifests with development/holdout cutoffs and previously-consumed holdout guard.
- [x] Evaluate paired projection baseline/context errors and optional exact-line Brier/log loss using only valid rows.
- [x] Provide ablation group reports with game counts, sample coverage and no automatic promotion.
- [x] Test leakage, duplicate/game weighting and invalid probability/price evidence.

## Task 4: Integration, review and validation
- [x] Integrate available NBA and NFL context into research endpoints/detail views; unavailable fields stay explicit.
- [x] Audit real source samples; run existing full Node/Python checks.
- [x] Independent review, fix findings and commit logical changes.
- [ ] Publish validated preview and report source/training/holdout blockers honestly. Production remains unchanged.

## Validation checkpoint (2026-10-28)
363 Node tests and 49 Python tests pass. Live ESPN summary 401909877 parsed with 22 complete player rows; team possessions use totalTurnovers. Independent review caught and repaired conflicting NBA duplicate games, repeated NFL context computation, unmatched ablation cohorts, inconsistent outcome/game identities and incomplete probability evidence.

Scope delivered is source/context infrastructure and descriptive evaluation, not a trained challenger. No weights have been fitted, no historical betting-edge claim is supported, and no holdout has been consumed. Historical source publication timestamps, archived exact pregame prices, projected NBA minutes/injury knowledge and complete league comparison coverage remain prerequisites. Game-level uncertainty intervals, calibrated distributions, fitted/shrunk context adjustments and durable prospective capture are outstanding. The evaluator always blocks promotion and reports its limitations.
