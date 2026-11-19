# Edge Lab sharp-money research: phase 1

## Sources
- VSiN: https://data.vsin.com/betting-splits/ (DraftKings)
- Circa view: https://data.vsin.com/betting-splits/?source=circa
- Cross-check: https://www.actionnetwork.com/public-betting

These are reported percentages of bets and handle at specific providers, NOT
sportsbooks' full liabilities, internal book positions or guaranteed sharp wagers.
Verify licensing, access rights and approved machine ingestion before automation.
Do not bypass paywalls, access controls or anti-bot protections.

## Data contract
Store each timestamped pregame observation with event ID, league, scheduled
start, source, book, market (ML/spread/total), side, line, ticket %, handle %,
ticket count if supplied, and observation time in UTC. Never replace missing
values with zero. Never combine mismatched books, markets or snapshots.
Store original source attribution and ingestion method.

## Signal rules
Divergence = handle% minus ticket%, in percentage points. A 15-point gap
with <=45% tickets is a *research flag*, not a BUY. Reverse line movement
requires separately verified direction and timing of the same selection's
line movement. News, injuries, price shading and liquidity can also move lines.
Use independent market quotes (Pinnacle, Circa, BookMaker) for price changes,
with market/side normalization and timestamp alignment.

## Validation
Save snapshots before kickoff, freeze them, then grade against closing
sharp-market no-vig probability and final outcomes. Compare:
(1) baseline model only, (2) splits only, (3) model + splits,
and (4) market-only benchmark. Use chronological out-of-sample splits,
report coverage, missingness, calibration, Brier/log loss, CLV, ROI net of
vig and uncertainty intervals by sport/market. Never optimize and evaluate
on the same slate. Avoid survivorship bias and do not infer actual bet
volume from percentage shares.

## Deployment
Research-only until source permission, live integration, historical storage,
tests, calibration and monitoring pass. No purchase, scheduled scraper,
production change or betting BUY activation is included in this PR.
