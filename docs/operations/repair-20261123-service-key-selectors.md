# Service-key selector repair — 2026-11-23

## Scope and result

Two recovered live Edge Functions coerced any truthy `SUPABASE_SECRET_KEYS.default` value into a credential using `String(...)`. A number became a numeric credential, an object became an object-label string, an array could become a plausible key, and whitespace around a valid key remained in the selected value.

The canonical sources were first restored from the exact observed live bundles:

| Function | Observed version | Existing gateway setting | Observed index SHA-256 |
| --- | --- | --- | --- |
| `capture-pitchmix-features` | 8 | `verify_jwt: true` | `b0f87a1df168c9b3d49c719b21bfdf85fe07d606f9c365acfab860d3ad73e7d3` |
| `provider-health-status` | 10 | `verify_jwt: false` | `73d57bfc1b38cf642057cff73760d2d5627c05c5b70088b923e38ef3c151bcf4` |

Both recovered `service-role-key.mjs` helpers remain byte-for-byte identical to their observed versions, SHA-256 `49421acce8f99faf6f7c61a024abff54f891deb39b0cde01f01424472431098d`. The immutable deployed snapshots were not edited.

The only change from each observed live index is:

```js
if (typeof parsed?.default === "string" && parsed.default.trim()) return parsed.default.trim();
```

Credential priority remains the deployed order: a trimmed nonblank `EDGE_LAB_SERVICE_ROLE_KEY` override, then a valid trimmed modern default, then the trimmed injected legacy service-role key. Invalid modern defaults fall back; when no server credential exists, the existing helper fails before creating a Supabase client. Request headers, request bodies and query parameters cannot choose the backend credential.

The Supabase SDK client call, gateway configuration, handler methods, response/cache headers, provider requests and database behavior are otherwise unchanged. This is a selector correction, not a caller-authorization change. The integrating agent owns the separate capture caller-role review and manifest updates; the deployed selector versions are verified below.

## Verification

The actual Deno handler bodies were executed in a Node VM after removing imports and their TypeScript annotations. The environment and Supabase SDK boundary were injected, with empty query results so no provider fetch or write occurred. Tests inspect the exact key and options passed into the existing SDK client call; they do not claim to test the SDK's own HTTP-header implementation. Existing ML exporter tests separately verify its manually constructed API-key/Bearer headers.

Six behavioral checks failed before the selector correction: modern-key trimming, malformed-default fallback and absent-fallback failure, for each function. Two additional exact-source guards failed until the authorized line change was present. Those guards now prove that all remaining live index bytes and both helpers are unchanged.

The focused command passed **23 tests, zero failures**, including 14 tests for these two functions:

```sh
node --test tests/node/recovered-service-key-selectors.test.mjs tests/node/ml-export-credentials.test.mjs
```

Coverage includes override/modern/legacy precedence; malformed JSON; number, boolean, array, object, null and blank defaults; whitespace trimming; fail-before-client behavior; unchanged method and cache headers; request credentials ignored for backend selection; no credential reflection; and exact live-source delta limits. Scoped `git diff --check` passed.

Independent review passed the same 23 tests and verified both index deltas and helper hashes directly. The selector changes were approved with no remaining finding in this scope and then frozen. The existing pitchmix caller-authorization boundary is unchanged and remains a separate integration item.

Reviewed candidate index hashes are:

- `capture-pitchmix-features/index.ts`: `1a6d1a7ca53979ed07185820e82ba3d52d5df6c31c6024d6adee136f32835a33`
- `provider-health-status/index.ts`: `12e474c2e8091d14cd3055f9e78f324e2377634ed89f16d05feebbca2db45e6e`

## Deployment and downloaded source parity

The integrating agent deployed both reviewed selector changes and downloaded the resulting live bundles. Independent review of those downloaded receipts confirmed the following metadata and exact source parity:

| Function | Deployed version | Status | Gateway setting | Deployment `updated_at` (UTC) | Downloaded index SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `capture-pitchmix-features` | 9 | `ACTIVE` | `verify_jwt: true` | `2026-11-23T18:42:04.248Z` | `1a6d1a7ca53979ed07185820e82ba3d52d5df6c31c6024d6adee136f32835a33` |
| `provider-health-status` | 11 | `ACTIVE` | `verify_jwt: false` | `2026-11-23T18:42:06.518Z` | `12e474c2e8091d14cd3055f9e78f324e2377634ed89f16d05feebbca2db45e6e` |

Each downloaded `index.ts` matches its reviewed canonical candidate byte for byte. Both downloaded `service-role-key.mjs` files also match the reviewed canonical helper exactly, with SHA-256 `49421acce8f99faf6f7c61a024abff54f891deb39b0cde01f01424472431098d`. The gateway settings are unchanged from the preceding deployed versions.

The receipts are retained outside the repository under `/workspace/scratch/1c2389373cef/security-deployments-20261123/`:

- `capture-pitchmix-features.json`: receipt SHA-256 `7a9f8a18bb965bda97614e1a8b01352e8f9327bf54ef3c0912c586dbd6edf8ce`; downloaded bundle SHA-256 `c53198030f9a137a89d4d64888d9fac65d1947116a0669036957a2f98795dfc4`.
- `provider-health-status.json`: receipt SHA-256 `04829841d2e0507d7f734c2efa348e0e10b9f7373f4edbdd9e06e9c92d69c496`; downloaded bundle SHA-256 `bbd84287a3eb67f8704c5a91b668c634381b7e2006d82602f790bf4e33de20d8`.

These receipts establish the deployed source and gateway configuration. They do not establish successful execution of the active pitchmix scheduler or resolve its separate caller-authorization boundary. The selector repair did not add handler authorization, rotate credentials or change that caller. That operational work remains with the integrating agent. The scoped implementation and independent-review agent made no production writes or manifest edits; the report is now frozen with the verified deployment evidence.
