# Sharp Odds Service

Deploy this folder as the Vercel project root.

Odds provider environment variables:
- SPORTS_ODDS_API_KEY — primary SportsGameOdds provider
- SHARPAPI_KEY — secondary SharpAPI provider
- THE_ODDS_API_KEY — tertiary The Odds API provider

At least one odds-provider key must be configured for the market board. When
multiple providers are present, Edge Lab uses the failover chain
SportsGameOdds -> SharpAPI -> The Odds API. A provider that errors or returns
zero usable events does not stop the chain. The MLB props endpoint follows the
same provider order.

Optional The Odds API quota controls:
- THE_ODDS_API_CREDIT_RESERVE — credits to preserve before blocking new paid
  upstream calls (default 50)
- THE_ODDS_API_MAX_PROP_EVENTS — maximum MLB events queried for player props
  per fallback refresh (default 2)

Optional model-data variables:
- BALLDONTLIE_API_KEY — NBA game-history source; game player stats and injury
  enrichment require a BALLDONTLIE tier that exposes those endpoints
- SHARP_MONITOR_TOKEN

Endpoint:
- GET /api/sharp

## Compact market board

Use `GET /api/board` for a small game-market response. The provider chain is
SportsGameOdds -> SharpAPI -> The Odds API; provider identity is surfaced in
`source`, `providersUsed`, and `providerFailures`. The Odds API usage
snapshot is also returned so quota pressure can be monitored. The response
contains only:
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


### NFL player props v2.1

`/api/nflprops` is a shadow-only NFL player-prop challenger covering QB
passing yards/touchdowns, RB rushing yards, and WR/TE receptions/receiving
yards. It is market-first: each sportsbook/line is graded separately and the
independent projection only contributes a provisional, data-quality-scaled
adjustment in shadow output. Production status and production weight remain
`PASS` / `0` until historical market calibration clears the fixed promotion
process.

The shared opportunity engine projects team plays and pass/rush split before
allocating player opportunity. It uses nflverse weekly player stats, PFR snap
counts, Next Gen Stats, timestamped depth charts, team/opponent context, game
market environment, and forecast weather when available. Participation/route
data is not required live, and unavailable injury data never implies a player
is healthy.


NFL player-prop odds use the same resilient provider order as the Edge Lab
board: SportsGameOdds -> SharpAPI -> The Odds API. The fallback adapters
normalize passing yards, passing touchdowns, rushing yards, receptions, and
receiving yards into the same exact book/line contract before grading. The Odds
API remains tertiary and respects the configured credit reserve/event cap.

The 2024 split-development calibration accepts a 0.25 opportunity residual for
passing yards and 0.90 for receiving yards. Passing touchdowns, rushing yards,
and receptions remain baseline-only. These projection weights do not authorize
production betting influence; production weight remains zero pending historical
sharp prop-price validation.

Every historical feature passes through a point-in-time availability guard.
The chronological player-prop workflow replays 2024-2025 for projection-error
validation while intentionally excluding finalized historical weather. It
cannot authorize production weight until historical sharp player-prop prices
are available for 2024 calibration and untouched 2025 market validation.


## NBA shadow models

### NBA team markets v1

Use `GET /api/nbamodel` for the NBA team-market shadow engine. It evaluates
moneyline, spread, and total markets from the shared Edge Lab board. Every
sportsbook and exact line is graded independently.

The independent v1 signal uses rolling scoring margin, points scored/allowed,
home-court advantage, rest days, back-to-backs, schedule density, and 20,000
deterministic simulations. When NBA game history is unavailable the endpoint
degrades to market-only probabilities instead of fabricating team strength.

NBA team markets remain shadow-only: production weight is zero until the 2024
chronological development replay is frozen, 2025 holdout validation is run, and
historical market-price validation is available.

### NBA player props v1.1

Use `GET /api/nbaprops` for the NBA player-prop shadow engine. Supported
markets include points, rebounds, assists, threes made, blocks, steals,
turnovers, blocks+steals, PRA, points+rebounds, points+assists, and
rebounds+assists.

NBA prop odds use SportsGameOdds -> SharpAPI -> The Odds API failover. Exact
book/line pairs are preserved and no-vig probability is calculated from the
same sportsbook when both sides of the same line are available.

When game-level player history is available, v1 combines rolling direct
production, projected minutes, per-minute production, and a conservative
offensive-involvement proxy derived from FGA/FTA/turnovers. Combination props
are built from the same underlying game rows.

Official NBA injury-report PDFs are the availability authority. The service
discovers the latest report, extracts its PDF text, and resolves player status
as Available, Probable, Questionable, Doubtful, Out, Not Listed, or Not Yet
Submitted. Questionable/unsubmitted/unresolved statuses block a shadow PLAY;
Out/Doubtful hard-block it. A secondary injury feed may add context but cannot
override a conflicting official report.

NBA v1.1 adds a conservative game-environment challenger. It preserves the
history-only raw projection and separately evaluates game total/spread, implied
team total, opponent recent points allowed, recent scoring environment, and
rest/fatigue. The full context challenger is capped at +/-5% of the raw stat
mean and receives only 25% shadow weight. Historical development replay must
beat v1 itself before the context layer can be accepted.

v1.1 also adds a downgrade-only market-integrity gate. Exact-line isolation,
stale outlier prices, and severe same-line no-vig disagreement can reduce
quality or block a shadow PLAY, but market integrity can never create an edge or
upgrade a PASS by itself.

A separate role-stability guard compares the recent 3-game minutes role with
the longer 8-game window. A material minutes shift is surfaced explicitly and
caps data quality below the shadow-PLAY threshold until the role stabilizes.
This guard can only downgrade a candidate; it cannot increase the projection or
create an edge.

Every NBA prop remains production PASS / weight 0 until chronological
projection validation, untouched holdout validation, and historical exact
sportsbook-price validation are complete. The Supabase
`capture-nba-player-props` function is deployed but intentionally unscheduled
until `/api/nbaprops` is live in production.
