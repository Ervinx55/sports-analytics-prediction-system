# Winner evidence release — 2026-11-17

The three remaining NBA history records and two NFL schedule conflicts are repaired. Both live models remain frozen; this release changes evidence collection, provenance and diagnostics, not prediction coefficients, approval thresholds or production influence.

## Verified hosted results

- NBA collector v47 (`1e479fca78d3ec562eaff38cd99fcf14cccb9f2230fb15f027c49ef9a1452db6`) preserves all prior files except the reviewed BDL reconciliation module and queue worker, and adds the pinned official evidence/helper. JWT verification remains enabled.
- Collection request 3964 completed HTTP200 at approximately17:55 UTC: histories194→197, invalid3→0, reconciliation checked3/accepted3. It appended64 forecast rows (32 per frozen model), without rewriting previous forecasts. The run evaluated344 eligible rows per model; those per-run counts are not cumulative independent samples.
- The three hash-qualified accepted summaries preserve original BDL receipts, official source hashes, complete roster/stat comparisons, source omissions and the quarantined extraneous participant. No missing participant became a zero or DNP. See `nba-reviewed-history-2026-11-17/README.md` for exact evidence scope.
- Baseline NBA hash remains `31a5b080bdf88ff0ce6eb3b8c06c204e4bdd3e8693b1953cb919eb3a8aa2a0ce`; `matchesFrozenModel=true`, `productionWeight=0`. The minutes comparator stays on its existing frozen protocol. NFL/NBA winner model source files and manifests are unchanged.
- NFL official November9 flex announcement and Week11 schedule establish JAX–NYG21:25UTC and PIT–PHI18:00UTC on November22. Two append-only revisions were registered; the original30 forecasts and two flags were preserved. Request3958 captured two corrected NFL identities with fresh SportsGameOdds agreement and paired prices, reporting zero current schedule conflicts.
- Winner cohorts now cover17 NBA and13 NFL physical games. NFL contains15 rows because the two original conflicted rows remain quarantined alongside their corrected versions. These are research forecasts, not cleared PLAYs. None of these future games has a final outcome yet.
- The official NBA adapter mapped tonight's five games and50 expected starter rows exactly, archived injury-report context for all five, and reported0 confirmed lineups. The official feed's timezone-less player timestamps remain raw; actual pregame HTTP receipts prove observation time. NFL inactive collection waits until the three-hour game-day window; an inactive list never certifies a complete active roster.
- Outcome queue repair prevents426 incompatible legacy observations from consuming SGO collection turns. It retains them for the legacy collector and preserves the shared lease, date rotation, evidence and outcomes.

## Outstanding source evidence

At17:55UTC the NBA prop board had344/356 exact paired quotes ready:5 opposite quotes absent and7 unavailable/suspended. A ready pair is not PLAY approval. Future scheduled collections continue checking these prices.

The latest Nov17 outcome pass checked276 observations, including174 distinct observations with frozen forecasts. PHI–BKN124 and POR–MIN130 require unavailable BDL backup verification; the last acquisition returnedHTTP401 and imposed its existing cooldown. No Nov16 Eastern-date BDL packet exists. HOU–MIA14 and CLE8 lack verified positive-minute participant results; the HOU official check supplied no inactive proof, while CLE's official-source request failed. All remain unresolved. This release does not claim these are zero statistics, inactive players or settled losses.

Pregame reports still include unknown/not-yet-submitted availability. Expected starters are not confirmed. Neither source gaps nor model validation gates were bypassed, and no recalibration or promotion was performed.

## Verification and deployment

- 431 Node tests passed, including11 exact-history tests and the new lineup/schedule/queue regressions.
- 78 Python tests passed; Supabase reconstruction and secret scan passed.
- 10 hosted SQL rollback groups passed: five source-queue and five schedule-revision groups. Tests preserve original evidence, reject forged/cross-game/future identities, enforce leases and private access, and roll back synthetic fixtures.
- Mobile sharp-book research and worksheet regression passed.
- Vercel staged build `dpl_5hg7szaBXqJfZnRC3cHJG5Jbzrcj` is Ready, authenticated collection returned200, unauthenticated collection returned401, and public status returned200. Promoted to the canonical `sports-analytics-prediction-system-tau.vercel.app` alias after hosted verification.
- Applied migration names: `winner_official_schedule_revisions` (production version20261117174822) and `nba_source_scoped_outcome_queue` (20261117174823). Original source records and live model configurations remain unchanged.
- Existing winner10-minute and NBA prop15-minute cron schedules remain active. No new paid service or automatic wager action was introduced.

Local source receipts, audit responses and test logs are under `outputs/winner-evidence-2026-11-17` outside this worktree. Raw official responses are retained there; audited identity/stat evidence and reproducible tests are versioned in the repository.
