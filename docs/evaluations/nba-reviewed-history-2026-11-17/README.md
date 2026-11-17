# Three reviewed NBA history records

The artifact pins the complete SGO evidence projection (eventID, status, teams, all player profiles, all results, info, type and leagueID) and the complete canonical BDL game. Live odds and transport metadata are outside this historical-result fingerprint. Each record retains source receipts and official raw-file SHA-256 hashes. The upstream raw responses remain unchanged.

Every timestamped supporting receipt is validated against its allowed source path, SHA-256 shape and the evaluation clock. `evidenceObservedAt` includes the SGO audit receipt, official box score/gamebook, player-profile and UNLV identity receipts, and the other game's positive participation proof. The resulting summary cannot predate any evidence used by a repair. Earlier reviewed alias URLs without a receipt remain provenance only.

## Identity repairs and quarantine

- BKN at NOP (0022600223): fill the exact missing Drake Powell name/firstName fields. The existing native SGO D_POWELL identity had already been reviewed for Brooklyn on November 8. The official current game identifies NBA 1642962 as Drake Powell, abbreviated D. Powell. Every supplied result must still match the official game and BDL.
- DET at MIA (0022600233): replace EJ Harkless with the documented full name Elijah Harkless. His official UNLV biography uses both names, and the NBA profile/game identifies player 1641989. Quarantine the exact extraneous Jeremiah Fears profile and result from the cloned input; retain both original objects and their hashes in summary evidence. Official same-night NOP-DEN game 0022600231 positively identifies Fears playing for New Orleans while the complete MIA-DET official and BDL rosters exclude him. This produces neither a DNP nor a zero result. Existing settlement returns unresolved when that quarantined participant is absent.

## Independent recent-final proof

DAL at BOS (0022600240) uses a fixed, reviewed NBA final-game attestation only while both official receipts are at most six hours old, after game start, and not in the future. It requires exact current SGO and cached BDL fingerprints plus the complete official game. The original BDL receipt remains November 16, 16:51:07.955 UTC; NBA receipts are November 17 around 17:34:52 UTC. Acquisition errors such as BDL_HTTP_401 remain recorded. Once the game reaches the pre-existing 48-hour boundary, the ordinary strictly reconciled cached-final policy applies independently of this temporary attestation.

Every official played participant must map uniquely to BDL, and every positive-minute SGO participant must map uniquely to the official/BDL roster. All 16 statistics plus exact seconds are checked per available player, and all shared team totals must agree. Coverage is explicit:

| Game | Official/BDL played players | SGO played players | Official/BDL comparisons | SGO comparisons | SGO omission |
| --- | ---: | ---: | ---: | ---: | --- |
| BKN-NOP | 25 | 24 | 425 | 408 | Chaney Johnson |
| DET-MIA after quarantine | 25 | 25 | 425 | 425 | None |
| DAL-BOS | 26 | 25 | 442 | 425 | Morez Johnson Jr. |

Absent SGO profiles/results retain existing BDL-native identities; no SGO mapping is invented. Each team sums to 14,400 seconds except Detroit, whose individually matching official/BDL rows sum to 14,401 seconds. That one-second discrepancy uses the existing reconciler's five-second aggregate rounding bound and is exposed in `coverage.teamMinutes`; individual player seconds remain exact.

`patch-hosted-reviewed-history.mjs` pins hosted v46, the prior BDL module, this artifact, and the new helper. It changes only `scripts/local/bdl-live.mjs` and adds the helper and artifact. Existing aliases, four gamebook corrections, model files, settlement rules and production weights remain unchanged. Root composes this with the separately reviewed queue-worker repair before deployment.

Validation: `node --test tests/node/nba-reviewed-history.test.mjs`. The v46 baseline fails all three exact cases. Eleven patched tests cover successful recovery, source/backup drift, future/expired official evidence, packet provenance, unreviewed recent games, real BDL 401, authoritative fresh BDL responses, bundle preservation, and receipt-aware replay timestamps. The replay and future-identity-receipt regressions both failed before the timestamp fix.
