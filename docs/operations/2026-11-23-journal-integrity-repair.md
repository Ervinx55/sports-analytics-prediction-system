# Decision journal and official result integrity repair

## Verified deployment

The additive repair in `supabase/migrations/20261123170415_repair_decision_journal_integrity.sql` was applied to production as version `20261123171926` at 2026-11-23 17:19:26 UTC. The deployed statement SHA-256 matches the checked-in file:

`952204532c85061230b6db4b3eacf13e9bc73517cd9bc6612a767cbfdd833957`

The deployment verification retained all **45,803 existing journal rows**. The three ledger tables expose only `SELECT` and `INSERT` to the service role; public, anonymous and authenticated clients have no grants. Row level security is enabled on all three tables. The post-deployment advisor scan found no journal warning or error. The remaining no-policy informational entries are expected for these service-only tables.

Seven original November 22 journal migrations were recovered from production statement records without changing their SQL. They were already applied in production. Their checksums and production mapping are recorded in `supabase/manifests/migrations.json`; the repair is a separate migration.

## Root causes and repairs

The hosted journal had no checked-in schema or supported manual recording command. Its original outcome view joined only existing MLB team attribution. NBA provider outcomes were deliberately labeled research-only, so they did not constitute reviewed official results. No manual recommendation records were present in the pre-repair audit.

The historical NBA slice contained **1,500 refresh records for 78 exact market sides in one event on one date**. These are repeated evaluations, not 1,500 independent historical examples. The repair preserves every raw record. The bounded scorecard counts exact market sides and games separately and chooses the earliest recorded decision. A later import with an earlier claimed issue time cannot replace that first capture.

The journal was 80 MB including indexes at the initial read of 45,191 rows; the heap occupied 72 MB, and the stored evidence averaged 962 bytes per record. The live collector continued writing during the investigation. New matching indexes cover the exact identity fields. Scorecard requests are service-only and limited to 31 days; grading batches are limited to 2,000 rows.

Unknown original issue times remain `NULL`. Future journal insert times use `clock_timestamp()`, so a transaction opened before a game cannot insert a late decision with a pregame transaction timestamp. Retrospective imports are excluded from prospective sample counts. Research selections, conditional selections, reported recollections, system evaluations and documented tickets retain distinct labels and provenance.

The prior journal trigger functions were executable by anonymous and authenticated roles, and the immutability function had an unfixed search path. The repair removes those grants, pins paths, and uses caller permissions. It explicitly revokes inherited service-role privileges before granting the required read/insert privileges, including removing `TRUNCATE` and `UPDATE`.

## Official result contract

`edge_official_result_revisions_v1` stores reviewed result evidence independently of provider research outcomes. It requires a final result, a past event and retrieval time, a named reviewer, a supported sport and market, an official league URL, exact event/player identities, an explicit period, a captured-source SHA-256 and identity evidence binding those fields together. Unsupported markets, ambiguous identities and unconfirmed participation remain ungraded.

`sourceCaptureFormat` distinguishes `ORIGIN_RESPONSE_BYTES` from `SEARCH_SERVICE_EXTRACTED_OFFICIAL_PAGE`. In the second format, the checksum identifies the archived tool response containing the official page extraction; it is **not** an origin HTML checksum. The same format and hash must appear in the reviewed identity evidence. Neither a matching URL nor an ID equality check claims to verify the contents automatically: a named reviewer must check the actual final result against the retained source.

Corrections append a new revision referencing the exact prior result. Restoring an older value creates another revision, rather than returning the old revision. Retries with the same content and predecessor return the existing record. Corrections and grading share an advisory transaction lock, and the grade primary key enforces one grade per decision and official result revision.

The grading join uses exact sport, event ID, scheduled start, player ID, market and market scope. The decision's own side and line determine the threshold result. Moneylines, spreads and totals use reviewed team scores. Pushes remain pushes. Negative or fractional NBA count statistics are rejected; legitimate negative football yardage remains supported.

These grades use `STATISTICAL_THRESHOLD_ONLY`. They never establish a placed wager, sportsbook settlement, payout, stake, ROI or closing-line value.

## Commands

The command defaults to a JSON plan and makes **no network request**:

```sh
node scripts/edge-lab/decision-journal.mjs record --input /private/review/decision.json
node scripts/edge-lab/decision-journal.mjs result --input /private/review/result.json --source-file /private/captures/official-source.pdf
node scripts/edge-lab/decision-journal.mjs grade --result-id 123 --limit 1000
node scripts/edge-lab/decision-journal.mjs scorecard --from 2026-11-22T06:00:00Z --to 2026-11-23T06:00:00Z --record-kind recommendation
```

After reviewing the exact plan, add `--apply` to execute that single RPC. Supply `SUPABASE_URL` and either `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` through the runtime environment. Modern secret keys use the `apikey` header; legacy JWT service keys also use a Bearer header. Credentials are never included in the plan or printed.

Record the original decision first. Record the reviewed official result separately, then use its returned result ID for grading. A batch reports the number inserted and the number remaining. Repeating a completed batch inserts zero rows. If the official result has been superseded, the old revision cannot grade new records.

Manual import payloads, personal recommendation histories and raw source captures stay outside this public repository. The reviewed private batch is an operational artifact, not part of the deployment. Applying the schema does not import or grade that batch.

## Validation

Run the executable SQL regressions with the pinned PostgreSQL WASM runtime:

```sh
npm ci --prefix tests/sql
npm --prefix tests/sql test
node --test tests/node/decision-journal-cli.test.mjs
```

The final focused run passed **10 SQL tests and 6 CLI tests**. It covered exact identity and period matching, partial grading batches, idempotent retries, corrections including restoration of an earlier value, immutable history, missing/future/misattributed evidence, source-format binding, role privileges including inherited defaults, unknown chronology, late insertion in an earlier transaction, scorecard deduplication, generic unknown periods, strict calendar parsing, source-file checksum verification, and both service-key formats. An independent reviewer also reproduced the initial defects and approved the final migration; an unsupported legacy-source fixture correctly aborted before assigning period metadata.

The SQL suite exercises PostgreSQL semantics through PGlite. Production verification separately checked the deployed statement hash, preserved row counts, grants, RLS and advisor results. Provider research outcome rows were not rewritten or silently promoted to official evidence.
