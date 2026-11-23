# Production migration history recovery — 2026-11-23

## Result and scope

Recovered the **36 previously unrepresented production migration identities**
from `supabase_migrations.schema_migrations` in project `yeoxroijaptomomshdii`.
The new SQL files contain **157,372 bytes** in total. Every file matches the
server-calculated SHA-256 of its stored SQL statement, with no added header,
redaction, newline normalization, or other source edit.

At the capture recorded at `2026-11-23T18:15:20.970796+00:00`, production had
**93 migration identities**. The repository already represented 57 of them,
including the November 23 journal repair. It now represents all 93 identities
through **103 migration files**; the other 10 are the existing local catch-up
migrations. The previous observation had 92 production identities because it
preceded that journal deployment.

This result reconciles migration identities and verifies the exact newly
recovered source. It does **not** establish current schema, grants, RLS,
function, cron, or application behavior parity. Those inventories were not
rebaselined. The original September recovery baseline remains unchanged.

No production SQL was applied, no migration history was repaired or marked
remotely, and no function, schedule, secret, model approval, or data record was
changed during this recovery. The recovered SQL must not be replayed against
the current production database.

## Provenance and exactness

The read-only procedure was:

1. Read the current production migration identity list and the migration-history
   column types. Compare it with the repository's applied/recovered entries,
   respecting each existing `productionVersion` mapping.
2. Identify the same 36 missing versions recorded in the earlier drift
   observation. Check local versions, names, and destination paths for collisions.
3. Read each stored `statements` array. All 36 have exactly one element and no
   stored rollback statement, so no statement joining or reconstructed SQL is
   necessary. `statementCount: 1` describes the stored array, not the number of
   SQL commands inside that element.
4. Calculate the authoritative byte count and digest in PostgreSQL using
   `octet_length(statements[1])` and
   `encode(sha256(convert_to(statements[1], 'UTF8')), 'hex')`. Compare these with
   the UTF-8 bytes captured locally before adding any file to the repository.
5. Review every SQL body for literal credentials, private imported records,
   dependencies, replacements, and replay side effects. Copy the reviewed bytes
   unchanged to their production-version filenames.
6. Add manifest entries with `recoveredFromProduction: true`,
   `appliedToProduction: true`, the explicit original `productionVersion`, the
   file SHA-256, and `sourceRecovery` byte/hash provenance. Mark the recovery
   policy `ALREADY_APPLIED_DO_NOT_REPLAY`.

All 67 prior manifest entries, their source hashes, and their production-version
mappings were preserved. Only the repository file-count summary was updated,
and a separate `migrationHistoryRecovery` observation was added. The full hashes
and byte counts are in [the migration manifest](../../supabase/manifests/migrations.json).
Raw transport captures and review scratch are outside the public repository.

## Reviewed history

Each version below maps directly to
`supabase/migrations/<version>_<name>.sql`. The review notes identify what the
stored migration does and why source recovery does not authorize another run.

| Production version | Stored migration name | Historical operation / replay consideration |
| --- | --- | --- |
| `20260925045727` | `archive_player_prop_market_quotes` | Creates the quote archive and archive function, then immediately invokes an archive backfill. |
| `20260925045757` | `archive_player_prop_market_quotes_retention` | Unschedules/replaces retention; scheduled work archives and deletes quotes older than 14 days. |
| `20260925050326` | `register_nfl_player_prop_capture_component` | Registry upsert explicitly forces the NFL capture component disabled. |
| `20260925055553` | `register_nba_player_prop_capture_component` | Registry upsert explicitly forces the NBA capture component disabled. |
| `20260925062619` | `add_sport_to_player_prop_feedback_v2` | Adds sport defaults/indexes and replaces the CLV view; depends on existing prop tables/views. |
| `20260925063434` | `register_nba_player_prop_feedback_components` | Registry upserts explicitly force four NBA feedback components disabled. |
| `20260925073838` | `isolate_player_prop_latest_by_sport` | Replaces the latest-prop view and adds a lookup index. |
| `20260926212332` | `create_options_iv_snapshots` | Creates options IV storage and its historical grants/indexes. |
| `20260926214103` | `create_options_profit_tracking` | Creates setup/paper-trade tables and historical grants/indexes. |
| `20260926214350` | `index_options_paper_trade_setup_fk` | Adds the paper-trade foreign-key lookup index. |
| `20261029023500` | `prediction_performance_ledger` | Creates ledger tables, triggers, and functions without general rerun guards. |
| `20261029023515` | `mlb_performance_publication` | Replaces decision validation; creates publication/import functions and cursor storage. |
| `20261029023517` | `sport_capture_receipts` | Creates the sport-ingestion receipt wrapper. |
| `20261029023518` | `priority_sport_contracts` | Drops/replaces a sport constraint and replaces prediction ingestion. |
| `20261029023519` | `register_prediction_performance_jobs` | Creates queues/dispatchers, registry entries, and disabled cron jobs; replaces HTTP reconciliation. |
| `20261029023525` | `performance_read` | Creates bounded service read RPC and indexes; a later migration replaces this RPC. |
| `20261029023547` | `exact_market_semantics` | Adds semantic identity functions/index; replaces ingestion, decisions, and publication. |
| `20261029023554` | `final_pass_publication` | Creates the contemporaneous PASS publication RPC. |
| `20261029023606` | `global_portfolio_read` | Replaces the earlier performance read RPC. |
| `20261101153743` | `nba_research_scoreboard_cache` | Creates durable scoreboard handoff storage. |
| `20261105035258` | `create_edge_lab_slip_archive` | Creates the private archive schema/table and grants; contains no personal archive rows. |
| `20261105035635` | `edge_lab_private_read_only_slip_dashboard_rpc` | Creates/replaces the bounded service-only archive read RPC. |
| `20261105154730` | `create_private_edge_lab_pregame_research_boards` | Creates private research-board storage; contains no saved recommendations. |
| `20261107173526` | `edge_lab_nba_nfl_propgpt_market_capture_v1` | Creates pregame quote/result storage, constraints, indexes, and grants. |
| `20261107173920` | `edge_lab_external_nba_nfl_prop_sample_quarantine_v1` | Creates external-sample quarantine storage with eligibility flags defaulting false. |
| `20261107174420` | `edge_lab_service_role_only_capture_rpc_v1` | Creates/replaces the service-role capture RPC; does not import a batch itself. |
| `20261109134149` | `hosted_nba_prop_collection` | Creates collector tables/functions and inserts its singleton state; later migrations supersede functions. |
| `20261109134355` | `harden_hosted_nba_lease` | Replaces collector completion with stricter lease and timestamp handling. |
| `20261109134514` | `rotate_hosted_nba_settlement_dates` | Replaces collector claiming with date rotation. |
| `20261109135023` | `schedule_hosted_nba_prop_research` | Schedules an HTTP collector using a minute offset calculated at execution time and Vault references. |
| `20261110085941` | `support_automatic_nba_inactive_outcomes` | Adds inactive-evidence validation and replaces collector completion. |
| `20261110112053` | `reviewed_nba_live_decisions` | Creates approval/live-decision tables and RPCs; seeds no model approval. |
| `20261110163916` | `batch_nba_forecast_persistence` | Replaces collector completion again and creates bounded saved-forecast lookup. |
| `20261116155528` | `nfl_exact_price_evidence` | Creates append-only price-evidence tables and indexes. |
| `20261116155905` | `schedule_nfl_exact_price_collection` | Schedules HTTP evidence capture using Vault references, with a fixed February 2027 cutoff. |
| `20261119213136` | `edge_sharp_money_research_snapshots` | Creates research snapshot storage, indexes, and historical access restrictions. |

## Secret and private-data review

No literal credential or private imported recommendation/ticket payload was
found in the 36 bodies. The review covered JWTs, modern Supabase keys, private
keys, cloud/GitHub/API-token patterns, credential-bearing URLs, high-entropy
literals, and credential/header construction. The three high-entropy literal
candidates were official NBA URL-validation regular expressions, not secrets.

Scheduler credentials are referenced dynamically through Vault names; no Vault
value was retrieved. Collector lease tokens are generated UUID state, not
embedded authentication credentials. Private table definitions and bounded read
RPCs are source code only; their row contents were not read or copied.

No source was redacted. Had a body contained a credential, it would have remained
outside this public repository and its identity would have been reported as
blocked rather than falsely marked an exact source match.

## Collisions, ordering, and replay limits

There are no duplicate destination paths, local versions, stored names, or
represented production identities. Existing local-to-production version mappings
were not renamed or recomputed.

Four created/replaced SQL objects also occur in previously committed migration
files:

- `public.player_prop_clv_latest`: the recovered September 25 view follows the
  September catch-up definition.
- `public.player_prop_latest`: the recovered September 25 view follows the
  initial prop schema and TensorFlow-field migration.
- `public.reconcile_pipeline_http_requests_v1`: the recovered October 29
  replacement follows the September pipeline-health catch-up definition.
- `public.read_nba_live_decisions_v1`: the recovered November 10 creation
  precedes the already-committed November 11 replacement.

These are chronological definition changes, not filename collisions. Later
replacements within the recovered batch are also preserved in order. Applying
an old `CREATE OR REPLACE` independently could regress newer behavior. Other
files use unconditional `CREATE`, seed singleton rows, change constraints, or
alter registry and scheduler state. The mere presence of `IF NOT EXISTS` in
some files does not make the batch safe to rerun.

One historical comment says “Unapplied forward migration.” Its production
history entry establishes that it was applied; the comment is preserved as
part of the exact source, and the manifest correctly records it as applied.

The 10 existing catch-up migrations remain local reconstruction artifacts, not
newly discovered hosted deployments. A fresh database rebuild, current object
definition parity, and current cron/security state require their own checks;
none is asserted by this recovery.

## Exact-source whitespace

Nine stored bodies end with extra blank lines. A new-file `git diff --check`
reports only `new blank line at EOF` for versions `20261029023500`,
`20261101153743`, `20261109134149`, `20261109134355`, `20261109134514`,
`20261109135023`, `20261110085941`, `20261110112053`, and `20261110163916`.
Those bytes are preserved deliberately because trimming them would break the
recorded source hashes. No other new-file whitespace finding was observed.

## Validation and remaining limits

The local capture verified 36 of 36 source hashes and byte lengths against
PostgreSQL-calculated values. A second read independently confirmed that all 36
stored source hashes and the 93 production identities were unchanged. Final
local verification completed at `2026-11-23T18:20:02.883995+00:00`.

| Check | Observed result |
| --- | --- |
| New file bytes vs initial and fresh server SHA-256/byte counts | 36/36 exact matches; 157,372 bytes |
| Applied/recovered manifest identities vs fresh production list | 93/93 matches; zero missing, unexpected, or conflicting identities |
| Local version/path uniqueness | 103 unique versions and 103 unique paths |
| Previous manifest entries vs integration-branch `HEAD` | All 67 unchanged, including hashes and production mappings |
| `python scripts/supabase/validate_reconstruction.py .` | Exit 0 |
| `python scripts/supabase/validate_reconstruction.py --check-secrets .` | Exit 0 |
| Focused inventory/drift regression command below | 14 passed, zero failures |
| New-file whitespace scan over all 36 recovered SQL files | Nine inherited EOF-blank-line findings listed above; no others |

Focused regression command:

```sh
PYTHONPATH=. python -m pytest -q \
  tests/supabase/test_inventory_diff.py \
  tests/supabase/test_production_drift_runtime.py \
  tests/supabase/test_reconstruction_inventory.py::test_historical_migration_inventory_is_exact \
  tests/supabase/test_reconstruction_inventory.py::test_catchup_migration_chain_is_unique_and_hardened
```

The installed AnyIO pytest plugin emitted its existing `CallSpec2` deprecation
warning; no application test failed.

There is no source-recovery blocker among the 36 requested identities. Migration
identity completeness must not be presented as a clean full-production drift
result, approval of every historical behavior, or proof that a new database can
be rebuilt successfully. No runtime behavior test or production replay was
performed for these already-applied migrations.
