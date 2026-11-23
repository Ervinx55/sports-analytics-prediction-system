# Props integration repair — 2026-11-23

## Result

The deployed NBA research route now reports the evidence that prevents a player-prop prediction from being cleared. The PrizePicks diagnostic is reachable through the deployed NBA function and uses the existing SportsGameOdds provider protection. NBA prop predictions and BUY approval remain unavailable until their evidence and calibration requirements are met.

This change supersedes the useful intent of pending PRs #76 and #78 without importing their detached modules wholesale. PR #76 supplied a Python research formula with no live caller. PR #78 placed a diagnostic under the repository's inactive root API directory, used direct provider requests outside the shared protection, and read event start times from the wrong field. The implemented diagnostic uses `event.status.startsAt` and the deployed `sharp-service` route.

## Implemented behavior

### NBA readiness

`GET /api/nbaprops?view=research` supplies a response-level `propReadiness` summary and a `nba-prop-readiness-v1` object on each player-market record. Provider event, player, start time and team binding determine whether identity is roster matched. Historical context is not treated as confirmation of future minutes or participation.

Every record reports the currently unmet requirements:

- Projected minutes are unavailable.
- The rotation is unconfirmed.
- Player injury clearance is unverified.
- Matchup and role adjustments are unvalidated.
- Prop calibration is unvalidated.

Readiness always returns `AVOID_UNVERIFIED`, null projected minutes, null model probability, null expected value, `productionEligible: false` and `productionWeight: 0`. It does not manufacture a projection from historical averages. The existing research interface receives the readiness explanation through `research-data.js` and continues to display quote-only NBA rows.

Quote collection and historical explanation collection start concurrently. A historical-read rejection is handled immediately and does not remove valid quotes or become an unhandled promise rejection when quote collection fails first.

### Protected PrizePicks diagnostic

The route is `GET /api/nbaprops?view=prizepicks`, authenticated with the existing `SHARP_MONITOR_TOKEN` via the `x-monitor-token` header. Authentication runs before provider access and before cache reuse. All responses use `Cache-Control: private, no-store`. This adds no Vercel function.

The only upstream is the configured SportsGameOdds account, using `SPORTS_ODDS_API_KEY` or the existing legacy `Sports_Game_Odds_API` fallback. The implementation uses both `optimizeSportsGameOddsObjectLimit` and `protectedSportsGameOddsFetch`; background priority preserves critical traffic capacity. It does not call PrizePicks directly, evade provider blocks, change accounts, expand a subscription or assume an entitlement.

The query is bounded to two pages, at most 16 provider events per page, and an hourly stable 48-hour window. Object pressure can reduce the page size. Main full-game over/under props retain their provider stat IDs, including combination and three-pointer markets when actually returned. The normalizer rejects started, completed, cancelled, out-of-window and roster-mismatched events, invalid market identity, unavailable offers, and boolean/array/object/blank/negative lines.

Duplicate event pages do not inflate quote counts. Original provider fetch and quote-update times are preserved. Quote freshness, incomplete pagination and provider failures are reported separately. The diagnostic supplies no executable single-pick odds, market probability, model probability, payout estimate or play approval.

| Condition | HTTP result | Meaning |
| --- | --- | --- |
| Monitor token is not configured | 503 `MONITOR_AUTH_UNAVAILABLE` | No upstream request |
| Missing or incorrect supplied monitor token | 401 | No upstream request or cached data |
| Provider key is missing | 503 `PRIZEPICKS_PROVIDER_NOT_CONFIGURED` | No quote request |
| Object quota is exhausted | 429 `PRIZEPICKS_OBJECT_QUOTA_EXHAUSTED` | No quote request |
| Provider rejects access with 401 or 403 | 502 `PRIZEPICKS_PROVIDER_ACCESS_DENIED` | No returned quotes, even if a prior page or cache exists |
| Provider is unavailable or returns an invalid/stale response | 503 | No invented feed data |
| A later non-authentication page fails | 200 with incomplete coverage | Already collected valid observations retained; failure is explicit |
| Provider returns no eligible quotes | 200 `NO_QUOTES_RETURNED` | Does not assert that entitlement is absent |
| Eligible quotes are returned | 200 | Research observations only |

### Additional reproduced integration defects

Research pagination previously treated `false` and `0` cursors as successful completion. Only absent/null/empty cursors now establish completion; malformed, repeated or excessive cursors stop collection with an explicit reason.

NFL research previously joined frozen estimates to quotes using event/player/market/side/line/book/odds without the game start time. A rescheduled game could inherit an estimate for the previous kickoff. The join now includes the exact parsed start time. NFL shadow status and all NBA probability restrictions are preserved.

## Verification

The new regression tests first reproduced the missing live readiness contract, incorrect pagination completeness, detached diagnostic routing and rescheduled-game estimate join. An additional regression reproduced cached/partial quotes masking an upstream access denial before that handling was corrected.

The final focused command passed **66 tests, zero failures**:

```sh
node --test tests/node/prizepicks-diagnostic.test.mjs tests/node/nba-prop-readiness.test.mjs tests/node/nba-multibook-research.test.mjs tests/node/nba-api-restoration.test.mjs tests/node/nba-prop-coverage.test.mjs tests/node/research-data.test.mjs tests/node/research-loader.test.mjs
```

This includes a real-handler integration test using the actual provider-protection implementation with only the outbound HTTP boundary replaced by a controlled fixture. Concurrent authenticated requests produce one upstream request, the follower receives coalesced data, subsequent reads hit the cache, and an invalid monitor token cannot reuse that cache.

The full Node suite also passed **533 tests, zero failures** before the last two diagnostic regressions were added. The integrating repair must record its final full-suite count after all agents' changes are complete. `git diff --check` was clean after the final focused run.

## Production verification and limits

The initial scoped implementation used controlled fixtures and made no authenticated production feed request. After PR #79 deployed, the integrating agent captured the actual public research response: 10 NBA events and 911 player-market records, with provider roster identity and readiness metadata. Its book coverage reported **552 available, fresh PrizePicks DFS quote sides and zero comparable executable price sides**. This is evidence that the configured SportsGameOdds account returned those research lines at that observation time. It does not establish entry payouts, individual-pick prices, model probabilities or a cleared play.

The separate private diagnostic returned **HTTP 503 `MONITOR_AUTH_UNAVAILABLE`**. Its production monitor token is not configured, so the authenticated diagnostic's live upstream path remains unverified. Public research coverage and private diagnostic readiness are different operational results. Do not describe the private diagnostic as fully enabled, or the returned DFS lines as executable betting prices. These production captures remain outside the repository; no provider credential is included in this report.

Confirmed rotations, player-specific injury clearance, independently validated prop distributions and calibration are still missing inputs. This repair makes those blockers explicit and connected to the live response; it does not clear player-prop BUY decisions.

## Follow-up: NBA historical replay availability

An independent review found that `nba-vnext-backtest.js` selected historical games using only their start time. In a synthetic regression, a 19:00 game's eventual 180–60 final score changed a 20:00 target's forecast from 0.6493951453 to 0.695545834 even though the earlier game's final observation was at 22:00. The overlapping result was unavailable at the target forecast.

The replay now requires one `nba-final-observation-v1` archive reference per physical game, binding its event ID, start, teams, numeric final scores and completed status to an explicit `observedAt`, HTTPS source URL and source SHA-256. It admits a historical result only when that observation is strictly before the target's forecast time. The code never estimates completion from tipoff or a presumed game duration. Archive references are caller-supplied metadata; the replay does not claim to independently retrieve or authenticate the underlying archive.

Missing, invalid, duplicate or conflicting evidence blocks the cohort with `BLOCKED_TEMPORAL_EVIDENCE`, zero evaluated games and null accuracy/return metrics. This avoids silently evaluating an altered subset while claiming complete history. The existing ESPN parser and daily collector do not supply original archived final observations, so their nonempty legacy inputs now produce the explicit blocked state. Empty history remains `INSUFFICIENT_HOLDOUT`. Earlier version-1 replay metrics must not be described as proven free of future-result leakage.

The version-2 report records eligible historical event IDs and the latest admitted final-observation time for each forecast. Production eligibility stays false, production weight stays zero, and automatic BUY remains disabled. Fifteen focused tests passed, including overlap-score invariance, the exact time boundary, missing/mismatched evidence, duplicate physical games, strict score types, and existing baseline/daily behavior. Synthetic receipt times are used only in test fixtures; no production evidence or completion times were created.

## Follow-up: canonical NBA page metadata

Post-deployment inspection found a distinct UI integration defect. `/nba.html` requests the default `/api/nbaprops` feed, not its `view=research` branch. The captured default response generated at `2026-11-23T17:43:05.616Z` contained 10 events, 347 player-market records and 675 book quote sides. All 347 records retained provider event/player/team bindings and historical explanation context, but the default adapter omitted event matchup names, `prop.identityStatus` and prop readiness. The page also recognized only the older ESPN `ROSTER_MATCHED` label and printed an absent `quoteState` as “Unknown.” Switching to the research route alone would not fix those renderer defects.

The follow-up keeps the default DraftKings points/rebounds/assists feed, its existing 48-hour window, two-page maximum, 16-event page limit, shared provider protection and original timestamps. It adds source-provided matchup and player names, provider roster identity from the existing exact event binding, and the same conservative readiness contract already present on research responses. Missing source names remain explicitly unavailable; a player ID is not relabeled as a person's name. Existing historical context enrichment remains intact.

The page now recognizes `PROVIDER_ROSTER_MATCHED` without attributing that identity to ESPN or claiming injury clearance. Its visible explanation and deep-dive disclosure receive the original readiness summary and missing-evidence reason codes. Player prediction, production eligibility and production weight remain null/false/zero as applicable.

Quote diagnostics use the existing `assessPropQuote` implementation. A comparison needs an explicitly available quote and opposite side at the same book and line, with valid prices and current original timestamps. An omitted provider availability flag no longer becomes `true`. Suspended and unconfirmed sides remain visible for diagnosis, while stale, future, missing and different-line prices cannot produce a comparable pair. The page labels the assessment time and provides a refresh control, so its snapshot checks are not presented as a continuously updated execution guarantee. DFS and exchange observations keep their execution terms separate.

Review also reproduced two integrity defects in this same default adapter. A `false` or `0` pagination cursor incorrectly marked coverage complete, and JavaScript coercion accepted `[2.5]` as a line or `[-166]` as a price. The adapter now applies the research path's strict cursor completion rules and length bound. Price and line parsing accepts finite numbers or decimal strings; arrays, booleans, objects and blank values cannot manufacture a bookmaker observation. Both fixes retain the existing request budget.

The exact captured default response has SHA-256 `c2e061e9127ed3f5eec5d1ded2a3269289d339e4ce54f3af447430361dc94c2f`. It and the larger research capture remain outside git. The committed minimal fixture reconstructs the relevant provider event, roster and quote shape; it is not a new live data capture.

### Follow-up verification

Seven new regressions executed the actual inline `/nba.html` renderer with a minimal DOM and the real quote-check and deep-dive builders. All seven failed before the patch. They cover both default and research response shapes, source names and identity, explicit availability, stale/future/missing/different-line prices, later reassessment, missing names or invalid roster binding, and preservation of historical context plus readiness reasons. Three additional regressions failed before correcting default-feed cursor handling and numeric coercion, bringing the new file to ten tests.

The following command passed **40 focused tests, zero failures**:

```sh
node --test tests/node/nba-prop-display.test.mjs tests/node/nba-api-restoration.test.mjs tests/node/nba-prop-coverage.test.mjs tests/node/nba-paired-quote-diagnostics.test.mjs tests/node/nba-prop-readiness.test.mjs tests/node/deep-dive-integration.test.mjs tests/node/nba-explanation-snapshot.test.mjs
```

The integrating agent's final complete Node run passed **561 tests, zero failures**. Independent review found no blockers and separately passed 28 focused checks. The reviewer reconstructed all 347 captured default records through the repaired API adapter using exact matched research metadata, restored each record's existing captured context by exact identity, and exercised every page-renderer batch. All 347 had named matchups, recognized provider identity, readiness disclosures and preserved contexts; all eight suspended sides remained noncomparable. The actual research capture rendered all 911 records with its supplied names, identities and readiness. A six-minute-later assessment reduced comparable default quote sides from 646 to zero without changing source timestamps.

The API and HTML must deploy together: an old response genuinely lacks names and readiness, so the new renderer correctly cannot reconstruct those absent source facts. Production deployment and the final live browser check are performed by the integrating agent; fixture and capture-replay success alone do not claim that the follow-up is already live. Code and tests were frozen after independent approval.

## Follow-up: current NBA model-decision widget

The separate top-of-page widget uses `/api/dashboard?nbaLive=1`, routed to `handlers/nba-live-decisions.js` and the existing `read_nba_live_decisions_v1` RPC. The SQL reader selects the latest record for each quote identity and model hash, then applies its current approval and validity checks. The two experimental models therefore legitimately produce two records for many exact quotes. Displaying those records as separate market cards made the board look duplicated.

A read-only production capture generated at `2026-11-23T18:14:26.753829+00:00` returned 500 model evaluation records for 252 exact quotes: 248 quotes had two models, four had one. Every returned record was PASS with null approval, zero production weight and false eligibility. None supplied a player name. The old widget displayed the provider ID after replacing underscores with spaces and labeled unapproved probabilities simply “Model.” The capture SHA-256 is `0966580b380968c8cad12b64c6cd2c9b0fa511aa8b963adf42495778be9fc57f`; the capture remains outside git.

The widget now displays one card for each exact event, start time, player, market, scope, side, line, book and price. Every underlying model evaluation remains available in a labeled disclosure, with its original model identifier, protocol, probability, service status, reason and timestamps. Unapproved or otherwise uncleared percentages are explicitly research estimates and remain inside the research disclosure. No model average or “best” probability is invented, and no evaluation is deleted from the API or database.

Current presentation uses BUY only for a current, approval-backed service PLAY that satisfies the existing eligibility, weight, freshness, expiry and pregame checks. Other cards display AVOID. The original service PLAY/PASS status is shown separately and is never rewritten by the browser. Empty approval IDs, explicit or malformed failure reasons, malformed quote identities, newer same-model PASS records and conflicting same-time model records cannot create BUY. Research disclosure expansion and summary focus survive the periodic currentness check.

Independent review also reproduced a declared PLAY with malformed probabilities or stale/missing opposite-price evidence still receiving BUY. The display now checks supplied model and market probabilities are finite and within zero to one, both American prices are valid, both quote timestamps and the forecast remain inside the publisher's existing ten-minute window, and the supplied market probability matches the quoted pair within the publisher's existing `1e-6` tolerance. These rules come from the recovered `collect-nba-props/v47/scripts/hosted/nba-live-decisions.mjs` contract. They reject inconsistent records; they never fill in missing probabilities or establish model approval.

An explicit `setNbaQuoteNames` export receives the default quote response that `/nba.html` already fetched. It uses only source-supplied names with exact provider event, start, player and roster binding. Conflicting names, future observations, mismatched bindings and missing names remain unavailable; the provider ID is labeled as an ID without being rewritten into a name. The name index is bounded to the default 32-event scope and 5,000 player-market inputs. It adds no request, cannot change any decision field, and never supplies approval or probability evidence. The quote observation time is shown when it supplies the name.

### Widget verification

Eight initial actual-widget regressions failed before implementation. A ninth failing-before regression covers 15 declared-PLAY cases with malformed probabilities, stale/future forecasts or quote evidence, invalid opposite prices and mismatched market probability. The new suite also verifies that the existing read handler retains both distinct model records, and adds disclosure-state and conflicting-name checks. The final focused command passed **39 tests, zero failures**:

```sh
node --test tests/node/nba-live-display.test.mjs tests/node/nba-live-web.test.mjs tests/node/nba-prop-display.test.mjs tests/node/deep-dive-integration.test.mjs tests/node/deep-dive.test.mjs
```

A replay of the full captured response through the actual widget source, in batches covering all groups, produced **252 named AVOID cards, zero BUY cards and all 500 labeled research evaluations**. Exact name metadata came from the previously captured default quote response. The original decision payload was unchanged, and the name bridge made zero additional quote requests.

The browser regression was updated for the grouped research disclosures and current BUY/AVOID labels. Its execution could not reach a page in this runtime: the Playwright-managed headless executable was absent; the already-installed system Chromium then aborted because creating its process-singleton socket was not permitted. No browser was downloaded and no runtime restriction was bypassed. Browser verification must be completed in the integrating agent's supported browser environment; the DOM harness and capture replay do not claim a successful real-browser run.

Final independent widget review passed 29 tests across the actual widget, default-page, read-handler and disclosure paths, with no remaining concrete finding in the reviewed scope. The widget source was frozen after that approval; the integrating agent owns the complete-suite run and release verification.
