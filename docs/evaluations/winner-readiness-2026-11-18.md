# Winner evidence tracking repair

The collector previously truncated the combined NBA/NFL quote array before filtering for a game. More than 100 cross-sport book rows could hide a valid game's paired prices. The bound now applies to matching game rows. This was reproduced in a regression test; it is not proof that the defect caused every historical missing-price row.

The first forecast per event/model/window remains immutable. Subsequent collection checks now append to `winner_readiness_observations`, with their own observation and database-recording timestamps. The original forecast cohorts retain their original evidence and scores. Later readiness cannot repair a historical forecast's eligibility. Retries cannot refresh an old observation or duplicate it by crossing a capture-window boundary.

Lineup diagnostics now distinguish expected starters, missing/duplicate official game data, provider errors, NBA games outside the lineup window, and NFL games outside the three-hour inactive-report window. Corrected NFL schedule identities are applied before these diagnostics are finalized. An injury report or inactive list never certifies starters or complete participation.

## Hosted verification

Applied migration `winner_readiness_observations`, production version `20261118185332`. Seven synthetic SQL rollback checks passed on the hosted database, including immutable forecasts, stale/future observations, private access, quarantine and schedule guards. All synthetic data rolled back. The original 46 forecasts retain digest `846e499136493b3481c89b6e522435d7`.

Frozen model manifests are unchanged:

- NBA: `e64b9841f72c9f00a51e8a015a88d60c93d05fcb19b45065c20bb85c2a894df6`
- NFL: `a8997909da1c5a1cf71c4cd4a463f2807020d830ba772a4869a2307d67765685`

Staged production deployment `dpl_Cv8huXQJdwba1zTAZHW8x9Pjmd2T` built successfully. Status GET returned 200 in 231–768ms; unauthenticated collection returned 401. Authenticated request913 returned 200 without a timeout at 18:58:17 UTC (12:58PM Central): 29 readiness observations, zero rewritten/new first-window forecasts, five appended final-result observations, zero outcome conflicts. Those five are refreshed outcome evidence, not five newly completed games.

The collection observed 72 valid paired book quotes for all 12 NBA games on November18 and 78 pairs for all 13 upcoming NFL games. Four NBA games on November19 were absent from the provider response; their status is `QUOTE_EVENT_NOT_RETURNED`. Official NBA starters remained expected for all12 current games; the four later games were outside the lineup window, and all13 NFL games were outside the inactive-report window. None was marked lineup-verified or approved to PLAY.

Supabase's security scan returned only the existing INFO class for RLS tables with no client policies. The new table deliberately grants only service-role SELECT/INSERT; anonymous/authenticated reads and writes are denied, and update/delete are forbidden.

Local verification: all 489 Node tests (including 24 new validation-policy tests), 78 Python tests, 21 SQL rollback groups, reconstruction/secret checks, and desktop/mobile sharp-book and team-scoring browser checks passed. Independent reviews covered the database guards and offline validation protocol. No model coefficients, production weights, automatic wagers or approval gates changed.

## Release completion

Tracking commit `ac65671785e232f7913a87a5be746090f3a33c4f` passed GitHub CI run44375464433, including Linux API, Python and browser tests. Its tree exactly matches the tested staged build. Production deployment `dpl_Cv8huXQJdwba1zTAZHW8x9Pjmd2T` was promoted to the canonical Edge Lab domain. The canonical readiness API returned200 in530ms at19:00:57UTC with29 observations, `RESEARCH_NOT_CLEARED`, and zero production weight. The existing ten-minute hosted collection schedule remains active.

The separately reviewed [winner/spread confirmation protocol](../validation/prospective-winner-spread-2026-11-18.md) defines future NBA/NFL cohorts and an offline fail-closed evaluator. Its default is `NOT_STARTED`: no prospective confirmation registry or new candidate is invented by publishing criteria. Existing archives remain development evidence. The next prerequisite is a retained preregistration followed by verified future lineups, exact paired quotes and final outcomes. Spread approval additionally requires an independently tested exact-line cover distribution; winner probabilities cannot substitute for it.
