# Sync verified betting splits to Supabase (server-side only)

The Supabase table `public.edge_sharp_money_snapshots` exists and has RLS
enabled, no anonymous/authenticated grants and a six-column uniqueness key.

**Prerequisites:** Permission to store the source data, and a local SQLite
archive produced by the authorized manual importer. Do not upload sample
or hypothetical observations into production.

Dry run (does not contact Supabase):
```sh
python -m src.sharp_money_supabase_sync --db edge_splits.sqlite --authorized
```

To upload, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as
**server-side environment variables only**, then run:
```sh
python -m src.sharp_money_supabase_sync --db edge_splits.sqlite --authorized --commit
```

The uploader sends batches of 100 with duplicate conflicts ignored.
No secrets are printed. Never place service keys in frontend code,
`NEXT_PUBLIC_*` variables, GitHub commits, or CSVs. Do not deploy a
public endpoint that accepts arbitrary source rows.

**Current scope:** manual authorized data only, no scraping, no recurring
job, no user-facing dashboard and no BUY activation. This script does not
obtain source authorization or ingest VSiN directly. Tests must pass before
using `--commit`. Verify row counts and timestamps after a real upload.
