# Official NBA explanation corrections — 2026-11-11

37 of the 39 outstanding games were independently reconciled with final NBA.com box scores and published to `nba_explanation_backfills_v1`. The table now contains 95 explanation overlays (58 prior + 37 new). Inserts required the exact currently accepted summary ID and did not overwrite existing rows.

## Scope and frozen models

This is presentation evidence only. Both models, forecast inputs, saved forecasts, calibration cohorts, approval thresholds, model influence, and collector schedules remain unchanged. These corrections do **not** complete forecast validation or authorize a PLAY. Original provider records were retained; the explanation layer applies explicit field corrections to copies. No application deployment was required.

## Verification

- Retrieved official final box scores for all 39 games and fresh SportsGameOdds responses for all 39. Used the latest archived BALLDONTLIE packet for each date.
- Bound games by unique teams, scheduled time, final scores, period, and official game ID. Required complete player minutes and point totals, valid stat identities, unique player mappings, and the unchanged strict provider reconciler.
- Verified official HTML SHA-256 and equality of extracted `__NEXT_DATA__` with the saved official JSON. NBA profile `DISPLAY_FIRST_LAST` and `PLAYERCODE` fields establish the David Jones Garcia / David Jones, Nic / Nicolas Claxton, and Alex / Alexandre Sarr aliases. Exact official IDs, team, and game constrain their use.
- Independently checked per-game manifest digests and replayed 83 BALLDONTLIE field corrections against original before-values and official after-values. Original BALLDONTLIE records remain stored unchanged. Official, profile, and backup retrieval times precede the overlay observation time.
- A separate reviewer checked raw-record preservation, official source binding, mapping uniqueness, participation boundaries, and the six additional profile-alias resolutions. No material blocker remained for the accepted 37.
- All 187 Node tests passed. Hosted dashboard returned HTTP 200: 500 rows with defense, 440 with defense-versus-position, and 500 with usage. Props returned HTTP 200: 265 rows with defense, 243 with defense-versus-position, and 255 with usage. These are market rows, not unique players. All contexts retain production weight zero and eligibility false. Expanded deep dives rendered successfully at desktop and 390px mobile widths, without page errors or horizontal overflow.
- The first props check returned HTTP 200 with null contexts and failed its evidence assertion. A subsequent read after the short failure-cache interval returned context and passed browser verification. This intermittent availability remains a monitoring concern; the successful repeat does not prove all timeout risk is eliminated.

## Fixed audit cohort (77 players)

| Evidence | Before | After |
|---|---:|---:|
| Opponent defensive rating | 77 | 77 |
| Defense versus exact listed position | 67 | 69 |
| Historical usage | 73 | 77 |

Eight position cohorts still have fewer than three qualifying games: Jalen Smith (1), Norman Powell (0), Jaylon Tyson (2), Alperen Sengun (2), Luka Doncic (2), Matisse Thybulle (2), Ziaire Williams (2), Devin Vassell (2). No broad position inference or reduced sample minimum was introduced. This is historical usage, not projected usage or confirmed minutes.

## Two unresolved source conflicts

1. `W9lJjjTktenUmQ1ww9T3` / NBA `0022600205`: SportsGameOdds reports positive minutes for `MASON_JONES_1_NBA` on Detroit. Both official and backup rosters lack that player. Matching his stat line to Isaac Jones would be an unsupported identity substitution; excluded.
2. `I03UQDCFJhTCzrAvdEVA` / NBA `0022600208`: official Fred VanVleet minutes are `29:60`; BALLDONTLIE reports `30:00`. The official value fails strict clock validation. No guessed normalization was accepted; excluded pending a valid independent official record.

## Artifacts

- `audit.json`: fixed-cohort before/after counts and exclusions.
- `corrections.json`: exact accepted basis IDs and per-game source/correction manifests.
- `official-boxscores.json`: extracted factual official box-score records; source URL, retrieval time, and full-source SHA-256.
- `profile-aliases.json`: official identity facts establishing the three aliases.

Full source HTML, original provider packets, dry-run scripts, replay validation, and ready overlays are retained in the task workspace under `work/conflict-*`, `work/backfill-*`, `work/audit-official-conflicts.mjs`, and `work/verify-official-overlays.mjs`. Full HTML containing unrelated site content is intentionally not committed.
