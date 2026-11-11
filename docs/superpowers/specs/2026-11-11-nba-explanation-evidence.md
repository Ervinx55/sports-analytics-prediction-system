# NBA explanation evidence — approved scope

User requested verified defensive matchup, defense versus position and usage in existing deep dives with both models frozen. Use the existing reconciled SportsGameOdds/BALLDONTLIE archive only; no new provider subscriptions or model inputs.

Read-only service-role RPC returns a bounded snapshot of accepted history and exact current event/player/team bindings. Match archived BALLDONTLIE box scores by recorded source hash, game ID and reconciled player crosswalk; no name guessing. Cache evidence server-side for five minutes, bounded timeout, fail open for existing quotes/decisions while explanation data fails unavailable. Explanations never mutate stored predictions or approve plays.

Display opponent points allowed per 100 estimated possessions, per-player-game allowance against the archived listed position (not assignments), and historical box-score usage with sample/window/source/cutoff. Require at least three eligible games; exclude target/future/unknown-time/conflicting history. Usage needs complete reconciled team totals. Historical profile positions are contextual labels, not confirmed game-specific roles. No league rank.

Add context to live decision response and existing NBA quote response, using one cached bulk evidence read rather than per-card fetches. Pure tests cover exact identity, missing/revised stats, insufficient samples, time cutoffs, unit calculations, no mutation, failures and frozen status preservation. Stage, browser-check actual coverage, CI, merge and release.
