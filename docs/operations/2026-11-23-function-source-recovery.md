# Production function source recovery — 2026-11-23

## Result

Recovered the exact source bundles of 67 deployed functions: **195 files,
2,610,951 UTF-8 bytes**. The separately reviewed ML export fix was deployed as
version 11 and fetched back byte-for-byte. The repository now represents all
**68 active production function identities**, including the 13 previously
missing functions.

The capture metadata matched a fresh production inventory for every recovered
bundle: version, status, gateway JWT setting, and deployed bundle SHA-256.
Recovery verification completed at `2026-11-23T18:25:23.179571+00:00`. The
manifest preserves the original September recovery baseline and its historical
authority observation. Its current source-match status is explicitly separate
from behavior approval and schema/security/cron parity.

## Why each bundle has its own directory

All returned names and relative import layouts are preserved under
`supabase/deployed-snapshots/<slug>/v<version>/`. No existing application source
was overwritten during recovery. The production collector bundle contains an
older `sharp-service/research-data.js`; copying it into the application would
remove more recent reviewed fixes. The dashboard and performance functions
also ship **different bytes** under the same helper name,
`functions/_shared/historical-results-read.mjs`. A single shared working file
could not represent both deployments honestly.

The manifest maps every observed file name to its exact snapshot and SHA-256.
The two `LOCAL_SOURCE` entries retain their canonical code separately from
their deployed observations. Historical absolute entrypoint paths sometimes
contain old build prefixes; each recovered entrypoint was resolved to a unique
actual returned file. No path traversal, absolute returned name, duplicate
returned name, or unresolved entrypoint was accepted.

## Scope of source differences

Among the 67 captured bundles, 54 were previously represented and 13 were
missing. Of the represented functions, 53 metadata records differed and one
was unchanged. Comparing returned file names with their candidate working-tree
locations found 53 different file entries, 12 identical entries, and 130 absent
entries. These are source-file comparisons, not 195 independent behavior
approvals.

Of the 53 represented metadata differences, 43 were the common server-side
credential-helper import and environment lookup replacement; one had already
identical working source with stale metadata; nine had further behavior
changes. All 55 captured credential-helper copies have the same hash. Literal
credential scanning found no embedded Supabase secret, JWT, GitHub/AWS token,
private key, or credential-bearing URL.

The 12 frozen collector JSON assets were inspected separately. They contain
statistical models/protocols, public-source box scores and identity mappings,
and corrections. No user account, private recommendation, wager, ticket,
stake, or payout payload was copied. An existing history-evidence asset is
byte-identical to source already tracked in the repository. Raw tool transport
captures and private journal evidence remain outside the public repository.

## Newly represented functions

- `audit-nba-boxscores`
- `capture-nba-player-props`
- `capture-nfl-player-props`
- `collect-nba-props`
- `collect-nfl-prices`
- `grade-nba-player-props`
- `nba-player-prop-calibration`
- `nba-player-prop-feedback-status`
- `prediction-performance`
- `probe-nba-backup`
- `refresh-nba-player-prop-clv`
- `service-auth-health`
- `track-nba-research`

## Integrity-check repair

The old reconstruction validator checked only top-level `path` and `sha256`
fields. Function source hashes were nested in `files`, so modified or missing
function files could pass validation. The repaired validator checks typed,
nonempty file lists and every current/deployed file hash, rejects out-of-tree
paths, and verifies unique function identities against the union of canonical
source and snapshot directories. Corruption regressions cover wrong hashes,
missing files, malformed entries, path escapes, and mismatched identities.

The smoke check also contained an obsolete hard-coded count of 49 functions.
It now uses full repository validation plus a nonempty manifest requirement.
Repository inventory tests independently require the observed 68 identities,
including 66 active-source entries and the two separately preserved local
sources. The secret scan remains enabled.

Publication checks also found that Git's general LF normalization would change
12 recovered function files and eight recovered SQL files containing CRLF
bytes. Targeted `-text` attributes now preserve hash-pinned Supabase source
bytes. The staged Git blobs, as well as working files, are checked against
their recorded hashes before publication. Existing migration entries with no
recorded source digest are not described as verified production-source matches.

## ML export fix and deployed verification

The credential selector now accepts a modern `default` only when it is a
nonblank string, trims it, and preserves the existing override → modern →
legacy order. Numbers, arrays, objects, and booleans cannot be coerced into a
backend credential. No caller token is forwarded as a backend key. Modern
credentials use `apikey`; server JWTs retain the existing `apikey` plus Bearer
behavior. The GitHub issuer, audience, repository, master ref, exact workflow,
and allowed-event gates remain unchanged.

Nine focused tests exercise the actual handler, including malformed defaults,
outgoing headers, and authorization failures. Four new cases failed before
the selector fix. Production version 11 is ACTIVE with its existing
`verify_jwt=false` setting because the handler performs its own GitHub OIDC
verification. The deployed bundle digest is
`dfb89811d246cc6053232e54ba1cf2050940fb86a004bc3d1221cbc3f315bb7f`.
Both downloaded source files exactly match the tested local bytes.

The ML workflow now also runs on master changes to the exporter directory,
so changes to its authentication/export contract trigger the real OIDC
integration path. No workflow permission or accepted caller was expanded.

## Limits

Observed source parity does not approve historical behavior, replay old
migrations, enable a collector, alter a schedule, or promote a model. Recovery
alone changes no production function. The ML selector repair is a separate,
tested deployment described above. Further reviewed function repairs must
record their own deployed versions and exact fetched-back sources.

Full schema/security/cron baselines were not replaced. The scheduled drift
workflow still requires its separately configured management/database secrets;
source recovery cannot supply or infer those credentials. The versioned
snapshots are historical evidence, not automatic deployment inputs.
