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

## NBA diagnostic capture — October 29

Live NBA team model returned 130 priced forecasts; NFL team model returned 78 markets. NBA props returned observed lines/context, which are not equivalent to independent model probabilities. The NBA capture adapter previously rejected the sport unconditionally.

Added an NBA team adapter that validates the response and forecast age, preserves source probability/quote timestamps, and forces SHADOW with zero production weight. Missing exact result identity, probability basis and settlement policy remain exclusions. One stale response was rejected; a subsequent fresh response was accepted without relaxing freshness checks.

A one-time authorized capture saved 130 excluded NBA forecasts across 11 provider events through ingest_prediction_v1. Verified in SQL and the existing Vercel performance API: diagnosticCount=130, 100 rows on the first page, SHADOW mode, eligible count zero. No decisions or settlements were fabricated. Original raw fields retained in this capture were limited to team names and shadow status; normalized probabilities and market details are saved separately.

prediction-performance v6 now reports SAVED_FORECASTS when saved model evidence exists, instead of labeling NBA universally unavailable. Users can inspect these records with NBA and Raw excluded candidates, October 29–30 UTC. The worker source now routes NBA team models to the adapter, but the worker and automatic jobs have NOT been activated/deployed in this step. Automatic capture, exact result mapping and settlement remain unfinished.

395 Node tests pass. All three remote workflows for preceding commit f6c36b92 passed (Tests, Performance SQL fixtures, NFL Player Props Shadow Backtest). No production influence or master merge.

## Coverage language repair

prediction-performance v7 replaces generic saved-contract/unavailable placeholders with saved-evidence states and plain explanations. MLB cards distinguish 550 historical graded observations from no matches in the current ledger/category/date filters. Live provider inventory is explicitly not checked by this results report; no provider is declared verified. Successful result reads are labeled RESULTS_READER_CONNECTED without asserting capture/settlement health. The renderer uses the new explanation and removes developer jargon and unrelated league-inventory text. Older deployed renderers receive non-placeholder model states and readable provider text, but require a frontend release for the full history explanation.

398 Node tests pass; verified the existing Vercel performance route returns the MLB historical explanation and HISTORICAL_RECORDS_AVAILABLE. Frontend deployment remains blocked by the previously confirmed Vercel 403.


## November 1 tracking and opponent-defense repair

Live read-only audit found 130 NBA diagnostic predictions and all cross-sport performance capture/settlement cron jobs inactive. This explains the absence of continuously collected results; it is not evidence that forecasts have passed validation.

The capture worker now uses a narrow direct PostgreSQL adapter, avoiding the REST credential path that previously failed with PGRST303. It retains service-secret authorization, the explicit enable flag, fixed RPC allowlists, bounded MLB-only source reads, service_role transactions, and timeouts. NFL receipts still own first-seen time and remain immutable across kickoff retries. Do not substitute a public/publishable key for privileged worker authorization. No scheduled jobs were enabled by this code repair.

NBA research now distinguishes the player's own team defensive rating from opponentDefensiveRating (opponent points conceded per 100 estimated possessions). Only eligible completed games contribute; missing possessions remain missing. Higher opponent allowance is matchup context, not a verified league rank or calibrated probability boost. NFL already exposes opponentDefense and position-specific allowance. Both context challengers retain zero production influence pending paired baseline/ablation and untouched holdout evidence.

The exact NBA event matcher accepts the observed ten-minute provider/ESPN schedule offset within a 15-minute limit, requires unique exact home/away identities, and keeps the earlier eligibility cutoff. This helper is groundwork: it is not yet connected to automatic settlement and does not retroactively qualify the 130 diagnostics.

Verification: 404 Node tests, 49 Python tests, and the real-schema sport receipt fixture pass. The fixture now executes the HTTP handler through the actual direct database adapter, including kickoff retry, late receipt exclusion, rollback, role restrictions and immutable payload checks. Production scheduled tracking and frontend release remain outstanding; no model weights or master merge changed.


## November 2 hosted research tracking checkpoint

Deployed track-nba-research v3 and prediction-performance v8. The dedicated worker authenticates against the private performance_service_role_key in Vault; invalid bearer tokens returned HTTP 401. It preserves first pregame snapshots, matches exact NBA team identities and the earlier scheduled cutoff, and appends explicitly labeled RESEARCH_DIRECTION_ONLY final-score outcomes. These outcomes never establish sportsbook settlement, ROI, qualified PLAYs or calibration eligibility. Diagnostic report counts and plain-language warnings support these separate results.

ESPN returned 403 from the Edge runtime but 200 from the existing database HTTP client. A private RLS-protected scoreboard cache provides an asynchronous pg_net handoff: enqueue on one invocation, consume on the next, rather than waiting on nested HTTP requests. Unknown/missing/stale results stay unresolved. Schema migration 20261101153721 was applied. The original 130 snapshots remain immutable. No successful hosted grading or automatic capture is claimed.

On November 2, authenticated verification request 97773 returned HTTP 402: service restricted due to exceed_egress_quota. The provider response says the project owner must upgrade or remove spend caps to restore service. No billing changes were made. performance_nba_capture_team registry is disabled and its cron remains inactive to avoid repeated failed calls. Once service access is restored: enable that registry entry, dispatch once to request scoreboards, dispatch again after responses arrive, confirm stored outcomes and API diagnostic totals, verify a fresh pregame capture and idempotent replay, then activate the existing five-minute job. Other sports remain separately gated.

409 Node tests and the new real PostgreSQL-compatible schema fixture pass. Fixture covers private auth, immutable captures/results, cache handoff, denied anonymous/authenticated cache access and cooldown storage. No master merge or model-weight changes.
