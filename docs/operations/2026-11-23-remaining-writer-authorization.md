# Remaining writer authorization repair — 2026-11-23

## Result

Ten additional deployed write functions now require the signed `service_role` before body parsing, server-credential access, provider requests or database work. Each returned ACTIVE with `verify_jwt=true`; all 31 fetched-back source files exactly match the reviewed bytes. Their scheduled HTTP components remain disabled.

The patch adds only the approved role helper, its import and an early guard after the existing method check. A rejected POST returns generic JSON with status 401 and `Cache-Control: no-store`. Existing method responses, business bodies, credential selection and provider budgets remain unchanged from the captured live implementations. The helper depends on gateway signature/expiry verification and does not claim to verify JWTs locally.

## Actual deployments

| Function | Version | Reviewed index.ts SHA256 |
|---|---:|---|
| `capture-model-audit` | 12 → 13 | `496b03f63d7b3b8d888fd53ee3021f3cca82a5df9a224d1888ceb5593375da91` |
| `capture-player-props` | 8 → 9 | `ce1aacea69f0cda4b1b19b4708f5679731c572c8ba10888f66dc819500200fdd` |
| `capture-sharp-clv` | 6 → 7 | `d44cb6c26905b6eaa1ecf3a7b4362dd66dfc62ff07453e783593ba2758482363` |
| `evaluate-sharp-gate` | 7 → 8 | `86b431a3adf292210309df386540e52b9f6f9c5cd2bed68dacfda542669ee8dd` |
| `ingest-sharp-board` | 6 → 7 | `384538d2ed310feced71e1fb1259b1b2279f6150c5559d8ace61986f48c4a2b8` |
| `refresh-mlb-verification-gate` | 10 → 11 | `8ea0852012d803aa276af29e330428e403a22f5346915ab255b54042ac266193` |
| `refresh-mlb-weather-park` | 8 → 9 | `e0b9848efe79cd163573a846b2498038df2623e77fb7fd1ad76e80507ecaead1` |
| `refresh-model-governance` | 6 → 7 | `96e9452fbd96d0b4543c38638cc62afcd0c8fb58619acd62b657fd1b603c64d2` |
| `refresh-player-prop-clv` | 7 → 8 | `431f6d25d7bb7141a4f6a639bc157a1c91b7db34e046299c7c885b3bc8cc02d5` |
| `refresh-sharp-sources` | 10 → 11 | `b3d6dd276139eeea42a9ce292289ba3eb7735094c1786baa6b4b096e70c336c4` |

Every service-role helper matches SHA256 `5767d307ed0ba93c53f611dd5ecf4b7a29b63016dc348dd245eda5044bcf4ca8`. Existing backend-key helpers match their unchanged SHA256 `49421acce8f99faf6f7c61a024abff54f891deb39b0cde01f01424472431098d`.

`refresh-sharp-sources` retains its original nested entrypoint and sibling `_shared/source-fetch.mjs` dependency. The current v11 bundle is captured as a complete owned snapshot so the manifest records all four exact files without expanding allowed source roots to another function or the general shared directory. Its canonical sources also match the deployed bytes. The dependency remains SHA256 `c8640f2b96e3ef08841933dee4508618a9fb238c82a773e32b4937d5b48e9985`.

All previous deployment snapshots remain immutable and represented under `previousDeployment`. Fresh inventory comparison verified all 68 identities, versions, statuses, gateway settings and bundle hashes after rollout.

## Caller compatibility and unchanged state

Read-only investigation traced current SQL wrappers, direct cron commands, registry dispatch, request logs and the dormant SDK chain. The fixed gateway window from 2026-11-22 19:05:20 UTC through November 23 at 19:05:20 contained no requests to these ten routes. The corresponding ordinary/performance HTTP paths were disabled. The latest recorded audit, prop, CLV and refresh enqueues were on November 2; historical responses are not treated as proof of current compatibility.

The adaptive model-audit SQL job remains active, but had zero eligible observations at inspection and its eventual outbound path still uses the disabled dispatcher. Active retention jobs execute cleanup routines, not the guarded refresh endpoints.

Immediately before and after the ten deployments, all 48 registry rows and all 66 cron names, schedules, active flags and command hashes matched. The registry retained 9 enabled non-HTTP entries and 39 disabled HTTP entries. No wrapper SQL, schedule, registry flag, credential or model setting was changed. No write endpoint was manually invoked.

### Activation prerequisites

The legacy `enqueue_pipeline_http_v1` dispatcher still references `snapshot_publishable_key`, classified through a derived-only check as a modern publishable key. It rejects disabled components before reading credentials or sending requests. Re-enabling these routes requires a separately reviewed caller migration to a gateway-valid service JWT with constrained project origin.

The dormant SDK chain `ingest-sharp-board` → `refresh-sharp-sources` → `evaluate-sharp-gate` uses existing server-selected credentials. The deployed credential values and their actual kinds were not inspected. The selector's name is not proof that future calls will present an accepted service JWT. Credential-kind and gateway-role verification must precede activation.

A bounded no-traffic observation cannot exclude every external or future caller. This rollout secures the observed dormant routes; it does not claim to activate or validate their provider ingestion.

## Verification

- The two five-function suites each reproduced 11 failures against the original source and then passed all 21 tests after the repair.
- Each group was independently reviewed by the other implementer, including full source comparisons against the exact live captures, helper hashes, gateway settings and execution of all tests.
- Root integration passed all 73 tests covering these 42 cases, the prior active-writer guards and the recovered credential selectors.
- All 100 Supabase Python tests and the full reconstruction validator passed after the deployment manifest and nested bundle snapshot were updated.
- Tests use signed local fixtures and a signature/expiry stand-in at the platform boundary, then execute each actual handler prefix. Signed anon/authenticated callers, malformed and wrongly typed roles, missing credentials and API-key substitution are rejected before protected work. Distinct service callers are admitted independently of backend credentials.
- Exact-source tests require that only the reviewed import and guard alter the downloaded business source. Existing key helpers and shared dependencies remain unchanged.
- Each current live version and bundle hash was checked immediately before replacement; every returned source file was compared with the reviewed payload after deployment.
- Fresh production state snapshots verify that registry and cron configuration did not change. No artificial production request was used as a test.

These ten repairs follow the four active-caller repairs in PR83 and the four dormant player-prop guards in PR82. They are a bounded authorization repair, not a claim of complete model approval, provider readiness or full schema/security/cron drift parity.
