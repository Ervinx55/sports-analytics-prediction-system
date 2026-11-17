# Separate Recalibration Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the independent tasks and review the combined patch.

**Goal:** Produce reproducible offline NBA/NFL candidates and repair verified outcome/price evidence without changing frozen live models.

**Architecture:** Independent candidate scripts consume explicit historical archives. Evidence-repair tooling validates exact identities and provenance before append-only collection. No production prediction path imports new candidate code.

**Tech Stack:** Python, Node.js, existing Supabase evidence contracts.

**Spec:** ../specs/2026-11-16-separated-recalibration-design.md

## Global Constraints
- No current model/weight/hash/protocol modifications; production influence stays zero.
- No November2026 prospective tuning or new untouched claims for already evaluated2025 data.
- No fabricated historical prices or outcomes; verified inactive is not an under win.
- Provider times, receipt times, player identities, exact lines and outcome reconciliation are mandatory where claimed.

## Review Focus
- Future/outcome leakage in historical features and partition selection.
- Duplicate quotes/player markets inflating sample sizes.
- Null prices or mismatched opposing lines passing price eligibility.
- Stale or post-start quotes being saved as pregame evidence.
- Conflicting/absent participation evidence being scored as a valid outcome.

## Task 1: NBA candidate
- [ ] Add standalone ml/nba_recalibration_candidate.py and tests/test_nba_recalibration_candidate.py.
- [ ] Test chronology, deterministic partitions, invalid inputs, game weighting, frozen-source isolation.
- [ ] Run historical2024 experiment; record all variants, source/config hashes and synthetic-price limitations under docs/evaluations/nba-recalibration-2026-11-16.

## Task 2: NFL candidate and exact prices
- [ ] Add separate scripts/nfl/recalibrate-props.mjs plus reusable modules/tests; explicitly2024only.
- [ ] Fetch/cache verified historical source, fit only development/selection partitions and report later confirmation honestly.
- [ ] Add executable exact paired quote collector and tests for null/stale/mismatched/post-start evidence.
- [ ] Run collection against available current data; wire durable forward collection through a reviewed existing host path or report concrete hosting limitation.

## Task 3: NBA outcome repair
- [ ] Audit111past-start missing selected predictions against current hosted evidence.
- [ ] Build bounded recovery/audit helper; test exact identities, active/inactive evidence, conflicts and append-only behavior.
- [ ] Recover only verified missing outcomes through existing contracts; record before/after and unresolved reasons.

## Task 4: Integration and review
- [ ] Preserve baseline hashes; run full Node/Python applicable checks and secret scan.
- [ ] Independently review candidate methodology and collection/repair correctness; address findings.
- [ ] Commit logical changes and publish a results report with actual candidate metrics, repaired counts and remaining blockers.

## Execution record
Existing clean linked worktree work/deep-dives-release, base788bc2a, branch feature/nba-nfl-recalibration-2026-11-16. Baseline Node suite:282passed,0failed. The older cross-sport-performance worktree is dirty and is read-only reference material for this task.

Completed implementation and verification are recorded in ../../evaluations/2026-11-16-recalibration-and-evidence.md. NBA and NFL candidate tasks and forward price capture are implemented and tested. Outcome diagnosis/fairness repair is complete and deployed, but recovery of the 111 past-start observations is blocked by missing verified player evidence and provider fixture/stat conflicts. No forced settlement was performed. Full suites: 308 Node and 86 Python pass, plus mobile browser regression. The Supabase migration service generated versions 20261116155528 and 20261116155905; exact returned versions and SQL were saved locally because the CLI was unavailable. No production model influence was enabled.
