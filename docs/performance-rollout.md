# Performance rollout and prospective experiment protocol

Status: preparation only. No challenger is validated or promoted, no production weight changes, and no deployment or capture activation is authorized by passing local fixtures. NBA/NFL examined holdouts remain development evidence. Priorities are NBA, NFL, NHL, ATP/WTA tennis and provider-supported soccer; MLB remains maintenance and CFB model unavailable.

## Freeze an experiment before outcomes

Run from repository root with Node 24:

```sh
node scripts/performance/freeze-experiment.mjs config.json new-protocol.json
```

The output path must not exist. Exclusive creation (`wx`) rejects retries and concurrent replacement, with read-only file mode where supported. Preserve the original bytes, protocol hash and commit in an audited archive before collection. Filesystem administrators can replace files; this mechanism does not make the filesystem tamper-proof. The SHA-256 protocol hash covers the compact JSON protocol before its own hash field is added. Model and formula hashes cover exact UTF-8 `modelSource` and `formulaSource` strings; supply the complete model artifact representation and actual formula, not just a version label. A frozen protocol always records `FROZEN_NOT_VALIDATED` and `promotionAuthorized: false`.

Required configuration fields:

| Field | Required content |
| --- | --- |
| `experimentId`, `modelSource`, `formulaSource` | Unique experiment identity and complete pinned model/formula inputs |
| `cohort` | `sport`, `modelMode` LIVE/SHADOW, deterministic pre-outcome `selection`, explicit `probabilityBasis` |
| `evaluationStart` | Explicit UTC ISO timestamp strictly after actual writer freeze time |
| `baseline` | `market` and `currentModel`; paired contemporaneous references |
| `power` | Numeric `minimumDistinctGames` (integer >=2), `alpha`, `power` (both between 0 and 1), positive `minimumEffect`, written `assumptions` |
| `promotionCriteria` | `pairedMetrics` including `brier` and `logLoss`; written `acceptance`, `missingDataPolicy`, `stoppingRule` |
| `previouslyExaminedHoldouts` | Complete inventory of examined holdout IDs, including previous NBA/NFL studies |
| `eventGroups` | Canonical `sport`/`eventKey`, original `startsAt`, `partition`, all `snapshots`; untouched groups explicitly set `previouslyExamined:false`, `outcomeKnownAt:null` and supply `holdoutId` when applicable |

Partitions are development, validation and untouched in strict chronological order, with no overlapping boundary times. Each canonical game occurs once and carries all its snapshots; a snapshot ID cannot occur in multiple groups. Untouched groups start at/after evaluationStart, strictly after freeze, with no known outcomes or examined holdout membership. Any known outcome timestamp excludes untouched classification, including an accidentally future-dated outcome claim. Original event start is authoritative; a reschedule never makes already observed outcomes untouched.

The writer validates supplied metadata; it cannot discover omitted examined holdouts, verify truthful outcome-access declarations, establish complete artifacts, or approve prose thresholds scientifically. Independent protocol review must reconcile the inventory with historical NBA/NFL research, specify numeric acceptance bounds against **both market and current model**, game-level uncertainty, fixed stopping/multiplicity policy, justified sample/power assumptions and source completeness before collection. Do not treat the test fixture's assumptions as an approved research experiment. No real challenger protocol is created by this change. After freeze, append evidence separately; never rewrite protocol to improve acceptance. Repeated snapshots, mirrored sides and equivalent markets are not independent games; preserve first-issued PLAY separately from prediction diagnostics. Actual wager profit remains unavailable without execution records.

## Reproducible disposable SQL validation

`.github/workflows/performance-sql.yml` uses Node 24.19.0, a disposable PostgreSQL 17.4 service, PGlite 0.5.8 and postgres.js 3.4.9. Development dependencies and integrity lock live only in `tests/supabase/tooling`; root and sharp-service production packages have no added dependencies. Root `.vercelignore` excludes tests, tooling and temporary preview fixtures; the active sharp-service project does not include repository-level tests. Never deploy fixtures or tooling as Edge Functions or migrations.

```sh
npm ci --prefix tests/supabase/tooling --include=dev --ignore-scripts --no-audit --no-fund
node tests/supabase/run-pipeline-health.mjs tests/supabase/tooling/node_modules/@electric-sql/pglite/dist/index.js
node tests/supabase/run-performance-ledger.mjs tests/supabase/tooling/node_modules/@electric-sql/pglite/dist/index.js
node tests/supabase/run-performance-mlb.mjs tests/supabase/tooling/node_modules/@electric-sql/pglite/dist/index.js
node tests/supabase/run-performance-sport-capture.mjs tests/supabase/tooling/node_modules/@electric-sql/pglite/dist/index.js
```

For native checks use an explicit disposable **loopback** server, `PGHOST=127.0.0.1`, `PGPORT`, `PGUSER` and a private `PGPASSWORD_FILE`. Never point these fixture runners at a production or shared database; they create/drop databases and provision fixture roles. The workflow supplies its own disposable password and removes the password file after every outcome. Run all mandatory native suites:

```sh
node tests/supabase/run-performance-concurrency.mjs tests/supabase/tooling/node_modules/postgres/src/index.js
node tests/supabase/run-performance-sport-concurrency.mjs tests/supabase/tooling/node_modules/postgres/src/index.js
node tests/supabase/run-performance-priority-sports.mjs tests/supabase/tooling/node_modules/postgres/src/index.js
node tests/supabase/run-performance-worker.mjs tests/supabase/tooling/node_modules/postgres/src/index.js
node tests/supabase/run-performance-read.mjs tests/supabase/tooling/node_modules/postgres/src/index.js
```

These execute actual migration SQL and role-denial assertions, competing ingest/first-PLAY/identity transactions, source receipt races, queue SKIP LOCKED/lease/retry/correction semantics and full read pagination/limits. No native step has `continue-on-error` or optional skipping. Require the **Performance SQL fixtures / sql** check on the PR. PGlite alone proves neither multi-session races nor hosted platform integration. The worker fixture stubs cron catalog/HTTP infrastructure: hosted pg_cron, pg_net, Vault secrets, gateway authentication and real dispatch remain separate mandatory gates. PostgreSQL/PGlite minor-version drift from hosted Supabase also requires hosted acceptance.

Additional checks: `node --test tests/node/*.test.mjs`; `PYTHONPATH=. python -m pytest -q`; `python scripts/supabase/validate_reconstruction.py`; Deno type-check the actual capture, settle, import and read functions. Deno local fallback is `check --no-config --no-lock --node-modules-dir=none` with Mozilla CA and an accessible cache. Record exit codes and failures. A CI definition is not evidence that CI ran.

## Controller-owned release gates

1. Obtain independent branch review and passing full suites, reconstruction manifests and mandatory SQL CI. Keep unvalidated historical NBA branch changes out of the production PR. Build the exact preview commit; verify desktop and 390px Results rendering, all sport/cohort filters, pagination, missing coverage, failed refresh and invalid-date stale-result clearing. Browser acceptance remains pending after local server access failed.
2. Verify project, team, alias, deployment ID and **exact deployed Git commit** before any release. On October 8 the production tau alias resolved READY deployment `dpl_CHgMTpAv3GmS6iwRWmPg1P9Ufe8V`, commit `15ac5b60b40c2b9ff503eff322da0585d6611b78` (PR23), while GitHub master was `4891ea36a21a941255e80a0f6991e363757f5a67`. Neither GitHub master nor READY alone proves the alias serves the reviewed release. Recheck at release time, preserve a verified rollback deployment, and verify alias commit again after deployment.
3. Resolve production health separately before claiming health. Controller October 8 read-only diagnosis found `pipeline-health-status` HTTP500, PostgreSQL `57014` statement timeout. The health view performs two lateral sequential scans of `cron.job_run_details` per component; only runid PK exists, no `(jobid,start_time)` index. EXPLAIN without ANALYZE estimated total cost 1,263,889 across 175 outer rows. HTTP log already has `(component_key,enqueued_at DESC)` indexing. Other sources recovered, but this endpoint is still a concrete release blocker. Forward migration `20261009000000_pipeline_health_set_based.sql` replaces the repeated cron lateral scans with two materialized set-based scans. It preserves the view contract, status precedence, DESC null ordering, 24h inclusive boundary, security invoker and service-role grants; it does not modify extension-owned cron tables. The disposable actual-engine fixture verifies equivalence and two history scan loops at representative scale. Equal latest start times retain the original unspecified tie behavior; neither query defines a tie-breaker. Controller review/application and hosted endpoint latency/health acceptance remain required; this local repair has not been applied to production.
4. Apply only reviewed planned migrations/functions with jobs and flags disabled, preserving existing gateway JWT settings (only the documented public-safe GET reader exception is allowed). Verify actual RLS and service-role write permissions, RPC grants, real pg_cron/pg_net/Vault dispatch and semantic health; an HTTP200 with coverage failure is not success. Track applied manifest hashes and deployment commit.
5. Keep `PERFORMANCE_MLB_IMPORT_ENABLED`, `PERFORMANCE_MLB_PUBLICATION_ENABLED`, `PERFORMANCE_SPORT_CAPTURE_ENABLED`, `PERFORMANCE_SETTLEMENT_ENABLED` disabled until each relevant integration passes. Verify configured source endpoint, saved prediction identity, original kickoff, selected quote line/time, probability basis and exact bookmaker settlement policy with genuine source data. Enable only supported sources, one controlled path at a time. Schema/odds/schedule availability is not model readiness.
6. Reconcile historical MLB IDs/counts through dry runs and bounded checkpointed imports. Never invent historical PLAY issuance, rewrite saved policy, or retroactively turn diagnostic evidence prospective. Verify a real pregame saved capture, persisted actual first publication, source-backed exact final and append-only correction. If no real final is available, report live settlement **pending**. Report empty/error/missing model coverage honestly and validate API latency.
7. Merge/deploy only after concrete passing gates and user/controller release authorization. Verify exact alias commit, desktop/mobile and production health after deployment; publish evidence with pending gates and known limitations.

## Authoritative source blockers

- MLB saved settlement rule does not satisfy strict bookmaker/period/participation tokens; do not synthesize rules or rewrite history to clear it.
- NFL exact event/player source IDs, probability basis and settlement policies require verified source contracts.
- NBA production model is absent; ESPN access does not create a validated model. CFB has no independent model.
- NHL, tennis and soccer lack actual model/result adapters. NHL regulation/overtime/shootout, tennis retirement/walkover/tour/format and soccer competition/draw/regulation/extra-time policies remain explicit prerequisites. Do not claim all leagues or both tours connected without actual provider inventory.

Tracking grants zero challenger influence. Historical studies are development evidence; future promotion requires an independently reviewed frozen experiment and paired future outcomes with game-level uncertainty.

## Rollback

Disable relevant flags and cron/component jobs first, then remove Results exposure or restore the verified previous dashboard deployment. Recheck alias deployment ID/commit and production health. Keep canonical ledger, decisions, receipt mappings, settlements, import cursors and frozen protocols intact; never delete audit history or rewind issuance/settlement to disguise failures. Document any captured diagnostic interval. Weights and qualification gates remain unchanged throughout.
