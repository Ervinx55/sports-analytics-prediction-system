# Edge Lab local NBA tracking

Run with Node 24. No new paid service, sportsbook login or Supabase credential is required.

Start on Windows: `./scripts/local/start.ps1` (optional `-Node C:/full/path/node.exe`). Stop: `./scripts/local/stop.ps1`. The stop request waits for the bounded current provider cycle. A one-shot run is `node scripts/local/tracker.mjs`. Import an original archive once with `node scripts/local/tracker.mjs --archive nba-capture-payload.json`; imported source timestamps are retained, not recreated as fresh forecasts. Do not run multiple independent one-shot collectors at once.

The user-facing report is `local-data/report.html`. Open the file directly and reload after a cycle. `http://127.0.0.1:8782` also serves a read-only dashboard when the local environment permits loopback connections. The Codex execution environment denied/timed out loopback checks, so the offline file is the verified delivery path. Data and logs are excluded from Git.

SQLite ledger: `local-data/nba-research.sqlite` (retain its adjacent WAL/SHM files when backing up a running process; preferably stop first). `report.json` and `runs.jsonl` show the most recent run and operational history. No local results are automatically uploaded. The process checks every 15 minutes while it and the computer are running; sleep, app shutdown or process termination stops collection. No startup task was installed.

Current scope is NBA team moneyline, spread and total research. Existing NBA event identity, official final-score rules, earlier pregame cutoff and rate-limit handling are reused. First forecasts are immutable; missing/stale models are excluded, missing results remain unresolved. This does not activate NFL, NHL, tennis, soccer or player-prop grading. Those need verified corresponding adapters.

The original 130 archived observations across 11 NBA games were imported and graded locally: 65 winning sides, 65 losing sides, no pushes. Both opposing sides and multiple books are present: these are NOT 130 independent bets or a 50% model hit rate. No ROI, calibrated skill or qualified PLAYs are claimed. All results remain research-only.
