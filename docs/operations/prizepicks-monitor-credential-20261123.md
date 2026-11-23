# PrizePicks diagnostic credential isolation — 2026-11-23

## Status and reason

This repair is prepared from `88aa475655b578397caaf5233fc36adebfb3e958`.
Publication, production deployment, secret creation and authenticated production
verification are pending at the time of this report. Local tests use synthetic
credentials and replace only the outbound HTTP boundary; they do not access a
live provider.

The original deployed diagnostic returned HTTP 503
`MONITOR_AUTH_UNAVAILABLE` because it read the shared `SHARP_MONITOR_TOKEN`.
Adding that variable alone would have changed authentication for `/api/board`
and `/api/sharp` as well. Public game research, server-side market consumers and
the Supabase market-snapshot collector currently call the board without that
credential. An environment-only change would have made those requests return
401.

The diagnostic now reads **only `PRIZEPICKS_MONITOR_TOKEN`**. There is no legacy
fallback. `/api/board`, `/api/sharp`, their callers, provider protection and
prediction approval rules are unchanged. Do not add `SHARP_MONITOR_TOKEN` just
to enable this diagnostic, and do not put either credential in browser code or
URLs. If legacy board authentication is intentionally enabled elsewhere, its
existing configuration and callers remain a separate concern.

## Authentication contract

Endpoint: `GET /api/nbaprops?view=prizepicks`.

| Configuration/request | Result | Provider/cache behavior |
| --- | --- | --- |
| Dedicated variable absent or empty, even if a legacy shared token exists | 503 `MONITOR_AUTH_UNAVAILABLE`, with `requiredEnvironmentVariable: "PRIZEPICKS_MONITOR_TOKEN"` | No provider request or cache reuse |
| Dedicated variable exists; header missing, wrong, repeated/invalid, or credential supplied only through a query parameter | 401 with `error: "Unauthorized"` | No provider request or cache reuse |
| Single matching `x-monitor-token` header | Existing protected diagnostic path | Existing quotas, coalescing, cache and upstream-error handling apply |

Every response remains `Cache-Control: private, no-store`. The missing-config
response names the required environment variable, without exposing a secret
value. That field is absent from authorized and unauthorized responses once
the dedicated token is configured. A legacy board credential cannot authorize
the private diagnostic.

## Manual production setup

The [frontend release source](edge-lab-frontend-release.md) records the target:

| Setting | Value |
| --- | --- |
| Team | `ervinemanuel-4011s-projects` |
| Project | `sports-analytics-prediction-system-6ihx` |
| Project ID | `prj_Rwlfunz2wnlTfXEOkhfVPOCyIV5z` |
| Root directory | `sharp-service` |
| Production branch | `master` |
| Canonical domain | `sports-analytics-prediction-system-tau.vercel.app` |

1. Confirm that the production deployment being configured contains this
   dedicated-credential repair. Before adding a token, the application's 503
   response with `requiredEnvironmentVariable: "PRIZEPICKS_MONITOR_TOKEN"`
   distinguishes the repaired handler from the original shared-token handler.
2. Open this project's [Environment Variables page](https://vercel.com/ervinemanuel-4011s-projects/sports-analytics-prediction-system-6ihx/settings/environment-variables).
3. Add **`PRIZEPICKS_MONITOR_TOKEN`**, choose **Secret**, and select
   **Production only**. Enter a fresh high-entropy value generated privately and
   retain it in a password manager. This is an application credential, not a new
   SportsGameOdds API key. Do not paste it into chat or a URL.
4. Save. Do not create or change `SHARP_MONITOR_TOKEN` for this setup. Preview
   and Development do not need the production monitor secret.
5. Open **Deployments**, find the production deployment containing this repair,
   and choose **⋯ → Redeploy**. Confirm that the new deployment is **Ready** and
   serves the canonical production domain.
6. Verify the canonical URL below. An older immutable deployment URL retains
   its old code and environment and does not verify the new production setup.

Vercel's [environment-variable documentation](https://vercel.com/docs/environment-variables/managing-environment-variables)
states that changes apply only to new deployments. Its
[Config and Secret guidance](https://vercel.com/changelog/environment-variables-now-use-config-and-secret-types)
describes Secret values as unavailable for viewing or retrieval after saving;
retain the value before saving it. The
[redeployment instructions](https://vercel.com/docs/environment-variables/rotating-secrets)
describe the Deployments menu action used above.

## Verification and its limits

An unauthenticated GET to
`https://sports-analytics-prediction-system-tau.vercel.app/api/nbaprops?view=prizepicks`
should return HTTP 401 with this application response after configuration:

```json
{"error":"Unauthorized","productionEligible":false,"productionWeight":0}
```

It should also return `Cache-Control: private, no-store`. For a known deployment
containing this repair, that response establishes that a nonempty dedicated
token reached the handler and unauthenticated access is denied. It makes no
provider request. A generic Vercel login page or platform 401 is not equivalent
evidence.

This check does not establish that the retained secret matches, that an
authenticated request succeeds, that SportsGameOdds grants access, or that
quotes are available. Full live verification requires one authorized client
holding the secret to send a single `x-monitor-token` header and inspect the
sanitized status, coverage and provider-failure fields. Do not log or share the
header value.

HTTP 200 may still mean no quotes, partial coverage or degraded provider data.
The diagnostic supplies research observations; `productionEligible` remains
false and `productionWeight` remains zero. No prop play is cleared by enabling
the monitor.

## Local regression evidence

Before editing production code, the unmodified base passed
`node --test tests/node/*.test.mjs`: **669 tests, zero failures**.

The focused command was:

```sh
node --test tests/node/prizepicks-monitor-auth.test.mjs tests/node/prizepicks-diagnostic.test.mjs tests/node/nba-prop-readiness.test.mjs
```

With the new tests and old handler it reported **23 tests, 17 passing and six
failing**. The failures reproduced acceptance of the legacy token, rejection of
the dedicated token, and the missing configuration hint. The public board and
sharp compatibility tests passed before the repair as expected.

After the two-line handler change, the same focused command reported **23
tests, zero failures**. It exercises the real deployed route and real provider
protection, including cold requests, cache hits, concurrent coalescing,
malformed/repeated/query credentials, and distinct legacy/dedicated tokens.
Actual board and sharp handlers remain callable without credentials when only
the dedicated token is configured; their existing legacy protection still
rejects the dedicated token when separately enabled.

The full post-change command `node --test tests/node/*.test.mjs` passed **675
tests, zero failures**. `git diff --check` and
`python scripts/supabase/validate_reconstruction.py --check-secrets .` also
completed successfully. No production check, provider invocation, secret
creation or deployment was performed while preparing these local regression
results. Publication and authenticated live verification remain pending.
