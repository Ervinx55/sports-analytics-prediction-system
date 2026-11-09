# Edge Lab vNext — Probability Lab

## Scope
This is an **offline-safe, shadow-only research upgrade** to the existing
\`sharp-service\` Vercel app. It does not make purchases, enable auto-wagers,
claim positive expected value, or create calibrated forecasts where no
approved model exists.

Dashboard path, once deployed: \`/edge-vnext\`
API endpoints: \`/api/edge-vnext\` (GET, read-only).

## Features introduced
- **Provenance-first model board.** \`GET /api/edge-vnext?mode=board\` makes no
  odds-provider requests. A deliberate user click issues
  \`?mode=board&live=1\` which fetches the existing \`/api/nflmodel\` endpoint.
  That existing NFL v3 output is explicitly marked market-anchored shadow;
  market-only moneyline/spread outputs must NOT be described as independent
  Edge Lab confidence estimates. Missing, stale, failed and already-started
  games are not marketed as current picks.
- **NBA independent BASELINE (research only).** The original main prediction
  database had zero November 8, 2026 forecasts (last global performance
  capture October 29). New `/api/edge-vnext?mode=nba&live=1` explicitly
  requests up to 22 public ESPN scoreboard dates, builds schedule-adjusted
  margin ratings from prior completed games, and estimates win probabilities
  independent of sportsbook odds. Requires 4 games per team and at least
  19 successful historic scoreboards out of 21; otherwise returns unavailable.
  This model is NOT calibrated, contains no injury or rotation adjustment,
  has no sharp-price validation, and always labels outcomes AVOID.
  It does not write production predictions into Supabase.
- **Discrete alternative thresholds.** Pure functions validate complete
  discrete probability mass, distinguish 5+, >5 and 5.5 thresholds, account
  for pushes, and offer a Poisson scenario for explicit **count** means.
  It is not a calibrated NBA rebounds, NFL yards or winning margin model.
- **Sportsbook price math.** Conversions from American odds and fair two-way
  no-vig probabilities, with push-aware expected value.
- **Kalshi contract math.** Expected value using the actual contract ask
  price, contract count and explicit transaction fees. Always check
  settlement rules and fees from the contract before relying on this.
- **Combo dependence.** Without validated correlations, report rigorous
  Fréchet lower and upper bounds; never multiply correlated legs to claim
  accurate combo winning odds.
- **Position ledger.** Reconcile costs, payouts, net profit and ROI from
  settled user-entered positions. No DB write and no private user positions
  committed in the repository. Include losses and overlapping tickets.
- **BUY gate.** All outcomes default to AVOID / shadow. Even if a user inputs
  high probabilities, production BUY is never enabled. The gate requires
  independent proof, calibration, timestamps, source health, margin and
  human approval before allowing a hypothetical manual review.

## How to verify locally
From repository root:

\`\`\`sh
node --check sharp-service/lib/edge-vnext.js
node --check sharp-service/lib/edge-vnext-board.js
node --check sharp-service/api/edge-vnext.js
node --check sharp-service/lib/nba-vnext-baseline.js
node --check sharp-service/lib/nba-vnext-backtest.js
node --check scripts/edge-lab/daily-nba-vnext.mjs
node --test tests/node/edge-vnext.test.mjs tests/node/nba-vnext-baseline.test.mjs tests/node/nba-vnext-daily.test.mjs
\`\`\`

On Vercel, \`/edge-vnext\` serves the new UI and \`/api/edge-vnext\` serves
calculation endpoints. \`/api/nflmodel\` can consume provider requests when
manually refreshed. A separate historic The Odds API test was already
prepared; do not make billable requests without checking entitlement and
available quota.

## Roadmap for full production capability
1. **Provider audit / historical ingest.** Finish the one-event historical
   entitlement and quota test, and verify licensed coverage of Pinnacle,
   Circa and BookMaker for the specific market, line and timestamp.
2. **NBA model.** Build reliable independent pregame projections using
   season-to-date pace, projected minutes, injury-adjusted rotations,
   on-court roles and schedule-strength-adjusted defense vs position.
   Historical holdout backtest against a contemporary market baseline.
3. **NFL model pipeline.** Restore/verify nightly data freshness, source
   entitlements, timestamped daily forecasts, and injury validation.
   Current NFL model is market-anchored; this upgrade exposes, rather than
   hides, that limitation.
4. **Alternative lines.** Produce calibrated discrete player-stat and
   margin-of-victory distributions (including integer push mass) using
   historical actuals. Only then compute independent probabilities.
5. **Kalshi combos.** Capture contract rules, fees and execution prices,
   estimate **joint** probability via dependence validated on held-out
   games, and avoid double-counting shared legs.
6. **Audit and release.** Freeze pre-event forecasts, score Brier/log loss,
   reliability buckets, cost-adjusted ROI and walk-forward CLV. Validate
   source provenance, licensing, sharp market matching and drift before
   a manual production review. Never auto-enable BUY.

## Cost policy
This change adds **no paid subscriptions** or scheduled provider calls.
The initial development budget was capped at $150, but no service purchase
is required to test the offline components. Never commit provider keys.
