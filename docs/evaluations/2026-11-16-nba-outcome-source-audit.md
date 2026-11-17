# Read-only NBA outcome source diagnostic — November 16, 2026

`audit-nba-outcome-sources` version 3 is ACTIVE with gateway JWT verification enabled. Its deployed bundle hash is `29f69081bf21d942d4eb76203c5b2ef0f0cf0172ba6d18c67f0204de7855479a`.

The deployed entrypoint and helper contents exactly match the repository files. Their SHA-256 hashes are recorded in `supabase/manifests/edge-functions.json`; no other manifest entry was changed.

A request must be a service-role POST with exactly one `eventID` from the fixed seven-game list. The provider query is server-controlled: one event, `limit=1`, `type=match`, `oddID=points-home-game-ml-home`, and `expandResults=true`. It has a 12-second deadline and 4 MiB response cap. Responses preserve selected event evidence fields and receipt/raw-byte SHA-256 metadata; nested odds, metadata and credential fields are excluded. The function has no database writes or model imports.

Provider success must be explicit. Unknown/duplicate IDs and wrong leagues reject. A pagination cursor is accepted only if the sole requested event appears exactly once; an absent requested event with a cursor rejects. Errors are sanitized codes without provider bodies.

## Live verification

At 16:51:09 UTC, public unauthenticated POST and forged-service-role JWT POST both returned **401**. Supabase edge logs independently identify `UNAUTHORIZED_NO_AUTH_HEADER` and `UNAUTHORIZED_LEGACY_JWT`, version 3. This verifies gateway authentication rather than only the helper's local role check.

Seven authorized single-event requests returned **200** (request receipts 3056 and 3058–3063), covering all seven fixed event IDs. The combined evidence is saved under `outputs/nba-outcome-recovery-2026-11-16/current-sgo-outcome-sources.json` in the task workspace. Retrieving source evidence does not itself append verified outcomes.

Version 1 failed closed on the large combined response; version 2 failed closed on pagination. Version 3 is the verified deployment. Those earlier failures remain visible in logs and are not counted as successful evidence.

The full Node suite passed **324/324**, including **12** source-audit tests. Tests cover request/identity/auth restrictions, fixed query parameters, source projection, bounded bodies/deadline, pagination, sanitized failures, and secret non-disclosure.

The live verification involved read-only diagnostics and public negative-auth probes. No model, protocol, forecast, or outcome was mutated by this function.
