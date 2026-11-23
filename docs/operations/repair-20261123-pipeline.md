# Pipeline repair evidence — 2026-11-23

## Verified outcome

The repository now contains the exact working source of
`github-ml-training-export` version 10. The production drift workflow now emits
an explicit, non-secret report when configuration is missing or a check fails.
Its migration comparison includes recorded deployments and their hosted version
identities. These changes do not declare the wider production inventory clean.

No production functions, secrets, schedules, model gates, or data were changed
by this pipeline repair. The ML source recovery requires no redeployment.

## Production evidence

- [TensorFlow Shadow Model run 45051829391](https://github.com/Ervinx55/sports-analytics-prediction-system/actions/runs/45051829391),
  scheduled on 2026-11-22, completed the OIDC export, expanding-window
  evaluation, training, summary publication, and artifact upload. All job steps
  succeeded. Supabase function logs showed 19 successful export requests that
  day, each HTTP 200.
- [Supabase Production Drift run 45068151615](https://github.com/Ervinx55/sports-analytics-prediction-system/actions/runs/45068151615),
  scheduled on 2026-11-22, failed in **Validate required runtime secrets**. Its
  job environment showed empty `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`,
  and `SUPABASE_DB_PASSWORD` inputs. The actual production comparison was
  skipped, and the old workflow had no report artifact to upload.
- Supabase `get_edge_function` returned the active ML exporter at version 10,
  deployed bundle SHA-256
  `ce62827b66d30d909408415855eb99ef783645e2ff677a9d411224077237a6c8`.
  Both `index.ts` and `service-role-key.mjs` were compared byte for byte with
  the retrieved files. The manifest contains their individual source hashes.

The live exporter first uses the server-configured
`EDGE_LAB_SERVICE_ROLE_KEY` override. Without that override, it uses the modern
injected default key and then the injected legacy service key. The older open
PR #44 lacked this deployed override and was not copied over the working
version. GitHub issuer, audience, exact repository, master ref, workflow
identity, and allowed event checks remain unchanged. No credential value was
retrieved, committed, or returned to a workflow.

## Code and manifest repairs

The public project reference `yeoxroijaptomomshdii` is now ordinary workflow
configuration. Preflight runs before CLI/client installation and writes the
report with the names of missing credentials. The script also checks that the
runtime project matches the captured inventory.

Missing configuration and query failures return exit status `2` with
`drift: null`. Query failures identify the failed stage and exception type;
they do not print exception text, which can contain connection credentials.
Already completed comparison sections remain available. A complete dirty
comparison returns `1`, and a complete clean comparison returns `0`.
`--preflight-only` performs no network or database operation and uses
`status: preflight_passed`, never a clean-drift claim.

The old migration comparison included only the 17 September recovery records.
It omitted later entries already marked `appliedToProduction` and ignored
existing `productionVersion` mappings. The repaired comparison includes both
reviewed categories and uses the deployed version where recorded. Local
catch-up migrations and pending changes remain excluded.

Hosted migration identities were read and matched by unique migration name for
entries already recorded as applied. Their differing hosted versions are now
mapped explicitly. `adaptive_model_capture` was additionally confirmed by an
exact SHA-256 match with the hosted statement text before being marked applied.
The seven November 22 journal migrations recovered by the ledger repair are
included as already applied history. The new November 23 integrity repair was
subsequently applied as hosted version `20261123171926`, verified against the
reviewed statement hash, and marked applied with its hosted version in the
manifest. No historical SQL was rewritten to change a deployment identity,
and no recovered history should be replayed into production.

## Remaining inventory differences

The pre-deployment read-only metadata observation is preserved in
[repair-20261123-drift-observation.json](repair-20261123-drift-observation.json).
It contains each missing, unexpected, or changed identity and its expected and
observed metadata. This is a partial metadata comparison: schema/security and
cron inventories were not rebaselined or claimed verified.

| Inventory | Repository source files/directories | Expected applied/active records | Observed production records |
| --- | ---: | ---: | ---: |
| Edge Functions | 55 | 55 | 68 |
| Migrations, including pending integrity repair | 67 | 56 | 92 |

There are no missing expected function or migration identities. There are
13 unrepresented deployed functions and 53 changed function bundles. Of the
43 previously unrepresented migration identities, seven are now recovered by
the ledger work, leaving 36 unrepresented identities. The 56 expected applied
migration identities match their hosted names and versions.

The 13 unrepresented function slugs are:

- `audit-nba-boxscores`
- `capture-nba-player-props`
- `capture-nfl-player-props`
- `collect-nba-props`
- `collect-nfl-prices`
- `grade-nba-player-props`
- `nba-player-prop-calibration`
- `nba-player-prop-feedback-status`
- `prediction-performance`
- `probe-nba-backup`
- `refresh-nba-player-prop-clv`
- `service-auth-health`
- `track-nba-research`

These discrepancies remain visible. They were not accepted wholesale as a new
clean baseline, and current repository function source was not overwritten
with every deployed bundle.

## Required operational action

An authorized administrator still needs to configure the missing GitHub
Actions secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. The former
serves the existing read-only function metadata request; the latter serves the
existing PostgreSQL catalog/cron reads. A service-role API key does not replace
either input. The project ID no longer requires a secret.

After configuration, rerun the existing drift workflow. Expect the remaining
recorded source drift to be reported; a successful preflight is not evidence
of a clean production comparison. Reconcile each remaining source difference
before approving a new full baseline.

## Verification performed

The new regressions were run before implementation. They reproduced the lost
ML override and untrimmed legacy fallback, missing preflight/error artifacts,
wrong-project requests, and omission of applied/deployed-version migrations.
They passed after the repairs.

| Command/check | Observed result |
| --- | --- |
| `PYTHONPATH=. python -m pytest -q` before changes | 78 passed |
| `node --test tests/node/ml-export-credentials.test.mjs` | 3 passed |
| Focused drift/inventory/OIDC Python tests | 15 passed |
| `PYTHONPATH=. python -m pytest -q` after scoped changes and journal manifest recovery | 84 passed |
| `node --test tests/node/*.test.mjs` during integration | 533 passed, 0 failed |
| `python scripts/supabase/validate_reconstruction.py .` | Exit 0 |
| Recovered ML exporter vs deployed version 10 files | Exact bytes match for both files |

Python emitted one dependency warning about the installed AnyIO pytest plugin
using a renamed pytest internal class; no application test failed. Later
parallel UI/ledger changes require the coordinator's final integrated suite.
No live ML retraining or credential rotation was needed for this recovery.
