The NFL's November 9 announcement and the current official Week 11 schedule both identify the November 22 kickoff changes for Jacksonville at New York and Pittsburgh at Philadelphia. `revisions.json` contains the two reviewed facts, actual November 17 source receipts, source hashes, official game IDs, and existing provider IDs. `sourceUpdatedAt` is the announcement content's modification timestamp; `publishedDate` is its stated announcement date. No exact publication time is inferred.

The original 30 prospective forecasts and two quality flags remain immutable. Corrected future captures use an event identity qualified by the revision hash and retain the original provider event ID. The database requires the registered official evidence and an append-only resolution scoped to the new identity. Each corrected capture also requires current SGO kickoff agreement and eligible paired prices. The original base event stays quarantined.

Only the target schedule row's kickoff is cloned for inference. The raw NFLverse CSV and all prior-game feature rows remain unchanged. Model coefficients, model hashes, and production influence remain frozen. Settlement uses the same qualified identity with the archived official schedule revision; it cannot settle the original excluded capture through a different kickoff.

Reproduce the registration payload and rollback validation wrapper from the archived raw responses:

```powershell
node scripts/nfl/prepare-winner-schedule-registration.mjs ../../outputs/winner-evidence-2026-11-17/public ../../outputs/winner-evidence-2026-11-17
```

The generator verifies the saved raw-byte hashes, URL receipts, announcement facts, and the official schedule card's game ID and UTC kickoff. Full HTML stays outside source control. The registration payload retains the announcement raw text and a gzip archive of the full schedule, with the original raw hashes and receipts. The generated SQL wrapper rolls back the migration, registrations, and all synthetic test captures together. Generation does not apply a migration or register evidence.
