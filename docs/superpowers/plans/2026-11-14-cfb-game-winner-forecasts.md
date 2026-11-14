# CFB Game-Winner Forecasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run independent, tracked CFB winner forecasts on the existing research board.
**Architecture:** Authenticated, bounded collection writes source evidence to private Supabase tables. A pure JavaScript rating/evaluation module produces frozen model artifacts and immutable prospective captures; an existing Vercel API view serves cached forecasts independently of quotes.
**Tech Stack:** Existing Node ESM, Supabase Postgres, vanilla browser modules; no new dependency or Vercel function.
**Spec:** `docs/superpowers/specs/2026-11-14-cfb-game-winner-design.md` (approved by user).

## Global Constraints

- NBA/NFL frozen; CFB research cannot authorize PLAY.
- FBS-vs-FBS, full-game winner only; verified IDs and venue; eight verified games per team within 18 months.
- 2024 warm-up, 2025 development, 2026 through November 13 retrospective holdout; no changed split if coverage fails.
- First valid capture 24 hours to 30 minutes before kickoff; immutable; refreshed display separate.
- Provider rate/quota limits and current quote integrity checks stay in place; no secrets in clients.
- Implement in this existing isolated feature branch. Prior authorization covers safe test deployments, commits, PRs, and validated releases; do not ask again for execution mechanics.

## Review Focus

- Scoreboard pagination repeats a page: detect/reject incomplete history, never silently calibrate on a truncated season (Task 1).
- A team changes division or aliases: use season evidence and unique IDs, exclude ambiguous joins (Task 1).
- Same-day results and future outcomes: availability-bound replay, immutable evaluation snapshots (Task 2).
- Optional forecasts fail or arrive after navigation: keep quote rows and discard obsolete responses (Task 3).
- Duplicate collector runs and corrected results: idempotent capture and append-only evidence; never replace first prediction (Task 1/2).

### Task 1: Source evidence and bounded hosted collection

**Files:** `sharp-service/lib/cfb-sources.js`, `sharp-service/handlers/cfb-forecasts.js`, `sharp-service/api/dashboard.js`, generated migration under `supabase/migrations`, `tests/node/cfb-sources.test.mjs`, `tests/node/cfb-handler.test.mjs`, `scripts/cfb/collect.mjs`.
**Interfaces:** `normalizeEspnGame(event, fetchedAt)`, `normalizeSgoGame(event, fetchedAt)`, `reconcileGames(sgo, espn)` return normalized evidence/reasons. Handler accepts public GET and authenticated POST action/season/cursor; all upstream URLs server-defined. Store source snapshots, collection progress and research artifacts in `cfb_research_documents`; immutable forecasts in `cfb_prospective_forecasts`; outcomes in separate append-only records.
- [ ] Write/run failing tests for malformed scores, completion, division/venue evidence, duplicate identity, pagination, secret/auth rejection, source errors and bounded request parameters.
- [ ] Implement adapters and private storage migration; apply/verify RLS and role grants.
- [ ] Add existing dashboard `cfb=1` dispatch, bounded SGO/ESPN collection using shared provider protections; inspect actual hosted history schema and coverage before fitting.
- [ ] Verify tests, commit source/collector changes, run read-only hosted probes and collect eligible evidence. Record coverage blockers honestly.

### Task 2: Frozen ratings, evaluation and tracking

**Files:** `sharp-service/lib/cfb-model.js`, `sharp-service/lib/cfb-evaluation.js`, `tests/node/cfb-model.test.mjs`, `tests/node/cfb-evaluation.test.mjs`, collector/handler from Task 1.
**Interfaces:** `forecastGames(history, upcoming, config, asOf)` returns forecasts/exclusions. `evaluateCandidates(history, manifest)` selects on development only, then evaluates holdout once and returns config/hash/metrics/coverage. Refresh stores display snapshot and inserts first qualifying forecast without overwriting.
- [ ] Write/run failing tests for same-day leakage, season regression, neutral venue, opposite probabilities, history window, duplicate IDs, holdout independence, Brier/log loss and snapshot timing/rescheduling.
- [ ] Implement deterministic rating replay, configured grid, frozen artifact and explicit missing-data report; add finalized outcome settlement with immutable prediction inputs.
- [ ] Run historical validation only when source completeness passes; otherwise persist the blocked report and continue source repair without manufacturing estimates.
- [ ] Verify tests and commit model/tracking changes.

### Task 3: Quotes-first research integration

**Files:** `sharp-service/research-loader.js`, `sharp-service/cfb-research.js`, `sharp-service/research.js`, tests under `tests/node` and existing browser suite.
**Interfaces:** `attachCfbForecasts(rows, payload, now)` binds exact event, team, kickoff and full-game moneyline only; status remains research. GET `/api/dashboard?cfb=1` returns cached forecasts, evaluation status and source readiness, bounded by data age.
- [ ] Write/run failing tests for source/time/event/team/period mismatch, stale forecasts, request failure and obsolete navigation.
- [ ] Start optional forecast read with quotes, render quotes first, then attach eligible research probabilities. Show rating/venue/history/cutoff explanations and no-clearance status.
- [ ] Verify desktop/mobile and first-capture/current-display separation; commit UI changes.

### Task 4: Operational validation and release

**Files:** deployment/test reports under task `outputs/cfb-forecast-2026-11-14`; implementation ledger in the same directory; appropriate schedule migration only after collector verification.
- [ ] Run entire Node/Python suite and existing CI/browser checks; fix failures and obtain fresh whole-branch review.
- [ ] Verify authenticated scheduled collection, lock/overlap behavior, public denial of writes, source outage, quota/cooldown and stored forecast reads on hosted staging.
- [ ] Capture eligible prospective rows before kickoff; confirm counts in SQL and UI. If no forecast qualifies, show truthful named blockers, not synthetic probabilities.
- [ ] Merge/promote only the tested production-safe build, verify canonical site and report forecast coverage, validation results, outstanding blockers, and frozen-model status.

## Execution ledger

Native execution in the current branch follows the user's explicit "Approve and build" instruction. The plan refines the approved design without a new product or permission choice. Use `outputs/cfb-forecast-2026-11-14/implementation-ledger.md` for detailed evidence and rulings.
