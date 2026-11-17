# Winner collection and history recovery — 2026-11-17

The 91 invalid histories belonged to the NBA prop collector, not to a saved NBA/NFL winner cohort. The acquisition problem was expired BALLDONTLIE cache receipts followed by HTTP 401/cooldown failures. This release repairs that recovery path and adds separate immutable winner research collection. Neither live model is recalibrated, promoted, or given additional influence.

## Verified history recovery

At 16:52:55 UTC, invalid histories fell from 91 to 3 and accepted history games increased from 106 to 194. The collector enrolled 316 prospective NBA prop validation forecasts. The frozen hash remained `31a5b080bdf88ff0ce6eb3b8c06c204e4bdd3e8693b1953cb919eb3a8aa2a0ce`, `matchesFrozenModel=true`, and production weight zero.

The fallback retains the original cached Final packet receipt and re-runs current SportsGameOdds identity, statistics, scores and minutes reconciliation. Only games at least 48 hours old can use it when fresh acquisition is unavailable. Malformed successful responses do not qualify as acquisition failures. Two numeric corrections were independently checked against newly retrieved official NBA HTML/gamebooks and pinned to exact current primary/backup fingerprints. No participant was invented or silently assigned zero minutes.

Hosted collector v45 changed only the acquisition fallback and suspended-price diagnostics. V46 added the two numeric correction records; its other 41 files stayed identical. V46 bundle: `35f4766c46e369433a953da4006f12bafadbca74fcc9c985f519986a459276b4`. JWT verification remains enabled. The read-only source-audit endpoint is v4, with only two additional explicit event IDs allowed.

Remaining histories:

- Brooklyn–New Orleans: missing Drake Powell identity fields.
- Detroit–Miami: extraneous Jeremiah Fears participant plus Harkless identity mismatch.
- Dallas–Boston: fresh official evidence agrees, but the cached fallback becomes eligible only at 23:00 UTC on November 17; BALLDONTLIE still returns an authentication error.

## Winner research collection

Thirty immutable EARLY forecasts were saved: 17 NBA and 13 NFL. Five NBA and eleven NFL games had fresh exact two-sided price comparisons at their first capture. Two NFL events were subsequently identified as schedule conflicts and excluded from further capture/validation: Jaguars–Giants and Steelers–Eagles. The NFL's [November 9 flex announcement](https://media.nfl.com/news-and-releases/week-11-schedule-change--jaguars-giants-to-4-25-p-m--et--steeler) confirms SportsGameOdds' updated times; nflverse still carries the original times. Original forecasts are preserved and quality flags record the conflict.

The collector stores immutable model manifests, source documents, separate actual retrieval receipts, pregame inputs and final-result revisions. NBA uses the existing frozen independent winner baseline. NFL uses the pinned independent 2023-trained research baseline from the historical audit. Prices have zero influence on these probabilities. Capture windows are EARLY, 90–30 minutes, and 30–5 minutes before kickoff, and each cohort is reported separately.

Confirmed pregame starter/active-roster collection is still missing. Injury PDFs and expected depth-chart starters cannot satisfy that requirement. All new forecasts remain baseline-only, full-feature ineligible and production-ineligible. No PLAYs are authorized by this release. Future outcomes can only be collected after the games finish; provider-reported finals are labeled as such and require exact saved identity matches.

## Price checks and validation

Suspended opposite quotes are now retained for diagnosis while remaining ineligible. Missing or unavailable prices cannot be filled from another book, line, timestamp, or market. After promotion, the 16:59:20 UTC collector reported 350/357 ready pairs: five blocked opposites are explicitly unavailable and two are absent. This is quote readiness, not PLAY approval.

The first hosted winner append exceeded its original five-second client budget but committed successfully. A safe repeat returned HTTP 200 and zero duplicate captures. Phase-specific budgets were repaired, and the next staged refresh returned HTTP 200 with 28 candidates and the two explicit schedule conflicts. Final deployment and scheduler observations are recorded below after release verification.

Validation completed before release: 402 Node tests, 78 Python tests, fourteen hosted SQL guard groups, source/secret inventory checks, and mobile book-comparison browser checks. No frozen live coefficient, threshold, approval policy or settlement weight changed.

## Production release

Production was promoted to `dpl_8hwrxKuqPoVQYzvoHYvm5Xj4xERW` (`sports-analytics-prediction-system-6ihx-9vu2zfkio.vercel.app`). The canonical dashboard, winner status and NBA props endpoint return HTTP 200; unauthorized winner POST returns 401. The final staged authenticated refresh returned 200 with zero duplicate captures. The ten-minute winner research job is enabled at minutes 03, 13, 23, 33, 43 and 53. All live models remain frozen; winner research production weight is zero.
