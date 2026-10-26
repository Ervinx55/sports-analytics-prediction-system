# Private Accounts setup

Status: implementation under validation; production remains disabled. No provider is connected by creating a ledger account.

## Owner login

1. Apply `20261025122136_private_accounts.sql` only after preview acceptance. Do not expose the `private_accounts` schema in the Data API. Keep its RLS policies enabled.
2. Provision the approved owner in Supabase Auth using its administrative interface. Do not put the email in source control. Disable public signup and anonymous sign-in.
3. Record that user's UUID in the single `private_accounts.owner_config` row through a protected administrative connection. Set the same UUID in `ACCOUNTS_OWNER_ID` in the intended Vercel environment.
4. Configure `SUPABASE_URL` and the project's `sb_publishable_…` key in `SUPABASE_PUBLISHABLE_KEY`. Never use a service-role or secret key for this route. Set `ACCOUNTS_ENABLED=true` only after owner and email setup.
5. Configure the Supabase Magic Link email template to show `{{ .Token }}` for email OTP. Confirm email delivery and rate limits using the owner's initiated sign-in. The app uses `create_user:false` and verifies the code with `type:email`; there is no public signup screen.
6. Test correct-owner login, wrong-user denial, logout, expired sessions, and save/reload in preview before production activation.

Official reference: https://supabase.com/docs/guides/auth/auth-email-passwordless

Sessions live only in memory. Refresh signs the user out. No refresh token is persisted; expiry requires a new code. No account API response is cacheable.

## Recording accounts

PrizePicks, Underdog and Bovada currently support manual entries and the Edge Lab canonical CSV format. These are not automatic account connections. See `docs/accounts-import-template.csv`; provider-native export formats have not been verified.

Opening balance is a checkpoint, not profit. Mark coverage incomplete until all relevant entries and cash movements are recorded. Gross return includes returned stake. Fees already deducted from return must be marked included. Promo results and open exposure are separate from cash profit. Corrections append immutable replacements. A multi-leg entry counts once.

Imports require a complete preview and explicit confirmation. Retry the unchanged failed form/import to reuse its request ID. Changing input creates a new request; check history after an ambiguous network failure before changing it. Source IDs and entry IDs protect CSV replay.

Capacity is currently 100 accounts, 10,000 immutable entries, 10,000 movements, and approximately 7 MiB of payload. Corrections count toward retained history. Crossing writes roll back completely and return `LEDGER_CAPACITY_EXCEEDED`; expanding capacity needs a validated storage/read change. Archiving preserves history and does not reclaim capacity.

## Kalshi

Connection remains disabled pending the read-only connector and secure credential provisioning. Do not enter a Kalshi private key or sportsbook password into these forms. Manual Kalshi history is labeled incomplete until provider reconciliation is available. No trade, bet, cancellation, deposit or withdrawal action is supported.
