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
