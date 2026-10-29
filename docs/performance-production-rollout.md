# Cross-sport Results backend rollout

Project: yeoxroijaptomomshdii. Verified 2026-10-28 America/Chicago (2026-10-29 UTC).

The existing Vercel Results screen returned 503 because prediction-performance was absent and the performance ledger schema had not been installed. Applied the committed, tested ledger, MLB publication, sport receipt, priority sport, disabled job registry, read, semantic identity, final PASS, and global portfolio read migrations. Management API assigns installation timestamps: do not replay these migration bodies merely because local filename versions differ from hosted history. Private-account migrations and capture dispatch replacement were NOT applied.

The initial service-key REST reader failed with PGRST303/401: gateway JWT issued in the future (opaque service credential). No credentials were logged or changed. The reader now uses the runtime SUPABASE_DB_URL via pinned postgres 3.4.9, a read-only transaction, SET LOCAL ROLE service_role, parameterized fixed RPC, eight-second statement timeout, bounded connection lifetime, and generic public errors. Database permissions are unchanged: anon/authenticated cannot execute the RPC or select the ledger. All new tables have RLS. Public results use the existing safe projection only.

Deployed prediction-performance version 4. The existing dashboard API returned 200 and the browser Results tab rendered coverage, filters, and honest empty results. No history was manufactured or imported. Cross-sport ledger has zero records; capture/settlement jobs remain inactive. This repairs the reader, not the full prospective tracking rollout. Existing legacy MLB diagnostics remain separate. No model weights or PLAY thresholds changed.

Validation: 385 Node tests, 49 Python tests, and actual PGlite reader fixtures (250 rows, paging, latest settlements, safe projection, denied public access, 10,000-row bound) passed. Native PostgreSQL CI runs the same database reader adapter. Remaining: verify capture source contracts, deploy authenticated capture/settlement workers, configure authorized service credentials, enable per-sport capture, then reconcile eligible history with explicit legacy labeling. Gateway future-token fault may still affect other REST-backed functions and should be resolved with the platform.

## Historical results reader repair

On October 29, dashboard-results v2 was deployed using a bounded read-only direct database transaction under service_role. It preserves the existing GET route, validates filters, binds SQL parameters, limits row lists to 200, excludes raw payloads, and scopes grade/snapshot counts to the selected sport. No write path or model gate changed.

Verification: 387 Node tests passed. The production reader returned 550 graded observations, 558 audit observations, 46 game results and 4,806 MLB snapshots. The existing oygsu1hca Vercel dashboard API returned grades=550, marketSnapshots=4806 and results source ok=true. NFL audit/grade counts returned zero rather than incorrectly inheriting MLB totals. This restores the legacy summary/read API, not the cross-sport ledger or other REST-dependent functions.

## Tracking repair follow-up

- prediction-performance v5 now includes separately labeled all-time MLB historical diagnostics. Prospective/qualified metrics are unchanged.
- Results renderer includes an expandable historical section, outside current cohort/date filters, with escaped team names and saved result/check labels. Frontend release remains pending.
- grade-player-props v3 and grade-team-markets v4 use direct database access with bound parameters, service-role transactions, SQL deadlines, a Vault comparison against the existing pipeline credential, and JWT verification still enabled. Results insert idempotently; retries do not overwrite earlier grades.
- Real scheduled dispatch requests 88873 and 88874 returned HTTP 200, checkedRows=0 and rowsGraded=0. This confirms authentication/read recovery, NOT new capture or live settlement proof.
- 390 Node tests passed. PGlite tests exercised real result schemas, credential acceptance/rejection, MLB-only reads, writes and immutable retry outcomes.
- Capture-model-audit still depends on the old decision endpoint, which includes a failing REST market-alerts call. Capture is not yet restored. No daily-play, calibration, or full-system completion claim.

## Capture dependency verification

market-alerts v4 now reads bounded snapshot data through a read-only direct database transaction. The alert calculations are unchanged; invalid filters and more than 12,000 snapshots fail explicitly. The live alert endpoint and upstream tau /api/decision both return HTTP 200. Scheduled model_audit request 89145 also returned HTTP 200 but auditRowCount=0 and marketGradeRowCount=0.

Current board evidence: SportsGameOdds quota exhausted (2,500/2,500 monthly objects, 429); fallback The Odds API has 453 requests remaining but returned zero MLB events in the queried window. No new production predictions or settlements were demonstrated. Capture insert authentication remains untested while rows are empty.

Final local validation: 391 Node tests, 49 Python tests and the PostgreSQL grading repository integration test passed. Vercel preview creation for commit 24fa9bfed26a3ecc8e59c3fbbb9d53fd7ece40b7 was rejected with HTTP 403. The historical UI is pushed but not released; no master merge.
