# Supabase Hybrid Reconstruction Design

**Date:** 2026-09-23  
**Status:** Approved design  
**Repository:** `Ervinx55/sports-analytics-prediction-system`  
**Supabase project:** `yeoxroijaptomomshdii`

## 1. Purpose

Make GitHub the reproducible source of truth for the Supabase backend without changing current production behavior.

The production project is healthy and contains significantly more backend state than the repository currently records. The reconstruction must therefore recover what is already live, preserve historical migration identity, and add source-controlled catch-up migrations for post-history changes rather than replaying or re-inventing production state.

## 2. Current verified state

At design approval time:

- 17 migrations are recorded in `supabase_migrations.schema_migrations`.
- Every recorded migration retains its SQL statement payload.
- 49 Supabase Edge Functions are ACTIVE.
- The GitHub repository has no `supabase/` directory.
- Production contains later schema/functions/cron work that was applied directly through Supabase tooling after the last recorded migration.
- Current analytics tables/views/functions are intentionally service-role-only unless explicitly exposed through public Edge Functions.
- Existing production PLAY/PASS behavior must not change as part of reconstruction.

This means the repository currently has **schema and function drift** relative to production.

## 3. Chosen approach

Use a **hybrid reconstruction**:

1. Recover the exact 17 historical migrations with their existing version and name.
2. Recover the exact currently deployed source for all 49 active Edge Functions.
3. Record Edge Function runtime/auth configuration, especially `verify_jwt`.
4. Create new ordered catch-up migrations for backend changes applied after the recorded migration history.
5. Add automated drift checks so future live changes cannot silently get ahead of GitHub.
6. Do not replay recovered historical migrations against the existing production database.

This approach preserves real history while making new/fresh environments reproducible.

## 4. Non-goals

This project does **not**:

- rebuild the production database from scratch during reconstruction;
- delete, rename, or replace working production objects merely to normalize history;
- change model weights, PLAY/PASS thresholds, or betting logic;
- change Vercel projects or aliases;
- rotate secrets or commit secrets to Git;
- promote shadow models to production;
- expose service-role-only tables through `anon` or `authenticated` access.

## 5. Safety invariants

The reconstruction must satisfy all of these invariants:

1. **No production replay.** Historical migrations recovered from `supabase_migrations` are source artifacts only for the current production project.
2. **No destructive cleanup.** Existing live tables, functions, views, cron jobs, and Edge Functions remain untouched unless a later independently approved migration requires a real change.
3. **No secret material in Git.** Service-role keys, project secrets, private API keys, vault plaintext, and credentials are excluded.
4. **Authentication fidelity.** Each Edge Function's deployed `verify_jwt` value is captured and reproduced.
5. **RLS fidelity.** Service-role-only tables remain protected by RLS/grants.
6. **View fidelity.** Views that rely on caller permissions use `security_invoker=true` where applicable.
7. **Function hardening fidelity.** Privileged functions retain explicit `search_path`, revoked public execution, and service-role grants.
8. **Cron fidelity.** Scheduled jobs are reproduced with the same cadence and ordering unless an implementation review explicitly changes them.
9. **No look-ahead contamination.** Historical analytical/CLV/timing behavior is not recomputed from post-start information during reconstruction.
10. **Git becomes authoritative only after verification.** The repository is not considered authoritative until migration/function inventory and drift checks pass against production.

## 6. Target repository layout

```text
supabase/
  config.toml
  migrations/
    20260922210537_enable_snapshot_scheduler_extensions.sql
    ...
    20260923063049_schedule_sharp_clv_capture.sql
    <new catch-up migrations>
  functions/
    capture-market-snapshot/
      index.ts
    market-movement/
      index.ts
    ...
    pipeline-health-status/
      index.ts
  manifests/
    edge-functions.json
    cron-jobs.json
    production-inventory.json
  scripts/
    verify-production-drift.ts
    verify-edge-functions.ts
    verify-migrations.ts

docs/
  architecture/
    2026-09-23-supabase-hybrid-reconstruction-design.md
  operations/
    supabase-recovery-and-deploy.md
```

The exact script language may change during implementation if repository tooling makes another choice cleaner, but the responsibilities above must remain.

## 7. Historical migration recovery

Recover these exact recorded migrations without rewriting their SQL:

| Version | Name |
|---|---|
| 20260922210537 | enable_snapshot_scheduler_extensions |
| 20260922210637 | create_market_snapshot_tables |
| 20260922234532 | create_model_audit_and_grading_ledger |
| 20260922234613 | extend_candidate_grade_clv_fields |
| 20260922235011 | create_model_calibration_view |
| 20260923003108 | create_sharp_gate_history |
| 20260923005752 | create_market_grade_observations_and_expand_sharp_history |
| 20260923012236 | create_player_prop_audit_and_results |
| 20260923034936 | create_team_market_results_ledger |
| 20260923060509 | upgrade_sharp_gate_reliability_v2 |
| 20260923061150 | harden_analytics_backend_access |
| 20260923061220 | lock_down_internal_rpc_functions |
| 20260923061948 | add_sharp_source_quote_pipeline |
| 20260923062037 | schedule_sharp_source_refresh |
| 20260923062439 | retain_sharp_quote_history_14_days |
| 20260923063003 | add_sharp_market_clv_tracking |
| 20260923063049 | schedule_sharp_clv_capture |

### Rules

- File version/name must match production migration history.
- SQL must come from the retained production migration payload, not a reverse-engineered substitute.
- Historical files are immutable after recovery except for byte-for-byte correction if extraction is proven faulty.
- Historical files must not be applied to the current production project.

## 8. Catch-up migrations

Changes made after the last recorded migration must be reconstructed into **new migrations**, grouped by subsystem and dependency order.

Expected catch-up groups:

1. Uncertainty / robust edge engine
2. Market-specific shadow policy engine
3. Price sensitivity / buy-point engine
4. Team and prop verification gates
5. Weather / park impact modules
6. Sharp disagreement classifier
7. Team decision fusion
8. Player prop decision fusion
9. Player prop quote history and CLV
10. Parlay correlation engine
11. Decision timing
12. Model governance
13. Outcome attribution
14. Pipeline health / SLO monitoring
15. Any security hardening, indexes, grants, views, or cron schedules required by the above but not already represented in historical migrations

### Catch-up migration rules

- Prefer idempotent object replacement where safe: `create or replace function`, `create or replace view`, guarded index/table creation only when appropriate.
- Preserve current production object names and semantics.
- Include RLS, grants, sequences, indexes, cron schedules, function privileges, and fixed `search_path`.
- Do not silently “improve” logic during reconstruction. Behavioral changes belong in later migrations with separate review.
- Dependency order must allow a fresh environment to migrate from zero to the current expected schema.

## 9. Edge Function recovery

Recover the exact deployed source for all 49 active functions.

Current inventory:

1. capture-market-snapshot
2. market-movement
3. market-alerts
4. capture-model-audit
5. grade-model-audit
6. model-calibration
7. latest-model-audit
8. dashboard-results
9. sharp-gate-history
10. market-card
11. capture-player-props
12. grade-player-props
13. player-prop-card
14. grade-team-markets
15. decision-results
16. evaluate-sharp-gate
17. market-calibration
18. refresh-sharp-sources
19. sharp-source-health
20. ingest-sharp-board
21. capture-sharp-clv
22. sharp-movement
23. market-uncertainty
24. market-policy-calibration
25. price-sensitivity
26. refresh-mlb-verification-gate
27. mlb-verification-status
28. mlb-verification-calibration
29. refresh-mlb-weather-park
30. mlb-weather-park-status
31. mlb-weather-park-calibration
32. refresh-sharp-disagreement-shadow
33. sharp-disagreement-status
34. sharp-disagreement-calibration
35. decision-fusion-status
36. decision-fusion-calibration
37. player-prop-fusion-status
38. player-prop-fusion-calibration
39. refresh-player-prop-clv
40. player-prop-clv-status
41. player-prop-clv-calibration
42. parlay-correlation-status
43. parlay-correlation-calibration
44. decision-timing-status
45. decision-timing-calibration
46. refresh-model-governance
47. model-governance-status
48. outcome-attribution-status
49. pipeline-health-status

### Edge Function manifest

Create a machine-readable manifest containing at minimum:

- function slug;
- deployed version observed during recovery;
- active status;
- `verify_jwt`;
- source hash;
- entrypoint path;
- recovery timestamp.

The manifest is an inventory/check artifact, not a substitute for source files.

### Runtime configuration

Do not store secret values. Document only secret **names** required by functions when necessary.

Relevant current Supabase platform constraints to preserve:

- public-schema tables are no longer assumed to be automatically exposed through the Data API; grants/exposure must be explicit;
- function authorization must not rely on default public EXECUTE for privileged SQL functions;
- Edge Function `verify_jwt` configuration must be explicit in deployment configuration/manifest.

## 10. Drift detection

Add read-only checks that compare GitHub expectations against production.

### Migration drift

Fail if:

- production contains a migration version absent from the repository;
- a recovered historical migration is missing;
- a version/name pair differs;
- a source-controlled catch-up migration expected to be applied in a target environment is absent from migration history.

Historical SQL hash comparison should be added where extraction makes that reliable.

### Edge Function drift

Fail if:

- production has an active function absent from the repository;
- the repository has a production-designated function missing from production;
- source hash differs;
- `verify_jwt` differs;
- status/config differs in a way considered deployment-significant.

### Schema/operations drift

At minimum compare inventory for:

- public tables/views used by analytics;
- internal SQL functions/RPCs;
- RLS state;
- grants for service-role-only analytics tables;
- cron jobs and cadence;
- expected extensions used by schedulers/network calls.

This check must be **read-only**. CI reports drift; it does not auto-fix production.

## 11. CI design

Add a GitHub workflow with two layers.

### Pull-request/static layer

Runs without production credentials where possible:

- verify expected directory structure;
- validate migration filenames/order;
- validate Edge Function inventory/manifest consistency;
- syntax/lint TypeScript;
- scan repository for accidental secret patterns;
- ensure privileged SQL definitions in catch-up migrations include expected hardening patterns where statically detectable.

### Production drift layer

Runs only when authorized credentials are available:

- compare migration inventory;
- compare Edge Function inventory/hash/config;
- compare selected schema/cron/security inventory;
- report drift.

Production drift checks do not mutate Supabase.

## 12. Fresh-environment verification

Before declaring reconstruction complete, create or use an isolated test target where the source-controlled migration chain can be applied from zero.

Acceptance requirements:

- all migrations apply in order;
- required extensions exist;
- expected tables/views/functions/indexes are present;
- expected cron jobs are created;
- service-role access works;
- `anon`/`authenticated` cannot read internal service-only tables;
- Edge Functions build/deploy with the intended `verify_jwt` configuration;
- no production secrets are required at build time beyond documented environment/secret names;
- security advisors show no new WARN/ERROR introduced by reconstruction;
- core endpoint smoke tests pass.

No isolated test may write to the production project.

## 13. Production verification

After repository reconstruction—but without replaying historical migrations—compare production to the repository and require:

- 17/17 recovered historical migrations represented;
- 49/49 active Edge Functions represented at the recovery baseline;
- function source/config hashes match the captured production baseline;
- all catch-up objects represented by migration source;
- cron registry matches expected schedule;
- service-role-only access invariants hold;
- current PLAY/PASS logic remains unchanged;
- dashboard/backend endpoints remain healthy.

Any mismatch must be classified before the repo is declared authoritative.

## 14. Rollback strategy

Because reconstruction is source-control-first, the main rollback is Git-based:

- revert source-only commits if extraction is wrong;
- do not mutate production to match a bad reconstruction;
- if a later catch-up migration itself changes production, give that migration its own forward-fix/revert plan.

The reconstruction phase should produce no destructive production rollback requirement.

## 15. Implementation phases

### Phase A — Recovery inventory
- export 17 migration payloads;
- export 49 function source bundles;
- capture `verify_jwt`, deployed version, status, and source hashes;
- capture cron/schema/security inventory.

### Phase B — Repository bootstrap
- create `supabase/` layout;
- commit historical migration files;
- commit Edge Function sources;
- commit baseline manifests.

### Phase C — Catch-up migrations
- derive dependency-ordered SQL for all post-history production objects;
- validate against the live schema;
- commit migrations without replaying them into production.

### Phase D — Verification tooling
- add migration checks;
- add function/source/config drift checks;
- add schema/cron/security inventory checks;
- add CI.

### Phase E — Isolated rebuild
- apply the complete migration chain to a non-production environment;
- deploy functions there;
- run smoke/security checks.

### Phase F — Authority handoff
- compare GitHub baseline to production;
- resolve any drift;
- mark GitHub as authoritative for future Supabase changes;
- require future schema changes to land as migrations and future function changes to land as source before/with deployment.

## 16. Acceptance criteria

The hybrid reconstruction is complete only when all of the following are true:

- [ ] 17 exact historical migrations exist in Git.
- [ ] 49 baseline active Edge Functions exist in Git.
- [ ] Every recovered function has captured `verify_jwt` configuration.
- [ ] Post-history production objects are represented by ordered catch-up migrations.
- [ ] No secrets are committed.
- [ ] Drift tooling reports no unexplained migration/function/config divergence.
- [ ] Fresh-environment migration succeeds.
- [ ] Fresh-environment function deployment succeeds.
- [ ] RLS/grant/security invariants pass.
- [ ] Existing production behavior has not changed merely because of reconstruction.
- [ ] GitHub is documented as the required source path for future Supabase changes.

## 17. Decision record

**Approved:** Hybrid reconstruction (Option 2).

Reason: it preserves the exact real migration history, captures the exact currently deployed Edge Function source, avoids risky production rebuilds, and establishes a maintainable source-of-truth path for all future backend upgrades.
