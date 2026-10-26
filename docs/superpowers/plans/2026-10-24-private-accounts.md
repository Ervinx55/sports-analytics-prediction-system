# Private Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A private four-provider account ledger, honest realized profit and a read-only Kalshi connection.
**Architecture:** Existing static Vercel frontend with owner-verified server routes and Supabase RLS. Pure shared accounting/import modules; no private data in public caches. Connection disabled until secure owner setup.
**Tech Stack:** Node 24 ESM, browser JavaScript, Supabase Postgres/Auth, existing Node/Python/PGlite tests.
**Spec:** docs/superpowers/specs/2026-10-24-private-accounts-design.md (approved by user October 24).

## Global Constraints
No paid upgrades. USD initially. No secrets in URLs, browser bundles, localStorage, logs, analytics, error payloads or Git. No public signup or anonymous accounts. Keep model/shadow performance separate. No production mutations before validated acceptance. Preserve existing unrelated modified SQL and untracked files. Use explicit workdir, scoped git safe.directory and command-local Codex identity. No private API scraping or betting/trading operations.

## Review Focus
- Corrected/imported entries must not double count profit (Tasks 1/2).
- Missing source history cannot silently become complete zero profit (Tasks 1/4).
- Authenticated second users must not read or attach rows to owner's accounts (Task 2).
- Expired sessions and failed fetches must clear private screen data without resetting stored balances (Task 3).
- Kalshi partial fills/closes and fees must retain decimal precision and avoid settlement duplication (Task 4).

### Task 1: Accounting and canonical import contract
**Files:** create sharp-service/lib/accounts/accounting.js, sharp-service/lib/accounts/csv.js, tests/node/accounts-accounting.test.mjs, tests/node/accounts-csv.test.mjs, docs/accounts-import-template.csv.
**Interfaces:** validateEntry(input) returns normalized entry or throws; summarizeAccounts({accounts,entries,movements,filters}) returns JSON-safe cents totals/coverage per account and combined; parseImportCsv(text) returns {rows,errors}; exportImportCsv(rows) returns CSV. Shared modules browser-compatible with no Node-only imports.
Entry: id, accountId, source (manual/import/kalshi), sourceId optional, kind (cash/promo), status (pending/won/lost/push/void/partial), sport, description, placedAt ISO, settledAt nullable ISO, stakeCents, returnCents nullable, feeCents, feeIncluded boolean, predictionId nullable, legs array, supersedes nullable. Account: id, provider prizepicks/kalshi/underdog/bovada, name, openingBalanceCents, openingAt ISO, historyComplete boolean, archived boolean. Movement: id,accountId,type deposit/withdrawal/bonus/adjustment,amountCents,occurredAt. Positive movement amount except signed adjustment. Kalshi source records must not be treated as standard wager entries until Task 4 reconciliation produces validated summaries.
- [ ] Write failing accounting tests for $10 cash win returning $18 with $1 separate fee => $7 profit; included fee => $8; deposit $100 excluded; pending $5 exposure; push/void excluded win-rate; $10 return $4 partial => -$6; promo excluded cash ROI; multi-leg stake counted once; empty denominator N/A; invalid/unsafe cents and dates rejected; filtered coverage, corrections and unknown accounts.
- [ ] Run focused tests and confirm missing functionality fails.
- [ ] Implement exact integer accounting; validation bounds and status/date coherence, void/push refund coherence, explicit incomplete coverage; choose safe representation and reject overflow. Corrections resolve one live version only; reject cycles/forks and missing predecessors rather than inventing totals. Date filters settledAt for realized metrics, placedAt for open exposure; cash reconciliation remains full history since checkpoint and labeled separately.
- [ ] Write/run failing CSV tests for quoted commas/newlines/escaped quotes, malformed rows, money/date coercion, repeated source IDs, formula injection, 1 MiB/2000-row bounds; then implement canonical columns documented in template. Stable identifiers for import; duplicate conflicts are errors, missing identifiers flagged for review, not silently deduped.
- [ ] Run node --test tests/node/*.test.mjs and commit only task files. Document public interfaces and return fields in report.

### Task 2: Protected persistence and account API
**Files:** create SQL migration via available Supabase CLI, tests/supabase/accounts fixture and runner matching existing tooling, sharp-service/lib/accounts/auth.js, sharp-service/handlers/accounts.js, tests/node/accounts-api.test.mjs; modify sharp-service/api/dashboard.js and sharp-service/vercel.json only to dispatch dedicated /api/accounts route without adding a thirteenth Vercel function.
**Interfaces:** /api/accounts GET config (public readiness only), authenticated GET snapshot, POST create-account/add-entry/add-movement/import/correct/archive; common {ok,data,error} response, generic errors; auth.js verifies bearer token via Supabase Auth and exact server allowlisted UUID before any data access. Server config SUPABASE_URL, publishable key, ACCOUNTS_OWNER_ID, feature flag. No user-supplied service credentials. Data calls forward user's JWT and publishable key so RLS applies.
- [ ] Verify current Supabase docs/changelog, CLI availability and existing PGlite fixture approach; produce local migration using CLI, no remote mutation.
- [ ] Write failing fixture/API tests: anon denied, forged token denied, second user denied, foreign account owner rejected, corrections immutable, atomic failed import rolls back, retries don't duplicate, no-store on all paths, setup-needed if configuration missing, unsupported actions denied.
- [ ] Implement tables in private account namespace with RLS ownership and owner allowlist, composite foreign keys, constrained money/status fields, immutable events/corrections and least privilege invoker RPC for atomic import. No public service-role reads or SECURITY DEFINER shortcuts. Keep schema and JS contract aligned; document RPC signatures in report.
- [ ] Implement auth and handler with bounded body/timeout, safe error messages, strict action whitelist and validation using Task 1. Existing dashboard behavior unchanged except explicit accounts dispatch.
- [ ] Run Node suite and actual local SQL tests with anon/two users; commit only task files. Keep hosted activation blocked pending configured owner/verified login.

### Task 3: Private account interface
**Files:** create sharp-service/accounts.html, sharp-service/accounts.js, sharp-service/accounts.css, tests/node/accounts-ui.test.mjs, docs/accounts-setup.md; add navigation links to sharp-service/dashboard.html, nba.html and nfl.html.
**Interfaces:** consume Task 1 modules and Task 2 config/snapshot/actions. Use Supabase supported email OTP for existing users (shouldCreateUser false), safe session handling with no secrets in localStorage, publishable config only. If auth delivery/config isn't ready show setup-needed, not fake connected state.
- [ ] Write failing contract/UI tests for logged-out state hiding records, logout/expired auth clearing data, numeric validation, import review-before-save, disabled Kalshi setup button, no public signup, no unsafe HTML insertion.
- [ ] Implement accessible responsive forms for accounts, cash movements, entries/legs/corrections, filters, archival, source state and totals. Manual cash entries and canonical CSV preview/save fully usable after login. No fixture data in live UI; no native import claims or OCR. Fees/promos/open positions distinct.
- [ ] Test Node suite, then browser at desktop/narrow viewport with synthetic authenticated fixture and unavailable API; validate actual save/reload/logout against local backend where feasible. Record any hosted login blockers explicitly; commit task files.

### Task 4: Kalshi read connector and final acceptance
**Files:** create sharp-service/lib/accounts/kalshi.js, sharp-service/lib/accounts/kalshi-accounting.js, tests/node/accounts-kalshi.test.mjs; extend accounts handler, account schema as required by new CLI migration, setup docs/UI.
**Interfaces:** fetchKalshiSnapshot({keyId,privateKey,fetchImpl,clock,cursor}) returns bounded authenticated read results or typed safe error; reconcileKalshi(snapshot) returns exact decimal realized/unrealized/fees/coverage and source identifiers. Public response never contains credentials. Connection association bound to owner.
- [ ] Verify official endpoint/permission/history schemas from docs, choose and document exact decimal internal representation, supported partial close allocation and coverage rules. If readonly scopes cannot be verified non-mutatively, connector remains disabled and reports precise blocker.
- [ ] Write failing tests for RSA/Ed25519 signed GET whitelist, hostile paths, scopes, pagination bounds, 429/backoff, timeout, duplicate fills, partial close/settlement, fees, decimal rounding and incomplete history.
- [ ] Implement read-only server secret binding and manual sync/disconnect with durable per-account locking/idempotency, last-good snapshot and stale labels. No provider writes, arbitrary hosts, browser key uploads, background jobs or claimed real connectivity without configured credentials.
- [ ] Run full Node/Python/SQL checks, secret scan and independent whole-feature review; repair important findings with failing regressions. Commit logical changes. Publish a protected preview only if safe; do not expose actual personal records in tests. Record exact production/preview state and owner setup blockers. Native provider mappings remain blocked by missing sanitized export schemas.
