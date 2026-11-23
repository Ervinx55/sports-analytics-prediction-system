# Service writer authorization repair — 2026-11-23

## Change and scope

Four recovered player-prop write handlers now explicitly require the incoming
JWT role to be the string `service_role` before reading a body, contacting a
provider, reading server credentials, or creating a database client. The
existing gateway signature/expiry verification remains enabled for every
function. A valid user or anonymous JWT does not establish permission to use
the backend's service credential.

The helper is a role-authorization check after the gateway, not a standalone
JWT signature verifier. **Keep `verify_jwt=true`.** Requests with missing or
invalid authorization receive 401 with `cache-control: no-store`; rejected
credentials are not returned in the response. The original non-POST 405
behavior and every business-code body/dependency are preserved.

## Reviewed deployments

| Function | Previous version | Verified repaired version | Gateway JWT verification |
| --- | ---: | ---: | --- |
| `capture-nba-player-props` | 7 | 8 | true |
| `capture-nfl-player-props` | 6 | 7 | true |
| `grade-nba-player-props` | 7 | 8 | true |
| `refresh-nba-player-prop-clv` | 7 | 8 | true |

All four repairs were independently reviewed, deployed, and downloaded again.
Every returned source file matches the reviewed local bytes exactly. The
current deployment versions, bundle digests, per-file hashes, and original
snapshot records are recorded in the edge-function manifest.

All copies of the authorization helper have SHA-256
`5767d307ed0ba93c53f611dd5ecf4b7a29b63016dc348dd245eda5044bcf4ca8`.
Original service-key and domain dependencies remain byte-identical to their
captured deployments. Existing server-key overrides are independent of the
incoming caller identity.

## Caller compatibility

At review time all four component-registry entries were disabled. There were
no matching active direct/registry cron jobs and no recorded component HTTP
requests. This deployment did not enable them, create a schedule, replace a
credential, force a provider request, or import data. The dormant generic
dispatcher must receive its own caller-credential review before any future
activation; these guards do not make it ready to run.

Other scheduled writers are a separate caller-and-handler migration. No claim
that every privileged writer is secured is made by this scoped repair. Their
existing schedules were not altered here.

## Verification

The 17 focused authorization regressions execute each actual handler's
authorization prefix and check whether protected work becomes reachable.
Nine cases failed against the original source. All pass with the repair.

Coverage includes signed anonymous/authenticated fixture JWTs, a valid
service-role fixture, malformed headers/payloads, nonstring/coerced roles,
incorrect role casing/whitespace, and an `apikey` value that cannot override
the Authorization decision. Source comparison verifies that removing only
the added import and guard restores each exact original business body.

```sh
node --test tests/node/player-prop-service-auth.test.mjs
```

The source validator also checks the retained `previousDeployment.files`
against the original function slug/version snapshot and SHA-256. Its canonical
source exception cannot be used to substitute current code for an archive.
Seventeen archive-corruption cases failed before that extension and pass now.
No production mutation probe was used for verification.
