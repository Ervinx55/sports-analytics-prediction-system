# Reviewed CFB matchup evidence — November 14, 2026

These corrections affect identity reconciliation and research visibility only. The CFB model/configuration, historical holdout, original prospective captures, NBA and NFL remain frozen. No correction authorizes PLAY.

## App State at Marshall

SportsGameOdds event `PR29AtWAUYhuiYBmURmf` identifies `APPALACHIAN_STATE_NCAAF` away at `MARSHALL_NCAAF`, November 14 at 23:00 UTC. ESPN event `401869928` identifies team `2026` (App State) at `276` (Marshall) at the same time. Both current ESPN team schedules agree; the [university's official schedule](https://appstatesports.com/sports/football/schedule/2026) lists the visit at 6 p.m. Eastern. That page identifies its publisher as Appalachian State University Athletics.

The reviewed alias is restricted to season 2026, the exact App State provider IDs and known names. Opponent, orientation, unique-event and kickoff checks still apply. No fuzzy or abbreviation-only match is added.

## North Dakota State at Hawai‘i

SportsGameOdds event `BKBP22DuBmOzmKmFX6FO` currently lists November 15 at **03:00 UTC**. ESPN event `401864537`, in both teams' current schedules, lists **04:00 UTC**. Provider teams are `NORTH_DAKOTA_STATE_NCAAF` away at `HAWAII_NCAAF`; ESPN teams are `2449` away at `62`.

The [Hawai‘i official schedule](https://hawaiiathletics.com/sports/football/schedule/2026) lists November 14 at 6 p.m. HST (04:00 UTC on November 15). [NDSU's November 10 preview](https://gobison.com/news/2026/11/10/football-bison-travel-to-hawaii-for-saturday-night-matchup-on-the-cw) specifies a 6:10 p.m. HST kickoff, within the existing 15-minute schedule tolerance of ESPN's scheduled window. Both contradict the provider's 03:00 UTC value. Use the earlier verified scheduled time for the conservative capture cutoff.

The exception requires this exact event, season, all four team IDs, the observed provider time and the verified ESPN time. Any other mismatch remains unverified. Source records and the provider time are preserved; no upstream record is overwritten. Research tracking uses 04:00 UTC, but the conflicting provider's entry prices are withheld and no model probability attaches to those quotes. If a subsequent provider observation agrees exactly with ESPN, normal comparison checks may apply; earlier immutable price exclusions remain unchanged.

All verified fresh forecasts can appear in the CFB game summary even when the bounded book refresh has no matching quote. The summary states when price comparison is unavailable. Invalid, duplicate, expired and wrong-version forecasts remain hidden.

Evidence read November 14 around 16:46 UTC. A local replay of the frozen model yields a forecast for both games without changing any parameters. Production capture and release evidence is recorded in the task's `outputs/cfb-verified-matchups-2026-11-14` report. At investigation time no prospective game had finished; ongoing ten-minute collection remains responsible for final outcomes.
