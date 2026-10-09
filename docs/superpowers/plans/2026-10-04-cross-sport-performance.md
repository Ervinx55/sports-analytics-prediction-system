# Cross-Sport Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce trustworthy cross-sport prediction and PLAY records that support model evaluation without changing production betting weights.

**Architecture:** Add an append-only canonical ledger alongside existing MLB tables. Authenticated capture and settlement workers write it; a read-only performance endpoint supplies the existing Results tab. Pure JavaScript modules own identity, grading, cohort selection and metrics so Node tests can verify behavior independently of deployed services.

**Tech Stack:** Node 24, JavaScript modules, Supabase Postgres/RLS and Deno Edge Functions, existing Vercel static dashboard, Python reconstruction checks.

**Spec:** `docs/superpowers/specs/2026-10-04-cross-sport-performance-design.md` (approved).

## Global Constraints

- Preserve existing betting qualification gates and zero influence for unvalidated challengers.
- Capture genuine saved predictions only before the recorded event start and preserve all revisions.
- Missing stats are not zero.
- Actual wager profit is unavailable without execution records.
- Existing examined NBA/NFL holdouts are not reused as untouched tests.
- New tables have RLS enabled; only service-role jobs write.
- Avoid the Vercel function-count limit by extending existing routes.
- CFB displays `model unavailable` until an independent model adapter exists.
- Keep NBA validation-only changes out of master; start execution from current production master in an isolated branch, reuse only explicitly tested adapters.

## Review Focus

- A rescheduled game keeps its canonical identity; start revisions never make a prediction captured after the original kickoff eligible (Tasks 1–3).
- Two concurrent workers cannot create duplicate snapshots or replace first issuance with a better price (Tasks 1–2).
- NFL regulation ties, NBA overtime and MLB shortened finals use the stored market settlement rules, not guessed defaults (Task 4).
- API timeouts, HTML responses and missing pagination pages do not imply zero results or complete coverage (Tasks 3–6).
- Changing filters during refresh cannot mix different sports or show an old successful response as current (Task 7).

## Shared interfaces

`Prediction`: `{id, sourceKey, sport, eventKey, playerKey, marketType, side, line, modelVersion, modelMode, modelAvailable, capturedAt, startsAt, quoteAt, odds, book, modelProbability, marketProbability, pushProbability, probabilityBasis, settlementRule, sourceIds, provenance, eligibilityReasons}`. `sport` is MLB/NFL/NBA/CFB; `modelMode` is LIVE/SHADOW; times are UTC ISO strings. `probabilityBasis` explicitly distinguishes CONDITIONAL_NO_PUSH and UNCONDITIONAL. Nullable values remain null. Stable canonical source IDs are required for grading; ambiguous identities receive exclusion reasons.

`Decision`: `{id, predictionId, issuedAt, status, qualified, evidence, legacyReconstructed}`. Status is PLAY/PASS/PENDING. PLAY requires evidence of the complete final qualification, not an upstream raw candidate label. A shadow PLAY is a shadow candidate, never a qualified production PLAY.

`Settlement`: `{predictionId, revision, outcome, actualValue, awayScore, homeScore, source, sourceUpdatedAt, settledAt, ruleVersion, reason, supersedesRevision}`. Outcomes: WIN/LOSS/PUSH/VOID/UNRESOLVED. Latest authoritative revision controls reporting; old revisions remain accessible.

`PerformanceResponse`: `{generatedAt, coverage, filters, summary, groups, reliabilityBins, rows, nextCursor, warnings}`. Summary includes wins/losses/pushes/voids/unresolved, winRate, distinctGames, pricedCount, hypotheticalUnitProfit, hypotheticalRoi, pairedCount, modelBrier, marketBrier, modelLogLoss, marketLogLoss. Empty denominators return null.

## Task 1: Ledger contracts and idempotent storage

**Files:** create `supabase/functions/_shared/performance-contract.mjs`, `tests/node/performance-contract.test.mjs`, `tests/supabase/performance-ledger.sql`; generate a migration named `prediction_performance_ledger` using the Supabase CLI; update `supabase/manifests/migrations.json` using existing hash conventions.

**Interfaces:** `normalizePrediction(input, {now}) -> Prediction`; `marketKey(prediction) -> string`; SQL `ingest_prediction_v1(payload jsonb) -> uuid`, `record_decision_v1(payload jsonb) -> uuid`, `append_settlement_v1(payload jsonb) -> uuid`. Predictions retain immutable sourceKey and provenance. Persist start revisions separately from immutable eligibility start.

- [ ] Write failing Node tests: `marketKey` distinguishes sport, player, side, line and model version; zero line remains zero; missing identity/invalid probability produces an exclusion reason; stale/future quote and post-start capture are ineligible. Require known quote age according to the existing component freshness policy when qualifying a PLAY.
- [ ] Run `node --test tests/node/performance-contract.test.mjs`; confirm failure before implementation.
- [ ] Implement normalization and SQL tables for predictions, decisions, settlements and event mappings. Add unique source-key and revision constraints, foreign keys, RLS and service-only RPC grants. Reject UPDATE/DELETE through application roles; transactional RPCs handle concurrent retries. Store invalid source rows as diagnostic provenance, not valid predictions.
- [ ] Run Node tests and transaction-based SQL assertions on a development database: duplicate ingest returns the same ID; conflicting payload for the same key fails; anonymous/authenticated writes fail; concurrent first-decision attempts cannot replace entry price; rollback restores fixture state.
- [ ] Commit `feat: add immutable prediction performance ledger`.

## Task 2: MLB provenance and actual PLAY issuance

**Files:** create `_shared/performance-mlb-adapter.mjs` under `supabase/functions/`, `tests/node/performance-mlb-adapter.test.mjs`, `supabase/functions/import-performance-history/index.ts`; modify `capture-model-audit/index.ts`, `capture-player-props/index.ts`, and the existing final-decision path after locating its final qualification boundary. Do not record issuance in the GET `market-card` endpoint.

**Interfaces:** `adaptLegacyObservation(row, kind) -> Prediction`; `qualifiedDecision(prediction, gateEvidence, issuedAt) -> Decision | null`. Source keys include original table and observation ID. Historical results link to existing IDs without rewriting the old ledger.

- [ ] Test raw PLAY/READY_FOR_SHARP_CHECK without final evidence yields no qualified decision; equivalent observations keep source links; post-event reconstructed PLAY is marked legacy; retry is idempotent.
- [ ] Run the focused Node test and observe failure.
- [ ] Implement paginated legacy import (500 rows per page, durable cursor, explicit completion count). Add prospective capture calls after successful existing persistence. Record qualified final issuance using a transactional write at the decision publication boundary, before start; preserve odds, quote age and final evidence.
- [ ] Verify fixture reconciliation counts, a dry-run legacy import report and failure recovery. If issuance persistence fails, the response must not describe that PLAY as tracked; surface the recording fault without fabricating a historical issuance later.
- [ ] Commit `feat: preserve MLB prediction and PLAY provenance`.

## Task 3: NFL/NBA capture and explicit sport coverage

**Files:** create `supabase/functions/_shared/performance-model-adapters.mjs`, `supabase/functions/capture-sport-predictions/index.ts`, `tests/node/performance-model-adapters.test.mjs`; modify existing NFL/NBA prop capture integrations only where necessary. Add live-response fixtures under `tests/fixtures/performance/` with no secrets.

**Interfaces:** `adaptModelResponse(body, {sport, kind, capturedAt, sourceRequestId}) -> {predictions, diagnostics, coverage}`; authenticated worker accepts `{sport, kind, requestId}` and returns captured/rejected counts plus reasons. Worker supports MLB/NFL/NBA; CFB reports unavailable without producing records.

- [ ] Test NFL league NFL/sport FOOTBALL canonicalizes to NFL, shadowStatus PLAY never becomes production PLAY, bookmaker-only/market-only fallback is marked non-independent, missing NBA source data produces no invented model forecast, and response timestamps older than their TTL are excluded. Tests assert `productionWeight` stays zero.
- [ ] Run focused tests; confirm failures.
- [ ] Implement adapters for actual existing response shapes, maintaining stable player/event IDs, exact lines and source provenance. Prefer adapter-owned payload fixtures to importing the whole unpublished NBA branch. Use trusted request IDs for retries; expose data-source coverage separately from sport model availability.
- [ ] Exercise healthy, empty, 429, 500, timeout and malformed JSON fixtures; verify complete/partial coverage and bounded retries. Integrate the user-authorized ESPN live NBA data source only through a separately validated point-in-time adapter; otherwise show unavailable and keep NBA capture disabled.
- [ ] Commit `feat: capture cross-sport shadow predictions`.

## Task 4: Deterministic final-result adapters

**Files:** create `_shared/performance-settlement.mjs`, `_shared/performance-result-sources.mjs` under `supabase/functions/`, `tests/node/performance-settlement.test.mjs`, and recorded official-result fixtures. Reuse `_shared/team-market-grading.mjs` where its rules apply.

**Interfaces:** `normalizeFinalResult(payload, {sport, source}) -> FinalResult`; `settlePrediction(prediction, finalResult) -> Settlement`. `FinalResult` contains canonical IDs, final status, scores, explicit player-stat presence/participation, source timestamp and revision identity.

- [ ] Test moneyline home/away, both spread sides including zero, total over/under, each supported NFL/NBA/MLB prop stat, pushes, nonparticipants, missing stats, cancelled/postponed games, ties, overtime, ambiguous IDs and corrected scores. Assert missing stat stays UNRESOLVED and VOID requires an explicit participation/cancellation rule.
- [ ] Run tests and confirm failures.
- [ ] Implement pure grading and source adapters. Use official MLB results and authorized ESPN NFL/NBA summaries, verifying current response schemas during implementation. CFB normalization is supported for future genuine model predictions; do not create predictions from scores.
- [ ] Run fixtures; verify score corrections produce a new revision and unknown market/rule combinations remain UNRESOLVED.
- [ ] Commit `feat: settle cross-sport markets from final results`.

## Task 5: Durable settlement and coverage jobs

**Files:** create `supabase/functions/settle-sport-predictions/index.ts`, `tests/node/performance-worker.test.mjs`; generate migration `register_prediction_performance_jobs`; update migration manifest.

**Interfaces:** authenticated worker accepts `{sport, limit:100}`; returns `{processed, settled, unresolved, retries, cursor}`. Database queue claims are transactional, leases expire after 120 seconds, request deadlines are 12 seconds, retries use 1/5/15/60-minute capped backoff. Corrections are rechecked for 14 days after final settlement; unresolved predictions have no seven-day expiry.

- [ ] Test a 250-row backlog completes over three pages, an old unresolved event remains eligible, a worker crash releases its lease, and overlapping workers do not duplicate settlement.
- [ ] Run tests and confirm failures.
- [ ] Implement job queue and append-only settlement revisions. Register capture and settlement health components disabled by default; capture every five minutes for eligible upcoming windows, settlement every five minutes. Honor existing provider cooldowns and never bypass quota exhaustion.
- [ ] Test repeated 429/HTML/timeout responses leave records unresolved and advance retry metadata without claiming successful coverage. Verify role permissions and disabled jobs in the development database.
- [ ] Commit `feat: schedule reliable prediction settlement`.

## Task 6: Honest cohort metrics and read API

**Files:** create `_shared/performance-metrics.mjs`, `supabase/functions/prediction-performance/index.ts`, `tests/node/performance-metrics.test.mjs`; extend `sharp-service/api/dashboard.js` using a `view=performance` branch, not a new Vercel function.

**Interfaces:** `selectCohort(predictions, decisions, settlements, filters) -> rows`; `summarizePerformance(rows) -> PerformanceResponse`. Filters: sport, kind, market, modelVersion, cohort (ALL/PLAY/SHADOW/PASS), from, to, cursor. Default date interval is 30 days; page size 100; server aggregation must cover all matched rows, not only the displayed page.

- [ ] Test last valid pregame ALL snapshot; first qualified PLAY price is immutable; shadow PLAY stays SHADOW; latest correction wins; missing odds excludes losses and wins alike; voids excluded from stake denominator; pushes count as zero return; empty metrics are null. Test paired model/market rows and conditional push normalization, with log-loss clipping at 1e-6 disclosed in metadata.
- [ ] Test equivalent half-hit/half-total-base PLAYs select earliest issuance, ties use lexical canonical key; the rule never examines outcomes. Exact-market group records remain inspectable. Ten mirrored rows from one event count as one game.
- [ ] Run focused tests and confirm failures.
- [ ] Implement pure cohort metrics and database read projections. Add ten fixed calibration bins, paired coverage and game-blocked uncertainty using a deterministic seeded bootstrap (2,000 resamples, 95% interval; return insufficient-sample status below two games). Mark market-anchored or market-only estimates explicitly, never independent skill evidence.
- [ ] Verify pagination cannot silently truncate summary counts; malformed date/filter values return 400; unavailable downstream service returns an explicit error rather than zero wins/losses. Public output excludes credentials and internal raw payloads.
- [ ] Commit `feat: report paired cross-sport model performance`.

## Task 7: Results UI with coverage and cohort filters

**Files:** create `sharp-service/performance-view.js`, `tests/node/performance-view.test.mjs`; modify `sharp-service/dashboard.html`, `sharp-service/nfl.html`, and existing dashboard script tests.

**Interfaces:** `renderPerformance(data, root)` consumes Task 6; controller requests `/api/dashboard?view=performance` with filters. Use the existing Results tab and a link from NFL view; preserve old audit views as clearly labeled legacy diagnostics.

- [ ] Test empty CFB/NBA coverage says no captured predictions/model unavailable as applicable; missing return/probability shows unavailable, not zero; displayed ROI is labeled hypothetical. Test user/provider text escaping and stale-response request-ID rejection.
- [ ] Run focused tests; observe failure.
- [ ] Implement filters, W/L/push/void/unresolved counts, distinct-game/sample coverage, model-versus-market scores, reliability bins, entry price and settlement detail. Separate raw candidates from qualified PLAYs visually and in totals.
- [ ] Verify desktop and 390px mobile in preview: filters work, no overflow, result rows remain readable, loading/outage states replace stale success claims, and rapid sport changes do not mix results.
- [ ] Commit `feat: expose cross-sport performance in Results`.

## Task 8: Frozen experiments and production release

**Files:** create `scripts/performance/freeze-experiment.mjs`, `tests/node/performance-experiment.test.mjs`, `docs/performance-rollout.md`; update deployment manifests only for files actually shipping.

**Interfaces:** `freezeExperiment(config, outputPath)` writes an immutable protocol with model/formula hash, cohort, event-group chronology, evaluation start, baseline, power/sample assumptions and promotion criteria. Existing file overwrite fails. This work supplies the protocol mechanism; no new challenger is promoted or falsely described as prospectively validated.

- [ ] Test freezing twice fails; missing acceptance criteria fails; pre-freeze outcomes and previously examined holdouts cannot be classified untouched; repeated snapshots never cross game partitions.
- [ ] Implement protocol writer and run focused tests. Commit `feat: freeze prospective model evaluation protocols`.
- [ ] Run `node --test tests/node/*.test.mjs` and `python -m pytest -q` with repository Python path. Run development SQL integration assertions, Supabase reconstruction/manifest checks, Vercel preview build and browser acceptance. Investigate every failure; record command outputs and blockers.
- [ ] Obtain independent branch review; fix findings and rerun affected checks. Open/update a production-scoped PR and attach it to the chat. Keep unvalidated historical NBA branch changes out of this PR.
- [ ] Deploy schema and functions with jobs disabled and existing JWT settings preserved. Validate read/write permissions, capture dry runs, exact result fixtures and production health. Enable only supported validated capture sources; expose missing NFL/NBA/CFB coverage honestly.
- [ ] Reconcile MLB historical IDs/counts without invented issuance, verify one prospective capture and a real final settlement when available. If no final game is available, explicitly report live settlement as pending rather than completed.
- [ ] Merge only passing production-safe changes, deploy the dashboard, verify mobile/desktop and API latency, and publish the release report. Rollback disables flags/jobs and UI exposure; ledger history is retained. Leave all promotion weights unchanged.

## Self-review

Coverage maps capture/identity to Tasks 1–3, settlement/corrections/backlog to Tasks 4–5, metrics/independence to Task 6, dashboard to Task 7, and immutable research/release controls to Task 8. All five review-focus conditions have explicit tests. No production source is assumed configured merely because its adapter exists. Execution must confirm availability and may ship an honest unavailable state without inventing predictions.

Recommended execution: subagent-driven task implementation and review, because database identity, publication-time decisions and settlement revisions cross several interfaces where a silent counting error would mislead model promotion.
