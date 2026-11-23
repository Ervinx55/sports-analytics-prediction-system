# Active scheduled writer authorization repair — 2026-11-23

## Problem and repair

Four scheduled write handlers accepted requests without checking the caller's service role. Their six SQL wrappers sent a modern publishable key. The repair first moved those six callers to the existing same-project service JWT and fixed HTTPS project origin, then deployed handler role guards while retaining `verify_jwt=true`.

The handler guard relies on the Supabase gateway to verify the JWT signature and expiry. It then requires the exact signed role `service_role`, before body parsing, server credential selection, provider requests or database work. It does not compare the caller token with the selected backend key, which may use a different supported credential format.

The request bodies, provider budgets, schedules, registry state and model calculations are unchanged. The rollout created no credentials and did not manually invoke any write handler.

## Transactional caller change

Local migration: `supabase/migrations/20261123185724_authorize_active_scheduled_writers.sql`.

Applied production migration: `20261123190554_authorize_active_scheduled_writers`.

The single stored SQL statement exactly matches SHA256 `e8a569ff0be03fa40018648b98a5e5f42e85eab2c72ad2c6ef1e7c19a6558882`.

One atomic DO statement validates the configured origin, derived service-credential metadata, six original definition hashes, owners, complete ACLs, SECURITY DEFINER attributes and search paths before replacing anything. It rechecks definitions and privileges afterward. Credential checks are configuration checks; they do not claim to verify a JWT signature. Existing gateway-accepted service-role collector traffic supplied independent compatibility evidence before rollout. No secret value, credential hash or decoded payload was retrieved.

The new SECURITY INVOKER origin helper validates the configured URL on every call and returns only `https://yeoxroijaptomomshdii.supabase.co`. It accepts the exact origin with an optional trailing slash and rejects alternate hosts, paths, ports, userinfo, query strings and fragments. Its EXECUTE grants exclude PUBLIC, anon and authenticated; service_role is permitted.

The six wrappers are `trigger_closing_snapshot()`, `trigger_league_snapshot(text,text,integer)`, `trigger_market_snapshot(text)`, `trigger_model_grading()`, `trigger_pitchmix_feature_capture()` and `trigger_sharp_disagreement_shadow()`.

## Actual function deployments

All four returned ACTIVE with `verify_jwt=true`. Every fetched-back source file matches the reviewed local bytes.

| Function | Version | Reviewed index.ts SHA256 |
|---|---:|---|
| capture-pitchmix-features | 9 → 10 | `9326c982eccaf5a8ab392eaa9f135a483c066bf36267a62c4a63306185679cb4` |
| capture-market-snapshot | 8 → 9 | `61fed291b67e649613e4e2ac59b96f5c2765ee414e50348c5fb0538f7969372f` |
| grade-model-audit | 6 → 7 | `2002338c65163020bbacafa7e1605138da9ed1cfe179adfb3035bea2bee22847` |
| refresh-sharp-disagreement-shadow | 7 → 8 | `c1d5087d1baba74b24ab4b5bc2886a2b551bbfb5649b95672af088be61f15fe4` |

The original recovered deployment snapshots remain unchanged. Pitchmix's previously reviewed v9 is retained by its PR82 Git commit and blob identities; its `previousDeployment` record continues to identify the immutable recovered v8 snapshot. Current manifest paths and hashes refer to the new reviewed deployments.

## Verification

- Seventeen handler tests passed, after nine failures demonstrated the original weakness. Tests use signed low-privilege fixtures, malformed roles and valid service-role callers, and check that unauthorized requests do no protected work.
- Six real-SQL tests passed, including invalid/missing/duplicate/present-NULL configuration, missing and incorrect JWT claims, expiry, definition/owner/ACL drift, runtime origin tampering and an injected late failure proving complete rollback. All six failed against the original behavior.
- Independent review reran all 23 tests and reconstructed each allowed SQL source delta from the captured production definitions.
- Production postflight verified all six replacement hashes and exact owners/ACLs/security attributes; all 13 affected cron names, schedules, active flags and command hashes remained unchanged.
- All 48 registry metadata/state rows remained unchanged: 9 enabled entries and 39 disabled HTTP entries.
- A separate root postflight reproduced the independent database checks. The safe origin-helper invocation returned only the fixed project origin; no network request was made.
- Four deployments were fetched back and compared byte-for-byte, including the common role helper and unchanged backend credential helper.
- The integrated 40-test authorization/credential/exporter regression set and all 100 Supabase Python tests passed. The existing pitchmix credential harness now executes the actual role helper with a locally signed service caller, preserving request-key isolation and the exact recovered business-source comparison.
- The Supabase security advisor returned only the existing informational RLS-without-policy category, consistent with the service-only tables. This is not a declaration of complete security parity.

Natural scheduled requests are observed separately from SQL cron-success records. If a job has not reached its next scheduled slot, it is not described as a verified post-deployment HTTP success. No artificial production write probe is used to fill this gap.

## Scope and recovery

This patch covers four confirmed active handlers and six callers. Other legacy writer candidates require their own caller review. It does not enable disabled collectors, change wagering decisions, repair missing model inputs or grant a new model production approval.

If a handler-only issue is found, retain the service credential and origin protection while restoring its reviewed prior handler. Reverting a caller to the old publishable key while its service-role guard remains active would cause authorization failures. A complete compensating rollback was tested locally, but would restore the original weakness and is not applied.

The original migration recovery evidence remains historical and read-only; this separately reviewed migration is explicitly marked as applied. Full schema, security and cron drift checks still require their existing CI access credentials and are not declared clean by source recovery.
