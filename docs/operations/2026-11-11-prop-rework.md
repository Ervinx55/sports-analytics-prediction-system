# NHL prop rebuild and cross-sport tuning

Status: price-validation patch and audit completed in this branch. No new model has been trained, promoted or deployed by this change. All analysis remains shadow-only. No paid provider requests, purchases, wagers or schedule changes are part of this work.

## Findings from the current source

- The shared `decisionGate` previously checked model versus fair-market probability without requiring the offered sportsbook price. At 59.9% win probability, a -170 quote has expected ROI of about -4.86%, even if the model exceeds a 56% market estimate. The patch requires actual odds and positive EV above the configured minimum, default 3%. The minimum is an operating policy, not a validated optimal threshold.
- The inspected repository has MLB and NFL prop paths and NBA quote infrastructure, but no dedicated NHL player-prop forecasting or calibration implementation. Generic NHL team-market odds support does not establish an NHL prop model.
- The vNext NFL board explicitly remains market-anchored research. Its adapter does not receive verified unconditional win/push mass, so the patch withholds price EV when push mass is unavailable. It must not silently assume zero pushes for integer lines.
- Response generation time no longer substitutes for an observed quote timestamp in the vNext adapter. Missing quote timestamps remain missing. All gate callers must supply push mass explicitly, including zero for a verified push-free market.
- A current workbook search did not locate an NHL prop result series. This is not proof that no history exists elsewhere. No sport-level ROI ranking, win rate, model retraining or calibration improvement is claimed from the conversation examples.

## Immediate selection policy

NHL player props are research-only until their individual market models pass the validation process below. NHL moneylines, puck lines and totals are evaluated separately; a prop failure is not evidence that every NHL market fails.

For every sport, archive the exact pregame event/player/market/side/line, offered price, settlement rules, source timestamps, model version, expected opportunity, probability and decision. Keep research candidates, released shadow selections and actual user tickets distinct. Never retrospectively label an avoided winner as a released pick. Never change a selection's line after results arrive.

Maintain two rankings: probability of winning and expected return at the offered price. Missing data, unavailable prices or unvalidated forecasts produce AVOID with a concrete reason. A favorable defensive ranking alone does not establish a price edge. Evaluate both overs and unders; do not reverse a failed over automatically.

## NHL: rebuild by market

| Market | Opportunity and distribution inputs | Required checks |
| --- | --- | --- |
| Shots on goal | Individual attempts per 60 minutes, on-target rate, even-strength and power-play ice time, linemates, recent role, opponent shot suppression and blocking | Confirm line and power-play assignment; reconcile official SOG definitions; compare Poisson with an overdispersed count distribution on held-out dates |
| Goals and points | Individual shot quality, expected team scoring, power-play role, linemate involvement and goalie | Separate scoring/assist models; no goals/points probability inferred from shot volume alone |
| Assists | Passing involvement, teammate shot quality and finishing, power-play role | Model dependence on teammate scoring; avoid treating assists as independent of linked goals/points legs |
| Goalie saves | Confirmed starter, opponent shot-on-target distribution, expected workload and save probability | Allow for early removal, empty-net time, game state and book settlement rules |

For SOG, a transparent starting expectation is the sum across playing situations of projected minutes times individual attempts per minute times on-target probability. Test role-matched historical rates with shrinkage toward longer-run data. Do not choose weights from yesterday's result. Account for opponent/context effects once; avoid double counting an adjustment already built into a rate.

Model low/central/high ice-time scenarios rather than forcing one workload. Report probabilities for each exact line (2.5 and 3.5 are different contracts). Record the median and tail probabilities; an average above the line is not a calibrated chance of clearing it. Confirming a goalie is context, not automatic evidence for a shots over. NHL defines a shot on goal by whether it scores or would enter the net absent a goalie stop; misses and blocks are not SOG.

Official definition: https://www.nhl.com/info/hockey-glossary

## Other sport adjustments to evaluate

| Area | Tuning priority |
| --- | --- |
| NBA scoring / threes | Project minutes and attempts separately; use lineups and on/off role evidence for returning teammates; normalize overtime-heavy samples |
| NBA rebounds / assists / combos | Rebound chances and potential assists alongside minutes; possession and shot mix; joint distributions for PRA and P+R; reduced-minute blowout scenarios |
| NFL / CFB receiving and passing | Route share, target share, catchability, pressure and protection, QB continuity; competitive/leading/trailing scenarios; trailing does not guarantee efficient passing |
| Team totals and spreads | Expected possessions or drives, offensive efficiency, opponent defense, availability, rest and environment; check how much is already reflected in current odds |
| MLB | Preserve the separate core; workload, confirmed lineup, handedness, park/roof, weather and bullpen availability; evaluate changes on historical pregame data |

Defense-versus-position ranks are secondary evidence. Normalize for pace, opponents and role definitions, shrink small samples, and document the source date. Positional labels alone do not represent the actual assignment or shot profile.

## Price, correlation and validation

1. Use Pinnacle, then Circa, then BookMaker when the exact market is available. Match event, player, line, period, settlement terms and timestamp before removing vig. Disclose missing sharp coverage. A retail-only comparison is not the requested sharp consensus.
2. The shared sportsbook gate uses unconditional win mass and push mass for EV, and conditional-on-no-push probability to compare with a two-sided no-vig market. Do not feed conditional probabilities as unconditional ones. PrizePicks entries require the actual entry payout/void rules and joint probability; Kalshi requires contract terms, fill price and fees. Neither is priced by inventing per-leg sportsbook odds.
3. Freeze pregame forecasts and role assumptions. Reconcile official results without dropping losses, voids, missing settlements or all records with unavailable CLV. Log missingness explicitly.
4. Split chronologically: train on older games, choose features and thresholds on development dates, and evaluate once on untouched later games. Keep players from the same event in one fold. All features and reference odds must have been available at capture time.
5. Report sample size, Brier score/log loss, reliability, offered-price ROI and exact-market CLV separately for SOG, saves, goals, assists, points and team markets. Use game/day-clustered uncertainty intervals. Do not pool NHL with stronger sports to hide a failing segment.
6. Compare with the paired no-vig market baseline on the same rows. Release criteria and minimum evidence requirements must be set before the holdout is opened; a hot streak or fixed number of wins is not validation. Promotion remains disabled until the evidence is reviewed.

## Remaining work

The missing pieces are an immutable NHL prop forecast/result history, verified per-situation player opportunity feeds, timestamped exact-line odds and calibration results. This patch does not supply those data or claim a trained NHL model. The next implementation phase is an NHL data collector and held-out evaluation, beginning with SOG, followed by saves and scoring props only when their own evidence supports them.
