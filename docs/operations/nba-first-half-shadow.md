# Edge Lab: NBA first-half shadow engine (v1)

Status: **research-only branch; NOT connected to production BUY/AVOID endpoints or deployed**.
Tracking: [Issue #34](https://github.com/Ervinx55/sports-analytics-prediction-system/issues/34).

## Files
- `sharp-service/lib/nba-first-half-shadow.js`: pure computational module.
- `tests/node/nba-first-half-shadow.test.mjs`: Node test suite.

## Inputs & method
`estimateFirstHalfMargin` takes a *home-minus-away* difference for first-half net rating
and season net rating, first-half sample games, estimated first-half possessions,
manual adjustments (home court, rest, availability, travel), and an **externally
estimated** first-half margin standard deviation. Its regularization weight is
`n / (n + 25)` by default. This is an explicit conservative heuristic, not a fitted
statistical model. Fit adjustment coefficients and variance on historical,
pregame-only data before treating the output as calibrated.

`spreadOutcome` approximates the integer final halftime margin using a normal
distribution with continuity correction. Integer spreads can push, half-point
spreads cannot. `sportsbookEv` returns net expected return per $1 staked.
`comboEv` separately models ticket cost, payout, and explicit win/loss fees;
**do not multiply individual leg probabilities without a validated joint model**.

`evaluateFirstHalfShadow` requires a matching exact price/line and a no-vig sharp
baseline; old quotes, missing data or unconfirmed rotations block candidates.
The only possible research labels are `SHADOW_CANDIDATE` and `AVOID`. Its
`productionDecision` is *always* `DISABLED`, even when externally asserted
`modelCalibrated=true`; no user-facing official BUY can be inferred from this.

## Run checks
From repository root, Node.js 20+: `node --test tests/node/nba-first-half-shadow.test.mjs`

## Next implementation gates
1. Map trustworthy pregame NBA 1H possession/efficiency, rotations and opponent
   data into a timestamped feature pipeline; include source and coverage.
2. Fit coefficients and margin variance with chronological train/test windows,
   then assess Brier/log loss, cover calibration, closing-line value and ROI
   against contemporaneous no-vig Pinnacle/Circa/BookMaker baselines.
3. Integrate shadow outputs into the existing prediction audit ledgers and
   dashboard with immutable quotes, model version and actual halftime scores.
4. Implement exchange fee schedules, settlement semantics, and combo-leg
   correlation instead of a simplistic independence assumption.
5. Review sustained out-of-sample results before a separate, explicit production
   BUY-gate change.

## November 7 historical check (no backdated official predictions)
- Kalshi ticket cost: $35.38.
- Combo legs: Houston 1H -3.5 LOSS; Golden State -3.5 WIN;
  LSU to win by more than 3.5: NO — WIN.
- Realized ticket payout $0 and realized net $-35.38.
- Two of three legs winning does **not** imply a profitable ticket.

## Historical walk-forward audit (Phase 2)

Run:

```bash
node scripts/nba/backtest-first-half-shadow.mjs --input=/secure/path/nba_first_half_history.csv --output=artifacts/nba-first-half-audit.json
```

Required historical CSV columns (one observation per **distinct game ID**, home team point of view):

```csv
game_id,tipoff_utc,quote_checked_utc,sharp_checked_utc,home_spread,sharp_home_spread,american_odds,sharp_no_vig_home_cover,model_captured_utc,pregame_expected_home_margin,pregame_margin_stddev,halftime_home_score,halftime_away_score,rotation_confirmed
```

- Store actual game identifiers, real halftime scores and genuine time-stamped **pregame** model forecasts. Never backfill forecasts from a finished game's performance.
- `home_spread` is the signed home handicap (e.g. -3.5 means home must lead by 4+ at halftime); the quoted `american_odds` must price **that home-cover side**. `sharp_home_spread` must match it exactly; `sharp_no_vig_home_cover` is the corresponding sharp no-vig conditional cover probability (on nonpush results). Do not use a full-game line in a 1H dataset.
- All timestamps include a timezone; the quote and sharp checks must be within 30 minutes before tipoff. Historical coverage, source authenticity, stale data and availability confirmation are independent ingestion responsibilities.
- `model_captured_utc` proves the estimated margin and its standard deviation existed before tipoff, although the importer cannot verify that the underlying features were not revised later. The variance is a pregame input, **not calculated from the game being graded**.
- `rotation_confirmed` must be `true` or `false`. Unconfirmed examples do not contribute to the research model or training set. For the audit, only settled games with complete fields should be supplied.
- The audit trains a residual bias and error-variance correction on observations at least 24 hours older than the evaluated game. It deliberately requires at least 30 earlier qualifying rows by default.
- Outputs: evaluated and skipped counts, Brier/log loss for model and sharp, reliability buckets, research-only candidate ROI, individual predictions and outcomes. Pushes are excluded from binary accuracy scoring but retained in ROI.
- **No genuine historical NBA 1H odds dataset has been attached to this branch.** Synthetic fixtures in unit tests validate code only and are not evidence of betting performance.
- Even favorable historical metrics do not enable production trading; code always remains shadow-only until further validation and explicit approval.

## Historical source collection (Phase 3)

The collector is intentionally **read-only and staged**:

```bash
node scripts/nba/collect-first-half-history.mjs --date=2025-11-07 --scores-only --output=artifacts/nba-half-scores.json
```

For licensed event-odds history, set `THE_ODDS_API_KEY` **only in a private runtime environment** and explicitly opt into billable API requests:

```bash
node scripts/nba/collect-first-half-history.mjs --date=2025-11-07 --historical-odds --regions=us --max-events=10 --output=artifacts/nba-half-odds.json
```

- Halftime scores are derived from quarters 1 and 2 in ESPN scoreboard data, not NBA official statistics. Confirm source coverage independently before using scores for authoritative grading.
- Odds provider: The Odds API v4 paid historical **event odds**, market **`spreads_h1` only**, using a historical snapshot requested 20 minutes before each game's provider-supplied start time. Each quote preserves its provider timestamp.
- Events are discovered from a snapshot at 12:00 UTC on the requested date; coverage can be incomplete for late local-time tipoffs and events not on that discovery snapshot. The result explicitly reports unmatched events; this stage is **not an exhaustive season ingestion pipeline**.
- A matching algorithm requires uniquely matching home/away team names and close tipoff times. Ambiguous games are not guessed.
- This collector does not manufacture model predictions, sharp fair probabilities, injury/rotation confirmations, or backtest-ready rows. Those require **separate, genuinely pregame-stored** records.
- The paid command consumes The Odds API historical request quota. No key is embedded in code or CI and test mocks do not make paid requests.
- Current repo/connected database has no qualifying NBA first-half price+model+halftime record set; don't report a historical ROI until authenticated data collection and matching are verified.

Data source documentation: https://the-odds-api.com/liveapi/guides/v4/ and https://the-odds-api.com/sports-odds-data/betting-markets.html.
