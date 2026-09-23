# Supabase Hybrid Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the live Supabase backend into GitHub so the repository can reproduce the current database schema, cron/RLS/security posture, and all active Edge Functions without changing current production behavior.

**Architecture:** Treat production as the recovery source and GitHub as the future source of truth. Recover the exact historical migration payloads and exact deployed Edge Function bundles first, capture non-secret production manifests, then reconstruct post-history schema changes as new dependency-ordered migrations and verify the complete chain in an isolated Supabase environment. Production is read-only during recovery; drift checks report differences but never auto-fix them.

**Tech Stack:** Supabase Postgres, Supabase Edge Functions (Deno/TypeScript), Supabase CLI, Python 3.12, pytest, GitHub Actions, JSON/TOML manifests.

**Spec:** `docs/architecture/2026-09-23-supabase-hybrid-reconstruction-design.md`

## Global Constraints

- Production project ref is `yeoxroijaptomomshdii`.
- Recover exactly 17 historical migration version/name pairs already recorded in `supabase_migrations.schema_migrations`.
- Recover all 49 active Edge Functions present at the approved recovery baseline.
- Do not replay recovered historical migrations into the current production project.
- Do not change PLAY/PASS logic, model weights, thresholds, Vercel projects, aliases, or runtime behavior during reconstruction.
- Do not commit service-role keys, secret keys, Vault plaintext, provider API keys, database passwords, or Supabase access tokens.
- Preserve each Edge Function's deployed `verify_jwt` setting.
- Preserve service-role-only RLS/grant behavior, `security_invoker` views, fixed `search_path`, and explicit function EXECUTE grants.
- Production drift checks are read-only and must never auto-remediate.
- GitHub is not authoritative until the isolated rebuild and final production comparison both pass.
- Do not opportunistically migrate legacy Supabase API-key usage during reconstruction. Current source/auth behavior is recovered exactly; API-key modernization is a later, separately reviewed change.
- Supabase CLI commands must be discovered with `npx supabase <command> --help` before execution when flags are version-sensitive.
- New catch-up migration files must be created with `npx supabase migration new <name>`; do not invent migration timestamps manually.

## Review Focus

1. **Migration payload fidelity:** SQL containing dollar-quoted functions, semicolons, comments, or multiline statements must survive extraction byte-for-byte except the single terminal newline added by the repository writer. Task 2 pins hashes and exact version/name pairs.
2. **Multi-file Edge Functions:** recovery must preserve every file returned in a deployed function bundle, not just `index.ts). Task 3 compares file lists and bundle hashes.
3. **Auth configuration drift:** a correct source file with the wrong `verify_jwt` value is a deployment-breaking difference. Tasks 3 and 8 validate `config.toml` against the manifest.
4. **Production changes during recovery:** if production gains a migration/function/object after the baseline capture, the final handoff must report it as drift rather than silently absorbing it. Tasks 4, 8, and 10 pin and compare recovery timestamps/inventories.
5. **Fresh rebuild without production secrets:** migrations/cron definitions must apply in isolation without embedding production credentials. Task 7 uses a local/isolated stack and only documented dummy secret names where a smoke test requires them.

---

## File Map

### Recovery source
- `supabase/config.toml` — per-function runtime configuration, especially `verify_jwt`.
- `supabase/migrations/*.sql` — 17 recovered historical migrations plus CLI-created catch-up migrations.
- `supabase/functions/<slug>/**` — exact deployed Edge Function bundles.
- `supabase/manifests/migrations.json` — recovered migration version/name/hash inventory.
- `supabase/manifests/edge-functions.json` — function slug/version/status/`verify_jwt`/files/hash inventory.
- `supabase/manifests/production-inventory.json` — non-secret schema/security inventory at recovery baseline.
- `supabase/manifests/cron-jobs.json` — cron names, schedules, active state, and command hashes with secrets redacted.
- `supabase/manifests/toolchain.json` — pinned Supabase CLI version used for reconstruction verification.

### Verification code
- `scripts/supabase/validate_reconstruction.py` — static repository inventory/hash/config validator.
- `scripts/supabase/compare_inventory.py` — compares two non-secret inventory snapshots and emits deterministic drift.
- `scripts/supabase/export_inventory.sql` — read-only production/local inventory query with no secret/Vault plaintext fields.
- `tests/supabase/test_reconstruction_inventory.py` — unit/static tests for recovery source.
- `tests/supabase/test_inventory_diff.py` — unit tests for drift semantics.

### CI and operations
- `.github/workflows/tests.yml` — existing Python test workflow, extended to run reconstruction tests.
- `.github/workflows/supabase-drift.yml` — authorized read-only production drift workflow.
- `docs/operations/supabase-recovery-and-deploy.md` — operator procedure after authority handoff.

---

### Task 1: Bootstrap the Supabase source tree and validation harness

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/manifests/migrations.json`
- Create: `supabase/manifests/edge-functions.json`
- Create: `supabase/manifests/production-inventory.json`
- Create: `supabase/manifests/cron-jobs.json`
- Create: `supabase/manifests/toolchain.json`
- Create: `scripts/supabase/validate_reconstruction.py`
- Create: `tests/supabase/test_reconstruction_inventory.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: approved design spec.
- Produces: `validate_repository(root: Path) -> list[str]`, where an empty list means the static recovery source is internally consistent.

- [ ] **Step 1: Write failing validation tests**

Create `tests/supabase/test_reconstruction_inventory.py` with tests that initially fail because the recovery tree is absent:

```python
from pathlib import Path

from scripts.supabase.validate_reconstruction import validate_repository

ROOT = Path(__file__).resolve().parents[2]

def test_reconstruction_tree_is_complete():
    errors = validate_repository(ROOT)
    assert errors == []

def test_secret_files_are_ignored():
    gitignore = (ROOT / ".gitignore").read_text()
    assert "supabase/.env" in gitignore
    assert "supabase/.temp/" in gitignore
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
PYTHONPATH=. pytest -q tests/supabase/test_reconstruction_inventory.py
```

Expected: FAIL because `scripts.supabase.validate_reconstruction` and the `supabase/` recovery tree do not exist.

- [ ] **Step 3: Add the minimal directory/config skeleton**

Create empty JSON manifests with this shape:

```json
{
  "recoveryBaseline": "2026-09-23",
  "items": []
}
```

Create `supabase/config.toml` containing only a comment explaining that function sections are generated in Task 3; do not guess function auth values.

Append to `.gitignore`:

```gitignore
supabase/.env
supabase/.env.*
supabase/.temp/
supabase/.branches/
```

- [ ] **Step 4: Implement the validator**

`validate_repository(root)` must check:
- all manifest files exist and parse as JSON;
- `supabase/config.toml` exists;
- no tracked recovery file contains strings matching `sb_secret_`, `SUPABASE_DB_PASSWORD=`, or a literal bearer token value;
- migration manifest item count equals actual migration file count;
- Edge Function manifest item count equals function directory count;
- every manifest file path exists;
- every stored SHA-256 equals the current file/bundle hash.

Use Python stdlib only: `json`, `hashlib`, `pathlib`, `re`, `tomllib`.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_reconstruction_inventory.py
```

Expected: PASS with the empty bootstrap manifests.

- [ ] **Step 6: Commit**

```bash
git add .gitignore supabase scripts/supabase/validate_reconstruction.py tests/supabase/test_reconstruction_inventory.py
git commit -m "Bootstrap Supabase reconstruction source tree"
```

---

### Task 2: Recover the exact 17 historical migrations

**Files:**
- Create: the 17 exact files under `supabase/migrations/` using the production version/name pairs from the spec.
- Modify: `supabase/manifests/migrations.json`
- Modify: `tests/supabase/test_reconstruction_inventory.py`

**Interfaces:**
- Consumes: production query result `version,name,statements`.
- Produces: immutable historical SQL files plus SHA-256 manifest entries `{version,name,path,sha256,recoveredFromProduction:true}`.

- [ ] **Step 1: Add the exact migration-inventory test**

Add the expected 17 `(version, name)` tuples from the design spec and assert the manifest matches them exactly and in order.

Also assert every historical migration manifest entry has:
- `recoveredFromProduction == true`;
- non-empty SHA-256;
- a filename equal to `<version>_<name>.sql`.

- [ ] **Step 2: Run the test and verify RED**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_reconstruction_inventory.py -k migration
```

Expected: FAIL because no historical SQL files have been recovered.

- [ ] **Step 3: Read the migration payloads from production**

Use the Supabase MCP `execute_sql` action with this read-only query:

```sql
select version, name, statements
from supabase_migrations.schema_migrations
order by version;
```

For each of the 17 rows:
- write `statements[1]` exactly to `supabase/migrations/<version>_<name>.sql`;
- preserve SQL content; add at most one terminal newline;
- compute SHA-256 on the written bytes;
- store the hash in `supabase/manifests/migrations.json`.

Do not call `apply_migration` and do not execute the recovered files against production.

- [ ] **Step 4: Verify recovery against production metadata**

Run a second read-only query:

```sql
select version, name, coalesce(array_length(statements,1),0) as statement_count
from supabase_migrations.schema_migrations
order by version;
```

Expected: 17 rows, each matching the source-controlled version/name; current baseline has one statement-array element per migration.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_reconstruction_inventory.py -k migration
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/manifests/migrations.json tests/supabase/test_reconstruction_inventory.py
git commit -m "Recover historical Supabase migrations"
```

---

### Task 3: Recover all 49 active Edge Function bundles and auth configuration

**Files:**
- Create/modify: `supabase/functions/<slug>/**` for all 49 baseline slugs.
- Modify: `supabase/config.toml`
- Modify: `supabase/manifests/edge-functions.json`
- Modify: `tests/supabase/test_reconstruction_inventory.py`

**Interfaces:**
- Consumes: Supabase `list_edge_functions` and `get_edge_function`.
- Produces: exact deployed function files plus manifest entries:
  `{slug,version,status,verify_jwt,entrypoint,files,bundle_sha256,recovered_at}`.

- [ ] **Step 1: Add failing function recovery tests**

Assert:
- exactly 49 manifest entries;
- exactly 49 baseline function directories;
- slugs are unique;
- every manifest file listed exists;
- bundle hash is deterministic: SHA-256 of sorted `relative_path + NUL + file_sha256` records;
- every function has a matching `[functions.<slug>]` section in `supabase/config.toml`;
- `verify_jwt` in TOML equals the manifest.

- [ ] **Step 2: Run test and verify RED**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_reconstruction_inventory.py -k edge
```

Expected: FAIL with 0 recovered functions.

- [ ] **Step 3: Recover deployed bundles**

Use `list_edge_functions` once to freeze the baseline inventory. For each baseline slug, call `get_edge_function` and write **every returned file** beneath `supabase/functions/<slug>/`, preserving relative paths and content.

Do not normalize imports, formatting, runtime style, or legacy environment-variable usage during recovery.

- [ ] **Step 4: Generate explicit function configuration**

For every function, add:

```toml
[functions.<slug>]
verify_jwt = true
```

or `false` according to production. Do not infer from source code.

If a recovered bundle uses a non-default entrypoint/import map, record the exact setting from deployed metadata/source layout.

- [ ] **Step 5: Hash and manifest each bundle**

Compute per-file SHA-256 and the deterministic bundle SHA-256. Record deployed `version`, `status`, and `verify_jwt`.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_reconstruction_inventory.py -k edge
```

Expected: PASS with 49 functions.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions supabase/config.toml supabase/manifests/edge-functions.json tests/supabase/test_reconstruction_inventory.py
git commit -m "Recover deployed Supabase Edge Functions"
```

---

### Task 4: Capture a non-secret production schema, security, and cron baseline

**Files:**
- Create: `scripts/supabase/export_inventory.sql`
- Modify: `supabase/manifests/production-inventory.json`
- Modify: `supabase/manifests/cron-jobs.json`
- Modify: `tests/supabase/test_reconstruction_inventory.py`

**Interfaces:**
- Consumes: production Postgres catalogs.
- Produces: deterministic non-secret inventories used by catch-up reconstruction and final drift checks.

- [ ] **Step 1: Write failing manifest-shape tests**

Assert `production-inventory.json` contains arrays for:
- `tables`;
- `views`;
- `functions`;
- `indexes`;
- `extensions`;
- `rls`;
- `grants`.

Assert `cron-jobs.json` contains `jobname`, `schedule`, `active`, and `command_sha256`, but no Vault plaintext or authorization header values.

- [ ] **Step 2: Run RED**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_reconstruction_inventory.py -k "production or cron"
```

Expected: FAIL because bootstrap manifests are empty.

- [ ] **Step 3: Write the read-only inventory SQL**

`scripts/supabase/export_inventory.sql` must query only catalogs and metadata:
- `pg_class`, `pg_namespace`, `pg_attribute`, `pg_constraint`;
- `pg_proc` with `pg_get_functiondef`;
- `pg_views`/`pg_get_viewdef`;
- `pg_indexes`/`pg_get_indexdef`;
- `pg_extension`;
- `pg_policy`;
- ACL/grant metadata;
- `cron.job`.

Never query `vault.decrypted_secrets`.

For cron commands, store a hash of the full command and a redacted display form that replaces string literals after `apikey`, `Authorization`, and Vault lookups with `<redacted>`.

- [ ] **Step 4: Execute the inventory queries against production**

Populate both manifests with:
- `captured_at` UTC timestamp;
- `project_ref: "yeoxroijaptomomshdii"`;
- deterministic sorting by schema/name/signature.

- [ ] **Step 5: Run secret scan and tests**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_reconstruction_inventory.py
```

Expected: PASS and no secret-pattern findings.

- [ ] **Step 6: Commit**

```bash
git add scripts/supabase/export_inventory.sql supabase/manifests/production-inventory.json supabase/manifests/cron-jobs.json tests/supabase/test_reconstruction_inventory.py
git commit -m "Capture Supabase production recovery baseline"
```

---

### Task 5: Add deterministic inventory-diff tooling and derive the catch-up object set

**Files:**
- Create: `scripts/supabase/compare_inventory.py`
- Create: `tests/supabase/test_inventory_diff.py`
- Create: `supabase/manifests/catchup-objects.json`

**Interfaces:**
- Consumes: two inventory JSON files.
- Produces: `compare_inventory(expected, actual) -> dict[str, list[dict]]` with keys `missing`, `unexpected`, `changed`.

- [ ] **Step 1: Write drift tests**

Use in-memory fixture dictionaries and pin these cases:
- object missing from local baseline -> `missing`;
- object present only locally -> `unexpected`;
- same function signature but changed definition hash -> `changed`;
- ordering differences -> no drift;
- cron secret redaction differences with identical command hash -> no drift.

- [ ] **Step 2: Run RED**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_inventory_diff.py
```

Expected: FAIL because comparator does not exist.

- [ ] **Step 3: Implement the comparator**

Normalize on stable identities:
- table/view/index: `schema.name`;
- function: `schema.name(identity_arguments)`;
- grant: `object_identity|grantee|privilege`;
- cron: `jobname`.

Return deterministic sorted lists and a non-zero CLI exit code when drift exists.

- [ ] **Step 4: Establish the historical-only local baseline**

Discover CLI commands first:

```bash
npx supabase --version
npx supabase start --help
npx supabase db reset --help
```

Record the actual CLI version in `supabase/manifests/toolchain.json`.

Run the local stack and apply only the 17 recovered migrations. Export the same inventory format from local Postgres.

- [ ] **Step 5: Derive `catchup-objects.json`**

Compare production inventory from Task 4 against the historical-only local inventory. Record every production object absent or changed locally, grouped by subsystem from the approved design:
`uncertainty`, `market_policy`, `price_sensitivity`, `verification`, `weather_park`, `sharp_disagreement`, `team_fusion`, `prop_fusion`, `prop_clv`, `parlay_correlation`, `decision_timing`, `model_governance`, `outcome_attribution`, `pipeline_health`, and `posthistory_security_cron`.

Do not include objects already produced by the 17 historical migrations.

- [ ] **Step 6: Run GREEN**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_inventory_diff.py tests/supabase/test_reconstruction_inventory.py
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/supabase/compare_inventory.py tests/supabase/test_inventory_diff.py supabase/manifests/catchup-objects.json supabase/manifests/toolchain.json
git commit -m "Add Supabase inventory drift tooling"
```

---

### Task 6: Reconstruct post-history catch-up migrations in dependency order

**Files:**
- Create via CLI: new files under `supabase/migrations/`
- Modify: `supabase/manifests/migrations.json`
- Modify: `tests/supabase/test_reconstruction_inventory.py`

**Interfaces:**
- Consumes: `catchup-objects.json` plus exact production object definitions.
- Produces: a migration chain that transforms the 17-migration historical baseline into the current expected production schema.

- [ ] **Step 1: Add failing catch-up coverage tests**

For every object identity in `catchup-objects.json`, require a `represented_by` migration filename. Fail if any object is unassigned.

Also scan new migration SQL and require, where applicable:
- `enable row level security` for internal public tables;
- explicit revokes from `public, anon, authenticated`;
- `grant ... to service_role`;
- `security_invoker = true` for protected public views;
- fixed `search_path` on privileged functions.

- [ ] **Step 2: Run RED**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_reconstruction_inventory.py -k catchup
```

Expected: FAIL because no catch-up migrations exist.

- [ ] **Step 3: Create migration files with the CLI**

Run these commands in order; use the filenames printed by the CLI and do not rename their timestamps manually:

```bash
npx supabase migration new recover_uncertainty_and_market_policy
npx supabase migration new recover_price_sensitivity
npx supabase migration new recover_verification_and_weather
npx supabase migration new recover_sharp_disagreement
npx supabase migration new recover_team_and_prop_fusion
npx supabase migration new recover_player_prop_clv
npx supabase migration new recover_parlay_correlation_and_timing
npx supabase migration new recover_model_governance_and_attribution
npx supabase migration new recover_pipeline_health
npx supabase migration new recover_posthistory_security_and_cron
```

- [ ] **Step 4: Populate each migration from production definitions**

Use read-only catalog queries to recover:
- exact table columns/defaults/constraints;
- exact SQL function definitions through `pg_get_functiondef`;
- exact view definitions through `pg_get_viewdef`;
- exact indexes through `pg_get_indexdef`;
- RLS state/policies;
- grants;
- cron job names/schedules/commands.

Preserve current semantics. Do not refactor or tune model logic during this task.

For tables created post-history, write explicit `create table` SQL matching production. For already-existing objects changed post-history, use the production-equivalent `alter table`, `create or replace function`, or view recreation required to reach the current state from the historical local baseline.

- [ ] **Step 5: Update catch-up assignments and hashes**

Every `catchup-objects.json` object gets a concrete `represented_by` migration filename. Add new migration hashes to `migrations.json` with `recoveredFromProduction:false` and `catchup:true`.

- [ ] **Step 6: Apply the full chain locally**

```bash
npx supabase db reset
```

Expected: exit 0.

- [ ] **Step 7: Export local inventory and compare against production**

Run `scripts/supabase/export_inventory.sql` locally, then:

```bash
python scripts/supabase/compare_inventory.py   supabase/manifests/production-inventory.json   .tmp/local-inventory.json
```

Expected: no unexplained schema/security drift. Allowed environment-specific differences must be explicitly listed in the comparator's fixed ignore set, limited to Supabase platform-managed metadata—not analytics objects.

- [ ] **Step 8: Run tests and advisors**

```bash
PYTHONPATH=. pytest -q
```

Run Supabase database advisors against the isolated target/local environment. Expected: no new WARN/ERROR caused by reconstructed objects.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations supabase/manifests/migrations.json supabase/manifests/catchup-objects.json tests/supabase/test_reconstruction_inventory.py
git commit -m "Reconstruct post-history Supabase migrations"
```

---

### Task 7: Verify a fresh isolated rebuild and Edge Function source

**Files:**
- Create: `scripts/supabase/smoke_rebuild.py`
- Create: `tests/supabase/test_smoke_rebuild_contract.py`
- Modify: `supabase/manifests/production-inventory.json` only if a previously omitted non-secret field is required for deterministic verification.

**Interfaces:**
- Consumes: full migration chain, function source tree, config manifest.
- Produces: machine-readable smoke report with `database_ok`, `security_ok`, `functions_ok`, `cron_ok`.

- [ ] **Step 1: Write the smoke-report contract test**

Require:

```python
{
    "database_ok": True,
    "security_ok": True,
    "functions_ok": True,
    "cron_ok": True,
    "errors": []
}
```

and fail on missing keys or non-empty errors.

- [ ] **Step 2: Run RED**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_smoke_rebuild_contract.py
```

Expected: FAIL because `smoke_rebuild.py` does not exist.

- [ ] **Step 3: Implement isolated database smoke checks**

The script must verify:
- required analytics tables/views/functions exist;
- all internal public tables expected service-role-only have RLS enabled;
- `anon` and `authenticated` lack table SELECT on those internal tables;
- expected service-role privileges exist;
- expected cron job names/schedules exist;
- required extensions (`pg_cron`, `pg_net`, Vault-related dependencies used by jobs) exist.

Do not read production secrets.

- [ ] **Step 4: Validate Edge Function configuration statically and locally**

For each manifest entry:
- verify source hash;
- verify `config.toml` `verify_jwt`;
- run the Supabase function build/serve check supported by the pinned CLI version.

Functions requiring external provider secrets may fail an invocation with a documented missing-secret response, but they must parse/build/start. Public GET status functions should receive smoke requests where practical.

- [ ] **Step 5: Run full isolated rebuild**

```bash
npx supabase stop --no-backup || true
npx supabase start
npx supabase db reset
PYTHONPATH=. python scripts/supabase/smoke_rebuild.py
```

Expected: all four report flags true.

- [ ] **Step 6: Run all tests**

```bash
PYTHONPATH=. pytest -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/supabase/smoke_rebuild.py tests/supabase/test_smoke_rebuild_contract.py
git commit -m "Verify fresh Supabase rebuild"
```

---

### Task 8: Add static reconstruction checks to normal CI

**Files:**
- Modify: `.github/workflows/tests.yml`
- Modify: `tests/supabase/test_reconstruction_inventory.py`

**Interfaces:**
- Consumes: repository-only source.
- Produces: PR/push gate requiring Python tests and static reconstruction integrity; no production credentials.

- [ ] **Step 1: Add a test that confirms CI runs the Supabase reconstruction suite**

Read `.github/workflows/tests.yml` and assert the existing `pytest -q` command remains present. Because the current workflow runs the whole test suite, no second pytest command is required.

- [ ] **Step 2: Run RED if workflow has been accidentally narrowed**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_reconstruction_inventory.py
```

Expected: PASS on current workflow once the assertion is added; if it fails, fix workflow before continuing.

- [ ] **Step 3: Add a repository secret-scan step**

Add a workflow shell step before pytest:

```bash
python scripts/supabase/validate_reconstruction.py --check-secrets .
```

The validator exits non-zero on literal secret-key/token patterns but allows environment-variable names such as `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 4: Run tests**

```bash
PYTHONPATH=. pytest -q
python scripts/supabase/validate_reconstruction.py --check-secrets .
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/tests.yml scripts/supabase/validate_reconstruction.py tests/supabase/test_reconstruction_inventory.py
git commit -m "Enforce Supabase reconstruction integrity in CI"
```

---

### Task 9: Add an authorized, read-only production drift workflow

**Files:**
- Create: `.github/workflows/supabase-drift.yml`
- Create: `scripts/supabase/production_drift.py`
- Modify: `tests/supabase/test_inventory_diff.py`
- Modify: `supabase/manifests/toolchain.json`

**Interfaces:**
- Consumes: GitHub Actions secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` only at runtime.
- Produces: CI report; never invokes `db push`, function deploy, schema mutation, or auto-fix.

- [ ] **Step 1: Add workflow-safety tests**

Assert the workflow:
- is `workflow_dispatch` plus a scheduled read-only check;
- contains no `supabase db push`;
- contains no `supabase functions deploy`;
- contains no SQL mutation command;
- uses the CLI version from `toolchain.json`, not `latest`;
- marks secrets only as environment variables.

- [ ] **Step 2: Run RED**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_inventory_diff.py -k workflow
```

Expected: FAIL because workflow does not exist.

- [ ] **Step 3: Create the read-only workflow**

Use `actions/checkout@v4` and `supabase/setup-cli@v1`. Supply the exact CLI version recorded in `toolchain.json`.

The job:
1. links to `SUPABASE_PROJECT_ID`;
2. runs read-only migration/function listing/export commands;
3. invokes `scripts/supabase/production_drift.py`;
4. uploads the drift report as an artifact;
5. fails if unexplained drift exists.

It must not deploy or push.

- [ ] **Step 4: Implement production drift checks**

At minimum compare:
- migration version/name inventory;
- active function slug list;
- function `verify_jwt` configuration from production metadata;
- schema/security/cron inventory hashes.

If production source download is supported by the pinned CLI, also compare downloaded Edge Function bundle hashes in a temporary directory without modifying `supabase/functions/`.

- [ ] **Step 5: Run static workflow tests**

```bash
PYTHONPATH=. pytest -q tests/supabase/test_inventory_diff.py
```

Expected: PASS.

- [ ] **Step 6: Run the workflow manually once**

Expected: either clean or a deterministic drift report that names every mismatch. Resolve reconstruction errors in Git; do not auto-fix production.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/supabase-drift.yml scripts/supabase/production_drift.py tests/supabase/test_inventory_diff.py supabase/manifests/toolchain.json
git commit -m "Add read-only Supabase production drift checks"
```

---

### Task 10: Final production comparison and authority handoff

**Files:**
- Create: `docs/operations/supabase-recovery-and-deploy.md`
- Modify: `README.md`
- Modify: `supabase/manifests/production-inventory.json`
- Modify: `supabase/manifests/edge-functions.json`
- Modify: `supabase/manifests/migrations.json`

**Interfaces:**
- Consumes: verified repository, fresh-rebuild report, current production inventory.
- Produces: documented source-of-truth workflow for every future Supabase change.

- [ ] **Step 1: Re-capture production inventory without mutating it**

Repeat Tasks 2–4 read-only inventory calls and record a `final_verified_at` timestamp.

Any migration/function/object added since the baseline must be treated as new drift and reconciled before authority handoff.

- [ ] **Step 2: Prove the required baseline**

Verify:
- all 17 historical migrations exist and hashes are intact;
- all 49 approved-baseline functions exist in Git;
- every baseline function's `verify_jwt` matches;
- all catch-up objects are represented;
- isolated rebuild passes;
- security advisors show no new WARN/ERROR caused by reconstruction;
- production PLAY/PASS endpoints still return current behavior.

- [ ] **Step 3: Write the operator guide**

`docs/operations/supabase-recovery-and-deploy.md` must state the mandatory future workflow:

Database change:
```bash
npx supabase migration new descriptive_name
# edit generated migration
npx supabase db reset
PYTHONPATH=. pytest -q
# review before any production push
```

Edge Function change:
```bash
# edit supabase/functions/<slug>/...
PYTHONPATH=. pytest -q
# deploy only after source/config review
```

The guide must explicitly forbid Dashboard-only production edits that are not immediately recovered into Git.

- [ ] **Step 4: Update README architecture section**

Add a short link to:
- the reconstruction design;
- this implementation plan;
- the operations guide;
- `supabase/` as the backend source of truth.

- [ ] **Step 5: Run final verification**

```bash
PYTHONPATH=. pytest -q
python scripts/supabase/validate_reconstruction.py .
PYTHONPATH=. python scripts/supabase/smoke_rebuild.py
```

Run the authorized drift workflow. Expected: no unexplained drift.

- [ ] **Step 6: Commit authority handoff**

```bash
git add README.md docs/operations supabase/manifests
git commit -m "Make GitHub authoritative for Supabase backend"
```

---

## Self-Review Results

### Spec coverage
- Exact 17 migration recovery: Tasks 2 and 10.
- Exact 49 Edge Function recovery: Tasks 3 and 10.
- `verify_jwt` preservation: Tasks 3, 7, 8, 10.
- Catch-up migrations: Tasks 5–7.
- RLS/grants/view/function hardening: Tasks 4, 6, 7.
- Cron reconstruction: Tasks 4, 6, 7.
- No production replay: Global Constraints and Tasks 2, 6, 10.
- No secrets: Tasks 1, 4, 8, 9.
- Drift detection: Tasks 5, 8, 9, 10.
- Fresh isolated rebuild: Task 7.
- CI: Tasks 8–9.
- Authority handoff: Task 10.
- Production behavior preservation: Global Constraints and Task 10.

### Placeholder scan
No implementation step uses `TBD`, `TODO`, or unspecified error handling. CLI-generated migration timestamps are intentionally not predeclared because Supabase requires `migration new` to generate them; the commands and migration names are exact.

### Type/interface consistency
- `validate_repository(root: Path) -> list[str]` is used consistently.
- `compare_inventory(expected, actual) -> dict[str, list[dict]]` is used consistently.
- Manifests use stable identities and SHA-256 throughout.
- `verify_jwt` is sourced from production metadata, stored in both manifest and TOML, and cross-checked.

### Review-focus coverage
All five Review Focus failure modes have explicit tests or verification steps in Tasks 2, 3, 4/10, and 7.
