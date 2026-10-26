# Edge Lab private accounts and profit — proposed design

Status: user review; no product code, account connections or production changes.

## Intent and approaches
The user approved a private account dashboard for PrizePicks, Kalshi, Underdog and Bovada: Kalshi syncing first, imports/manual tracking for the others, actual profit separate from model/shadow performance. No paid upgrades.

Recommended approach: reuse the existing static Vercel frontend and Supabase for protected cross-device storage. A device-only tracker would be simpler but cannot provide the approved server syncing/cross-device history. An aggregator is not selected: availability, permission and pricing are unverified. Current sharp-service has no personal login; public dashboard APIs and provider caches must never contain private account records. Keep this work separately reviewable from the existing broad draft PR.

## Private area
An Accounts & Profit link opens a login screen, then account cards, profit totals, history, filters, manual-entry/import forms and connection status. Show empty and error states honestly, without demo profits in real views. Support phone and desktop.

Builder proposal: invite-only owner access using Supabase Auth; no anonymous access or public signup. Prefer email OTP if existing email delivery supports the owner without paid changes. Otherwise keep hosted activation disabled until an existing supported login method is configured. Use a server-controlled allowlisted verified auth UUID, never editable user metadata. Obtain the owner's selected login identity during onboarding; do not infer it from Git authorship. The public sports dashboard remains public.

All personal rows have owner UUIDs; compound account/owner foreign keys prevent cross-owner child references. RLS denies anon access and restricts reads/writes to the owner, including owner-preserving update checks. Use verified caller sessions for data access; no public service-role route. Personal responses use no-store and bypass shared caches. Clear visible data on logout. No secrets in URLs, browser bundles, localStorage, logs, analytics, error payloads or Git.

## Ledger and metrics
Entities: accounts, entries and legs, cash movements, imports/sync runs, immutable correction records. Archive accounts reversibly; corrections supersede records atomically and retain audit history.

USD initially. User-entered amounts use integer cents. Kalshi source decimals use exact arithmetic through aggregation, with display rounding only. Never sum monetary values with binary floating-point arithmetic or round each fill prematurely.

Settled cash-entry profit = returned cash including returned stake minus cash stake minus separately charged fees. Store source fee convention to avoid double subtraction. Deposits, withdrawals, opening balances, bonuses and adjustments are separate ledger categories excluded from betting profit. Opening balance is a dated checkpoint; missing earlier history is labeled incomplete.

Pending entries affect cash exposure/reconciliation but not wins/losses or settled profit. Voids/refunds return stake with only actual nonrefundable fees affecting profit. Pushes and voids are excluded from win-rate denominator; zero denominators show N/A. Multi-leg PrizePicks/Underdog entries count once for stake, profit and entry outcome; legs are analysis only. Classify partial payouts explicitly. Promo/free-entry and bonus-funded results are separate from cash ROI.

Kalshi profit is reconstructed/reconciled from fills, fees, closes and settlements without double-counting, including partial closes. Unrealized position value is separate from realized profit. Kalshi return-on-cost is separate from pick-entry ROI until denominator comparability is established. Aggregate profit includes only supported reconciled realized cash results, with coverage flags; missing values never become zeros. Incomplete accounts do not masquerade as complete all-account totals.

Show per-account and combined settled profit, cash stake, open exposure, wins/losses/pushes/voids, balance/reconciliation status, last successful sync and coverage dates. Filter by provider, sport, date range and source. Link an actual entry to an Edge Lab prediction only by an explicit immutable prediction reference; user picks never become retrospective model predictions or holdout observations.

## Manual entry and imports
Deliver manual records and a documented canonical CSV template first. Parse locally, preview normalized rows and errors, then require explicit save confirmation. Do not persist raw files. Bound file/row size, handle quoted CSV correctly, reject invalid money/dates and unsupported schemas, never evaluate formulas, and neutralize spreadsheet formula injection on export. Imports are atomic and idempotent using stable source IDs. Without reliable IDs flag possible duplicates for review rather than silently dropping identical legitimate bets.

Underdog supports requesting transaction CSVs from support, but its actual columns have not been supplied: native mapping waits for a sanitized sample/schema. PrizePicks and Bovada initially use manual/canonical imports; do not claim direct sync. OCR/slip-image extraction is deferred. No invented native CSV mappings.

## Kalshi read-only connection
Official API only, account reading only: no placing/canceling orders, transfers or transactional tools. Verify current official key scopes and a non-mutating way to establish read-only privileges before activation. Reject unverified or broader keys; never probe permissions by attempting a transaction.

Initial single-owner setup stores key ID/private key in hosting secret configuration, outside chat and bound to the allowlisted owner. No public key-upload endpoint in v1. Do not show a functional Connect button until storage, ownership and auth are ready; display setup-needed status. User performs key creation and secure configuration; never request credentials in conversation. Egress and signing are restricted to fixed official hosts and explicit read endpoints; never arbitrary user URLs.

On-demand sync first: bounded pagination, timeouts, per-account locks, rate-limit backoff, idempotency and resumable progress. Keep last successful data with stale/partial labels on failure; never reset balances/profit to zero. Disconnect stops sync and removes the credential association without deleting transaction history; provider-side key revocation is a separate explicit step. Background syncing waits for correctness and quota validation.

## Delivery and validation
1. Build accounting and owner isolation plus manual/import UI against synthetic fixtures.
2. Test real login/persistence/ownership in a protected non-production environment using existing local database tooling; no paid Supabase branching. If hosted configuration is unavailable, report that gate as blocked.
3. Implement Kalshi reads, exact money handling and reconciliation with synthetic/recorded fixtures. Real connection waits for secure owner setup.
4. Verify actual read-only sync against provider balances/history, then release only validated portions with unfinished connections visibly unavailable.

Tests: deposits/bonuses excluded; losses, wins, voids, pushes, partial/multi-leg results; duplicates/corrections/date ranges/incomplete history; Kalshi fees, fills, partial closes and settlements; anonymous/second-user denial on every route and database table; logout; rate limits/outages/stale data; small-screen workflows. Existing sports tests stay passing. No claim of connectivity or profitability from fixtures.

Design approval authorizes implementation, not fabricated credentials, unvalidated production release or paid upgrades. Existing production and model influence gates remain intact. Owner email and provider credentials are needed only at protected onboarding, not for development.

## Sources and remaining engineering discovery
- https://help.kalshi.com/en/articles/13823854-kalshi-api
- https://docs.kalshi.com/getting_started/api_keys
- https://help.underdogsports.com/en/articles/10740184-how-do-taxes-work (CSV section)
- https://www.bovada.lv/help/general-faq/how-does-the-transactions-statement-work
- https://supabase.com/docs/guides/auth/auth-email-passwordless

Before implementation verify current Supabase changelog/auth details, official Kalshi permission introspection and account history schemas. Web retrieval of the markdown changelog endpoint failed during design review; no Supabase changes made. Hosting currently uses 12 functions, so verify free-plan routing capacity before adding endpoints; do not purchase an upgrade.
