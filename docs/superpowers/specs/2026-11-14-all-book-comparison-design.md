# All-book prop and game research

The user authorized using every available book to improve prop and game research. Keep both frozen models, their default APIs, prospective collection, probability parameters, and PLAY approval gates unchanged. More books improve price visibility; they do not establish true win probabilities or guaranteed winners.

## Approach

Extend the existing research workspace and existing APIs. Request account-entitled SGO books by omitting the optional bookmaker filter in research only. Explicit filters still work. Use one maintained, browser-safe platform catalog from the official SGO bookmaker reference (checked 2026-11-14). Unknown platforms remain visible but cannot produce sportsbook probabilities. DFS/exchange terms remain separate; no payout or exchange price is fabricated.

Alternatives considered: add a new application (unnecessary navigation and duplicated feeds), or modify production collectors/models (violates the freeze). The selected implementation uses the existing research workspace and read-only APIs. Ordinary implementation choices follow the user's existing authorization to expand coverage and retain safeguards.

## Data and boundaries

- NBA and NFL prop research: existing points/rebounds/assists and NFL passing yards/TDs, rushing yards, receiving yards/receptions. Same roster, identity, exact odd ID, upcoming-event, freshness, pagination, and quota checks. No arbitrary-stat expansion.
- Default NBA DraftKings validation API and default NFL model API remain unchanged. NFL research quotes are separate; existing NFL estimates attach only to an exact matching event/player/market/side/line/book/price. Failure to read estimates does not remove valid quotes or imply approved probabilities.
- Game research uses the existing all-book board API and provider failover. Initial game selectors NBA/NFL/NHL/MLB/CFB, with explicit league input for provider-supported soccer/tennis leagues. Read-only per selected league; no broad concurrent fanout or polling increase.
- Research quota priority remains background. No new serverless functions, secrets, dependencies, schedules, database mutations, or transactions.

## Comparison

Group prices by event, sport/league, exact participant, stat, period, outcome structure, side, and line. For props, use the provider player ID; do not match by display name. Game rows use exact odd IDs and require all sides of the same two-way or three-way market at the same book. Opposite spread must be the negative line; opposing totals must share the same line. Never pair two-way moneylines with three-way markets or regulation with full-game odds.

Use only known sportsbooks with explicitly available valid American prices, provider and response timestamps no older than five minutes, and valid opposing prices. Future/missing timestamps are unverified. Integer stat/total/spread lines can push and therefore do not receive an unconditional market probability. Unknown, DFS, and exchange quotes cannot enter comparisons.

For every exact selection, show the best observed sportsbook price and the number of eligible books. User must verify account access and current availability. A reference percentage is a leave-one-book-out median of same-market no-vig estimates: use at least two of Pinnacle/Circa/BookMaker.eu when available, otherwise at least three other books. Book counts are source counts, not independent samples. Do not call the reference a model probability, true probability, or evidence of calibrated accuracy. Never reuse the quoted book as its own benchmark. Thin coverage shows insufficient comparison evidence.

No expected-profit estimate or automatic PLAY is created. Existing research percentages remain explicitly unvalidated. Comparison UI explains missing opposing prices, stale quotes, push risk, and unverified settlement/execution terms.

## UI and checks

Add Player props / Games selector to the same research page, exact-market comparison on cards/details, and an optional Best observed prices filter. Keep every source quote inspectable and missing coverage explicit. Retain sport filters, shortlist separation, deep dives, payout worksheets, responsive layout, and minute freshness redraw. Games have no invented player context.

Validate unrecognized books, aliases, malformed numbers, stale/future timestamps, mixed lines/periods/outcome structures, missing draws, duplicate books, source failures, price ties, and exact model binding. Verify mobile layout and browser navigation with deterministic fixtures, then bounded live coverage checks and a staged production release. Only merge/promote after review and passing CI.
