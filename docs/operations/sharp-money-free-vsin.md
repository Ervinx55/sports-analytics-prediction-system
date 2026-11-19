# No-cost VSiN split capture (manual, research only)

Free VSiN displays a limited subset of DraftKings splits at
https://data.vsin.com/betting-splits/ . The page states that additional
games/books are restricted to Pro. Do not bypass access limits, automate
website extraction, or claim an official feed/API exists.

## Capture procedure
1. Open the free page normally. For a visible matchup, transcribe the
   **same side** and **same market** ticket % and handle % into the CSV
   template in docs/examples/sharp_money_manual_template.csv.
2. Record the actual displayed book (DraftKings or Circa), source VSiN,
   market (moneyline/spread/total), selection, current line, UTC
   observation timestamp, UTC scheduled game time and a stable event ID.
3. If a value is not visible, leave it blank. Never infer it from the
   opposing market or copy a percentage from a different bookmaker.
4. If a source explicitly authorizes local storage/research use of
   these manually transcribed observations, run:
   `python -m src.sharp_money_ingest --csv PATH --db edge_splits.sqlite --authorized`
   This flag is an operator attestation, not a license check.
5. Do not run the importer after game start or with stale snapshots:
   it intentionally rejects such rows. For historical backtesting,
   create a separate controlled backfill procedure with documented
   provenance and as-of timestamps; never disguise retrospective data
   as live observations.

## Joining to existing sharp prices
Use event ID + book + market + selection + line + timestamp to align
quotes. Keep the VSiN ticket/handle source separate from Pinnacle,
Circa and BookMaker prices. Calculate no-vig implied probabilities
from paired outcomes; track open, observed, and closing prices.
A split discrepancy is a **research flag**, never a validated model
probability or a production BUY.

## Limitations
Free access may cover only a few games. The code currently stores
snapshots in local SQLite, not Supabase or the live Vercel deployment.
No automated feed, recurring collector, dashboard integration,
purchase, or production rollout is included.
