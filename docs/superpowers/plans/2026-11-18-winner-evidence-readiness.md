# Winner evidence tracking and validation

NBA and NFL live models, weights, probabilities, and approval gates remain frozen. This change records evidence and establishes a separate research review protocol; it cannot authorize a PLAY.

1. Diagnose missing lineup and paired-price counts against hosted immutable captures and source receipts.
2. Preserve first-in-window forecasts. Append subsequent pregame readiness observations separately, with the same server-clock, source, identity, schedule-quarantine and model provenance guards. Never backfill later evidence into an original forecast.
3. Report event-level lineup reasons and exact paired-price reasons. Distinguish expected starters, game-day timing, missing sources, stale prices and valid current pairs.
4. Define machine-checkable prospective winner/spread validation criteria: separate sport/market cohorts, independent games, registered model/feature/selection manifests, chronological untouched holdout, paired baseline and market comparisons, calibration and uncertainty. Spread validation requires cover probabilities for the exact line and push handling.
5. Verify regression tests, SQL rollback guards, full Node/Python suites, source secret/reconstruction checks and frozen manifest hashes. Review the diff independently.
6. Release only the verified evidence-tracking change, smoke-test hosted status/collection and preserve an audit report. Missing future lineups/outcomes remain explicit blockers.

## Diagnosis

At 18:43 UTC November 18, the first NBA EARLY captures had only 5 paired-price rows among 21 games, while each later historical capture window had 5/5. The collector checks updated sources every ten minutes, but INSERT ON CONFLICT preserves the first forecast and discards later normalized readiness. This is correct forecast immutability but incomplete readiness tracking. Official NBA sources currently show 12 expected and zero confirmed starting lineups; 13 NFL games are outside the three-hour inactive-report window. Neither condition is proof of missing confirmed data.

Original baseline: 46 forecast rows, hosted content digest 846e499136493b3481c89b6e522435d7. NBA manifest e64b9841f72c9f00a51e8a015a88d60c93d05fcb19b45065c20bb85c2a894df6; NFL manifest a8997909da1c5a1cf71c4cd4a463f2807020d830ba772a4869a2307d67765685.
