# Edge Lab Strategies workspace
Status: proposed design for user approval. User selected one integrated workspace.
Date: 2026-10-28.

## Purpose and presentation
Add four tabs to a single Strategies page linked from research and Accounts & Profit: Value (+EV), Arbitrage, Promotions, and My specialties. Keep the charcoal/violet theme and plain-language style. Each result leads with what was calculated, why it matters, required cash/exposure, freshness and what is unverified. Calculations are not placed wagers or model PLAY decisions. Preserve existing production model gates.

## Value (+EV)
Compare an offered exact-market price against an independently identified reference probability: verified current sharp-book pair, validated model, or explicitly user-entered assumption. Do not use the offered book's own devigged pair as independent proof of value. Label estimated EV, probability source and uncertainty; unknown reference means no EV signal. Never relabel SharpAPI (a data provider) as a sharp bookmaker. Pinnacle availability must be verified from actual feed entitlement and payload.

For a cash bet with decimal odds d and win probability p, EV per unit = p*(d-1) - (1-p), excluding separately modeled pushes/fees. For integer lines, require push probability or clearly label conditional-on-no-push EV; do not claim unconditional cash returns from conditional probabilities. Show probability gap separately from expected ROI. Support manual what-if inputs without turning an unvalidated estimate into a cleared play. Expire both sides of a reference pair.

## Arbitrage
Identify only complete, mutually exclusive outcome sets for the same event, market, period, line and settlement rules. Two-outcome and three-outcome calculators are supported; soccer draws cannot be omitted. Different lines are not ordinary arbitrage. Same integer line pushes and void scenarios must be displayed.

For complete standard decimal-odds outcomes, q=sum(1/d_i). q<1 indicates theoretical arbitrage before fees/rules/execution costs. Allocate a user-entered total across outcomes, round stakes to supported currency increments, and recalculate net return for every scenario after rounding, fees and supplied limits. Show worst-case modeled profit and required cash. Unknown rules, limits or executable prices remain unverified. No guaranteed-profit label. Provider-fed matches require exact canonical identities; otherwise use clearly manual calculator mode. No automatic placement.

## Promotions and matched betting
Provide a manual promotion worksheet with provider, offer type, eligible stake, expiry, minimum odds, stake-returned status, payout cap, qualifying cash cost, commissions and wagering restrictions. Show supplied terms and unsupported conditions explicitly; do not invent available promotions or eligibility.

Initial calculators: cash back/lay hedge and single stake-not-returned bonus bet with an explicitly supplied lay price, commission and available size. Compute both win/loss scenarios, lay liability and total cash tied up. Commission calculation assumes this isolated exchange market; existing positions/market-level netting require a separate reconciliation. Deposit matches, rollover offers, multi-leg boosts and refund-if-loss offers with further conditions remain worksheets until their full payout rules are modeled; no false cash-conversion figure. Kalshi is not automatically interchangeable with a lay exchange; PrizePicks/Underdog entry payouts are not sportsbook single-bet odds.

Promotion profit remains separate from cash betting ROI and deposits. Link a calculation to a manually confirmed account entry only through existing protected account setup. No public personal account data or invented connection status.

## My specialties
Filters and performance by sport/league, market, bookmaker and strategy, with sample count, settled wins/losses, profit, ROI and closing-price comparison where archived evidence exists. Separate actual user wagers, model/shadow results and hypothetical opportunities. Multi-leg entries count once and require explicit assignment or an unallocated group, not full profit credited to each leg. Do not label a niche profitable or validated from a tiny sample. Missing supported strategy metadata/history shows unavailable; no zero-filled leaderboard.

Add versioned strategy tags and calculation references to account records only with backward-compatible validation/storage changes and RLS regression tests. Existing entries default to unclassified. No retrospective model prediction creation from user wagers.

## Sources, scope and operational limits
Current code supports per-book prices and manual account accounting. Live Pinnacle coverage, exchange depth/limits, cross-book settlement rules, promotion feeds and complete strategy-tagged history are not verified. Reuse existing free provider chain and cached responses; no new paid plan or scraping private sportsbook accounts. No betting, exchange orders, transfers or account credential collection.

Research remains read-only. User can enter hypothetical prices and amounts. Manual data is labeled user-supplied and not persisted publicly. Calculators remain usable when provider feeds fail; live opportunities show unavailable or stale instead of fabricated results. No background monitoring is introduced.

## Delivery and verification
1. Implement pure money/odds/EV/arbitrage/promotion calculations with tests for roundoff, pushes, fees, missing outcomes, invalid probabilities, stale quotes, incompatible identities and unsupported rules.
2. Build the four-tab workspace with plain-language results, manual examples explicitly marked hypothetical, expandable math/source notes, and mobile/keyboard checks.
3. Wire only verified feed contracts; keep unmet data requirements visible. Add specialty aggregation and protected strategy metadata without mixing promotional/actual/shadow outcomes.
4. Run full Node/Python checks and relevant account SQL fixtures; independent review of math/data integrity; hosted preview acceptance.
5. Update the existing draft PR and publish a validated preview. Production promotion and model influence remain separate decisions.

## References reviewed
- https://establishtherun.com/four-ways-to-win-as-a-beginner-sports-bettor/
- https://betherosports.com/blog/best-sports-betting-strategy
- https://support.betfair.com/app/answers/detail/a_id/417/ (lay liability)
- https://support.betfair.com/app/answers/detail/a_id/413/ (commission)
- https://support.betfair.com/app/answers/detail/a_id/10620/ (market and settlement rules)
Marketing profit guarantees in secondary references are not adopted.
