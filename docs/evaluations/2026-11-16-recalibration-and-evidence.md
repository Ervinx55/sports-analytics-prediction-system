# Separate recalibration candidates and evidence repair

## Completed

Separate, reproducible NBA and NFL historical development candidates are saved with input and implementation hashes. No incumbent runtime model, registered NBA protocol, model approval or production weight was changed. No untouched holdout was rerun. Candidate artifacts refuse accidental overwrite.

- NBA: 408 training, 224 selection and 526 later development games. The tested minute-band probability adjustments did not earn the predeclared selection improvement, so all three markets retained pooled residual distributions. Synthetic threshold diagnostics are development evidence, not sportsbook returns. See [NBA experiment](nba-recalibration-2026-11-16/README.md).
- NFL: 8,460 player-market development rows from 2024, covering 104 early and 120 later games. Rushing-yard MAE improved 19.5177 to 19.4026; receiving-yard MAE improved 19.3820 to 19.3251. Other location adjustments were rejected. Rushing RMSE and receptions' residual-probability diagnostic worsened. These are modest, mixed development results, not proof of a betting edge. See [NFL experiment](nfl-recalibration-2026-11-16/README.md).

## Live collection changes

`collect-nba-props` version 43 changes only settlement priority and sanitized failure reporting. It rotates first priority even when all events fit in one request, then actually processes that order, so an old conflicting game does not always consume the single fresh backup-date request. Source-hash guard and exact deployed dependency preservation prevent incidental changes to either frozen model. Two manually verified runs returned HTTP 200 without timeouts; the second persisted four forecasts and two observations. Both recovered zero final outcomes.

`collect-nfl-prices` version 1 is deployed with gateway JWT verification and a service-role check. It reads the existing full NFL API and stores raw source evidence, exact two-sided prices and run receipts in three private tables. Both side IDs/stat/player/game period, same-book line, availability, source and timestamps must match; five-minute freshness and pregame receipt are mandatory. Fixed-odds capture excludes DFS/exchange payouts.

The first hosted run at 15:58 UTC saved 261 eligible price pairs; it rejected 70 stale/undated pairs, three missing opposite sides and two unavailable pairs. An earlier local run saved 291 pairs at a different timestamp; these counts are not added into independent samples. All captured records remain ineligible for model promotion until a new protocol and exact candidate hash are bound prospectively.

Cron job `nfl-exact-price-collection-30min` is active at UTC minutes 12 and 42, with collection ending February 15, 2027. The first authorized invocation returned HTTP 200, and unauthenticated POST returned HTTP 401. Deployed source bytes match the reviewed three-file bundle. RLS is enabled on all three tables, anonymous/authenticated access is revoked, and service-role access is limited to SELECT/INSERT. Duplicate identities preserve the original receipt and source reference.

## Unresolved data blockers

The 111 previously identified started NBA player-market observations remain unresolved: 41 player-games across seven events. Four history conflicts remain quarantined. Available verified summaries do not contain the missing player results, so no result was fabricated or reassigned.

Official NBA November 15 evidence lists Dallas at Boston and Oklahoma City at Sacramento. Provider-derived forecasts/request paths use Boston at Dallas and Sacramento at Oklahoma City at the matching start times. The inactive path passes raw provider home/away fields through unchanged. This is an upstream fixture-identity conflict, not a safe reason to reverse the official lookup silently. Official source requests for those provider orientations cannot establish participation. Other blockers include unverified player mapping and backup cooldowns. Corrected provider event identities/box scores, or an explicitly verified cross-source event reconciliation, are still needed.

Historical NFL sportsbook prices cannot be reconstructed from current quotes. Forward paired-price capture now runs automatically; a new untouched chronological forecast/outcome cohort remains necessary before promotion review.

## Validation

- Node regression suite: 308 passed, zero failures.
- Python regression suite: 86 passed, zero failures.
- Mobile research and payout-worksheet browser regression passed.
- Reconstruction manifests and secret scan pass; `git diff --check` passes.
- Independent NBA, NFL and hosted-collector reviews completed; their blocking findings were fixed and retested.
- Final whole-branch review found no important defects. NBA artifacts were regenerated with explicit LF serialization; every numeric metric and model selection remained identical, and hashes survive Git checkout.
- Live collection evidence: [verification JSON](nfl-recalibration-2026-11-16/collection-verification.json).

The website's prediction behavior and existing models remain frozen. Only verified collection infrastructure was released.
