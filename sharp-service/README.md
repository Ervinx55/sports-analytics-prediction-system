# Sharp Odds Service

Deploy this folder as the Vercel project root.

Required environment variable:
- SPORTS_ODDS_API_KEY

Optional:
- SHARP_MONITOR_TOKEN

Endpoint:
- GET /api/sharp

## Compact market board

Use `GET /api/board` for a small game-market response containing only:
- matchup and start time
- moneyline
- spread / run line
- total
- 3-way moneyline where applicable
- consensus / fair prices
- opening and closing prices when available
- book-by-book prices

Examples:

`/api/board?leagues=MLB`

`/api/board?leagues=MLB&books=draftkings,fanduel,betmgm,caesars`

`/api/board?leagues=NFL,NCAAF`


## NFL shadow model

Use `GET /api/nflmodel` for the NFL team-market shadow engine. It evaluates
moneyline, spread, and game total markets from the existing sharp board and
combines those prices with an independent nflverse-based team-strength model.

The independent model uses recent scoring margin, offensive/defensive EPA per
play, yards per play, turnover margin, rest, home/neutral site, and 20,000
deterministic game simulations. Early in a season it intentionally stays close
to the market: the independent weight begins at 25% and increases with shared
current-season games, capped at 50%.

NFL v1 is shadow-only. Every market receives a shadow PLAY/PASS grade, but the
production status remains PASS and production weight remains zero until
chronological backtesting and calibration gates are added.


### NFL availability and environment v2

NFL v2 adds current daily nflverse depth charts, expected-QB continuity,
roof-aware weather handling, and Open-Meteo forecasts for outdoor/open-roof
games. Weather adjusts only the independent total projection and is capped at a
small range before the projection is blended back toward the sharp market.

nflverse's injury source is not used for current-season adjustments because its
published status says that feed ended after 2024. The API surfaces this as
`sourceHealth.injuries.status = "UNAVAILABLE"` and applies zero stale-injury
penalty rather than silently treating old data as current.


### NFL out-of-sample calibration v3

The initial v2 independent blend underperformed the closing market in the
2024-2025 chronological replay, so it was not promoted. A second calibration
pass used 2024 only to choose shrinkage and kept 2025 untouched.

The selected shadow shrinkages are:

- moneyline: 0.00 (market probability only),
- spread: 0.00 (market probability only),
- total: 0.25 of the dynamic independent contribution.

The 2025 total improvement was positive but very small and did not clear the
promotion gate, so all NFL markets remain production-ineligible. The independent
team model is retained for projected scores, diagnostics, and future challenger
work rather than being allowed to degrade current moneyline/spread probabilities.
