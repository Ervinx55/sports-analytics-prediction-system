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
