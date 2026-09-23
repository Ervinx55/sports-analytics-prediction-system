# Supabase Recovery and Deployment Operations

**Repository:** `Ervinx55/sports-analytics-prediction-system`  
**Supabase project:** `yeoxroijaptomomshdii`  
**Source of truth:** `supabase/` in Git  
**Reconstruction verification date:** 2026-09-23

## Authority model

Git is the required source of truth for the Supabase analytics backend.

The reconstruction baseline contains:

- 17 exact historical migrations recovered from production migration history;
- 10 catch-up migrations that reproduce post-history live schema state in a fresh environment;
- 49 active Edge Function source bundles;
- explicit `verify_jwt` configuration for all 49 functions;
- production schema/security/cron manifests;
- local isolated-rebuild and production-drift verification tooling.

The 10 catch-up migrations describe changes that already exist in the current production database but were not recorded in production migration history. **Do not blindly push or replay those catch-up migrations into the current production project.** They exist so a fresh environment can be rebuilt from zero and so future drift can be diagnosed accurately.

## Historical migrations

The first 17 files in `supabase/migrations/` are exact recovery artifacts from `supabase_migrations.schema_migrations`.

Rules:

1. Do not edit their SQL retroactively.
2. Do not replay them into the current production project.
3. If a historical recovery hash ever changes, treat it as reconstruction corruption until proven otherwise.

## Local hosted-prerequisite shims

`supabase/roles.sql` contains local-only prerequisites that existed in the hosted project before the recorded migration chain began.

These include the hosted `rls_auto_enable()` helper and signature-compatible pre-history scheduler functions required by historical hardening migrations. Later catch-up migrations replace the scheduler stubs with current definitions.

These shims are for fresh/local reconstruction. They are not instructions to mutate the production project.

## Database-change workflow

Always discover version-sensitive CLI commands with `--help` before use.

```bash
npx supabase migration new descriptive_name
# edit the generated migration
npx supabase db reset
PYTHONPATH=. pytest -q
# review migration, security, and drift results before any production push
```

Before production deployment:

1. Review the migration for destructive operations.
2. Run the isolated rebuild workflow.
3. Run the normal test/secret-scan workflow.
4. Run database security advisors.
5. Preview remote changes with the supported dry-run command for the pinned CLI version.
6. Deploy only after explicit review.

Never use a destructive linked reset against production.

## Edge Function workflow

```bash
# edit supabase/functions/<slug>/...
# update supabase/config.toml if function configuration changes
PYTHONPATH=. pytest -q
# deploy only after source/config review
```

Requirements:

- Keep the function source in Git before or with deployment.
- Keep `verify_jwt` explicit in `supabase/config.toml`.
- Update the Edge Function manifest after a deliberate production deployment.
- Never commit secrets. Functions should reference environment/secret names only.

## Production drift workflow

`.github/workflows/supabase-drift.yml` is read-only. It is designed to detect, not repair, production drift.

It compares migration/function/schema/security/cron expectations and must never invoke:

- `supabase db push`;
- `supabase functions deploy`;
- linked database resets;
- mutation SQL.

When drift is reported, classify it first. Fix Git if the repository is wrong; create a reviewed migration/function change if production needs to change. Do not auto-remediate production.

## Dashboard and SQL-editor rule

Do not make Dashboard-only or SQL-editor-only production schema/function changes without immediately recovering the change into Git.

A production edit that is not represented in `supabase/` is drift, not source of truth.

## Reconstruction verification baseline

Final read-only comparison on 2026-09-23 verified:

- production public tables: clean against captured inventory;
- public views: clean;
- SQL functions: clean;
- indexes: clean;
- extensions: clean;
- RLS state: clean;
- grants: clean;
- cron names/schedules/command hashes: clean;
- historical migration identity: 17/17 matched;
- active Edge Functions: 49/49 matched version, status, `verify_jwt`, and deployed bundle SHA;
- live `decision-results`, `market-card`, `player-prop-card`, and `pipeline-health-status` endpoints returned HTTP 200;
- security advisor returned only expected INFO-level `rls_enabled_no_policy` findings for service-role-only internal tables, with no WARN/ERROR.

The isolated rebuild and normal CI suite both passed using the pinned Supabase CLI toolchain.

## Known operational issue at handoff

At final verification, two critical pipeline components were marked degraded:

- `player_prop_capture`
- `prop_clv`

Both failures trace to the existing `/api/props` dependency returning HTTP 429 `Rate limit exceeded`. Cron execution itself is succeeding. This is an external/runtime ingestion issue and **not Supabase reconstruction drift**.

Do not change the production cadence merely to make the reconstruction health check green. Address the rate-limit behavior in a separate operational change with its own testing and review.

## Secrets

Never commit:

- service-role/secret API keys;
- Supabase access tokens;
- database passwords;
- Vault plaintext;
- provider/API credentials;
- literal bearer tokens.

The reconstruction validator and CI secret scan are mandatory gates.

## Authority handoff

After this reconstruction is merged into the repository's normal development line, future Supabase changes must follow this source-first workflow. A change that exists only in production is considered drift until represented and verified in Git.
