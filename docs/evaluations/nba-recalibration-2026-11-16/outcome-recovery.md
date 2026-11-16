# Outcome recovery audit — November 16, 2026

The audit found 111 selected, past-start player-market forecasts without outcomes across 41 player-games and seven provider events. These are missing outcomes, not losses, automatic unders, or proof of final status. The frozen forecasts remain immutable.

## Verified causes and boundaries

- The four current history quarantines report `PLAYER_STATS_CONFLICT_steals`, `PLAYER_MAPPING_UNVERIFIED` (two games), and `TEAM_TOTAL_CONFLICT_rebounds`. Fifty-eight selected missing observations belong to the two newly quarantined Cleveland/Dallas and Miami/Detroit games.
- Older cached verified summaries exist for Miami/Cleveland, Oklahoma City/Clippers, and Memphis/Brooklyn, but omit the exact players still missing outcomes. No safe positive-minute outcome can be reconstructed for those players from those summaries. Absence from a boxscore is not sufficient inactive evidence.
- The official inactive evidence endpoint returns 503 for several requests. Root investigation found an official schedule orientation mismatch in November 15 Boston/Dallas and Sacramento/Oklahoma City requests. The hosted collector reads `teams.home` and `teams.away` directly from SportsGameOdds without swapping them; this is not a reason to reverse a fixture or settle it silently. Official game identity remains required.
- Replaying the hosted collector exposed a separate, reproducible fairness bug: when all events fit within the eight-event batch, the priority cursor does not advance. Settlement then iterates the database's row order rather than requested event priority. With one fresh BALLDONTLIE date allowed per run, an older conflicting date can consume the request budget before a newer date is attempted.

## Bounded collector fix

`scripts/nba/patch-hosted-outcome-fairness.mjs` accepts only the audited version-42 source hash and produces a deployment bundle. It rotates the first event even when fewer than eight events fit, processes pending rows in that order, and exposes sanitized per-event backup failure codes. It preserves the one-request backup budget, eight-event limit, gateway JWT verification, source reconciliation, frozen artifacts, validation protocols, and every other deployed file. It does not produce or fabricate an outcome itself.

The exported collector's source SHA-256 is `bc0b2161c675d167153a95a0734039b20019b0bb10e29bad2b56a0c376f75b90`; the patched source is `59051a74c33ccbd983b6bc925c1fad5165043de10296875eb8bdd8dbbd92eb56`. The original source is retained as a test fixture. Any different deployed source requires a fresh review instead of blindly applying the patch.

Four tests pass: rotation for small queues, the eight-event cap and complete coverage for a larger queue, a two-date conflict/budget replay that previously starved the second game, and immutable bundle/version/source/auth guards. The small-queue rotation test was first run against the original collector and failed as expected. The test replay deliberately reverses provider response order to prove request priority controls recovery.

No production database write, function deployment, model fit, model promotion, or direct outcome repair was performed by this audit task. A live recovery count must be verified after a reviewed deployment and subsequent collection. Unverified identity or statistic conflicts remain unresolved until authoritative evidence agrees.
