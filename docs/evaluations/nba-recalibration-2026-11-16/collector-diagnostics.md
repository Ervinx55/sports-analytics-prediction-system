# NBA settlement diagnostics — November 16, 2026

The collector previously erased valid source errors such as `TEAM_TOTAL_CONFLICT_rebounds` because its sanitizer allowed only uppercase characters. It also reported no failure when a verified boxscore omitted the exact pending player. The diagnostic patch preserves a bounded list of statistic suffixes and counts unresolved rows by event and reason. It does not infer inactivity from an absent row or change settlement rules.

`scripts/nba/patch-hosted-outcome-diagnostics.mjs` requires exported version 43 and source SHA-256 `59051a74c33ccbd983b6bc925c1fad5165043de10296875eb8bdd8dbbd92eb56`. It changes only `scripts/local/sgo-nba-collector.mjs`, producing SHA-256 `7c39c1f077b3f45569f81e0114e1d7fd2b8cb41ef8602ffe490624a81a4cba46`. All other 41 bundle files, including the frozen models, protocols, authentication and reconciliation rules, remain byte-identical.

Supabase project `yeoxroijaptomomshdii` runs collector version 44 with gateway JWT verification enabled. Its deployed bundle hash is `7deeed9b8a4dc67331636607a3dffadb27600e6d91dd486dbf7a2eea745721a2`.

The scheduled run completed at 16:51:16 UTC and persisted 108 quote-level outcomes. Of the original 111 selected missing player-markets, 33 Dallas–Boston observations were recovered automatically and independently checked against official HTML, official final gamebook and current provider statistics. Repeated quotes are not additional independent games. The run exposed bounded `BDL_COOLDOWN` and `VERIFIED_POSITIVE_MINUTE_PLAYER_MISSING` counts instead of an empty diagnostic.

The fairness fix from version 43 rotates the backup request priority. Version 44 adds reporting only; the 108 outcomes are ordinary collector settlements, not outcomes fabricated by the diagnostic change.

Four diagnostic regression tests and four prior fairness tests pass. The whole Node suite, including the bounded source-audit helper, passed 324 tests before recovery-import work. Review and import evidence is recorded separately; this deployment does not approve a model or authorize a PLAY.
