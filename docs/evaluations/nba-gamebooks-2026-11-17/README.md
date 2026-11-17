# Reviewed NBA source corrections — November 17, 2026

`corrections.json` contains exactly two source repairs, independently reviewed against fresh NBA final scorer reports and NBA.com box scores. SGO evidence was retrieved through the authenticated read-only audit endpoint at 2026-11-17T16:43:47Z. The regression fixture retains each SGO response receipt and original cached BDL receipt. Each correction binds the exact primary fingerprint, canonical backup fingerprint, game, team, and before/after fields.

- DAL at CLE, NBA 0022600232: Dallas team rebounds 40→39, FGA 94→93, offensive rebounds 14→13; P.J. Washington rebounds 4→3, FGA 10→9, offensive rebounds 2→1, with four corresponding derived fields.
- WAS at ORL, NBA 0022600162: Anthony Davis steals 3→4 and Bilal Coulibaly steals 2→1, with each blocks+steals field adjusted. Team totals remain unchanged.

The official URLs, actual receipt times, and raw SHA-256 hashes are stored in each record. This artifact has SHA-256 `a6d4604280fb594c67884db0fa437bb9b335ec1f549864a15d955bfefc15763e`.

`scripts/nba/patch-hosted-gamebook-corrections.mjs` accepts only the exact hosted v45 bundle and original manifest fingerprint, then appends these records to the existing independent gamebook revision manifest. All other hosted files and both prior correction entries remain unchanged. The frozen model, aliases, source acquisition policy, settlement rules, and production weight are unchanged.

Run `node --test tests/node/nba-gamebook-corrections.test.mjs`. The actual v45 baseline fails on the two documented rebound/steal conflicts; the patched fixture accepts both, preserves original inputs and retrieval times, and rejects changed primary/backup/artifact inputs.

The unresolved Brooklyn identity fields, Miami extraneous participant, and recent Boston–Dallas age boundary are outside this correction artifact.
