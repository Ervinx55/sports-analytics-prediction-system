# Verified explanation gap repair

User requested filling remaining defensive matchup, defense-versus-position and usage gaps, keeping both models frozen.

Audit: 152 accepted history records; 55 include archived BALLDONTLIE evidence. The reader omitted 70 provider-native player records despite the accepted backup contract retaining exact bdl:<numeric ID> identities. It also rejected valid SG labels and some exactly one-second differences because of floating-point subtraction. Eleven shared-stat conflicts had accepted bilateral NBA adjudication records which the explanation reader had not replayed.

Changes remain presentation-only. Resolve native IDs only in accepted backup summaries, using exact numeric IDs and same-side, same-team crosswalk anchors; reject duplicate identities. Preserve the one-second tolerance using integer seconds and reject fractional-second source anomalies. Recognize PG/SG/SF/PF as exact labels, without guessing broad position equivalence. Replay recorded official corrections only with matching game, date, player, team, source metadata and original field values. Raw archives and saved predictions are never mutated.

Quote evidence can bind to exact SportsGameOdds event/player/team IDs even without a forecast row. Disagreement with a saved forecast mapping fails unavailable. No model probability, approval, price validity or collector changes.

Paired audit using the same 77 current player/event targets: opponent efficiency 77 -> 77; defense versus position 4 -> 46; historical usage 16 -> 50. Remaining DvP targets have 0–2 fully verified matching-position games (seven lack a verified historical position); remaining usage targets have 0–2 complete verified same-team games. The accepted archive lacks a matched BDL backup for 97 games. These gaps cannot be filled by guessing positions, excluding conflicting teammates or lowering the three-game requirement.

Validation: regression tests demonstrate old failures for native identities, exact-second rounding, SG recognition, ignored official corrections and quote-only bindings. Full suite: 184 Node tests, 78 Python tests. Browser and hosted checks required before release. Model, forecast, approval and collector source remains unchanged.
