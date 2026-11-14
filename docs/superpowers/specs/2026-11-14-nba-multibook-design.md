# NBA multi-book research coverage

User authorization: expand NBA props to Bovada, PrizePicks, Underdog and Kalshi with correct price/payout checks, keeping both models frozen. This design records implementation choices within that request; no new model approval or account integration is implied.

## Approach

Add an explicit `view=research` path to the existing NBA props endpoint and route the research board to it. Keep the existing default DraftKings collection and `nba-direct-props.js` unchanged. Expanding that collection would change the validation cohort; a second API function would unnecessarily consume a deployment function slot. The additive research path is the selected engineering approach.

## Source and identity

Use SportsGameOdds with only draftkings,bovada,prizepicks,underdog,kalshi; points, rebounds and assists; full-game over/under. Request main lines, preserve distinct line/book/side identities, exhaust at most two 16-event pages in a 48-hour window. Reject started/final/cancelled games and malformed player identities; bind context only with verified event roster IDs. Require explicit availability. Report missing books and partial pagination, never infer availability from entitlement.

## Platform checks

- Sportsbook: retain actual American prices; compare only explicit available, nonfuture, <=5-minute-old same-book opposing prices at the exact same line. Withhold unconditional percentages on integer lines because a push is possible. No validated probability is fabricated; no new PLAY authorization.
- DFS: retain provider indicative odds only as provenance. Do not derive no-vig or single-bet break-even probability from them. Display the line and require actual entry mode, payout schedule, correlation/promotion adjustments and DNP/tie rules. Provide a session-only payout worksheet accepting the entry's actual return multipliers. Calculate net return by outcome, and joint all-hit break-even only for an all-or-nothing cash entry; never multiply marginal probabilities or label the worksheet +EV. User-entered terms are not provider verified. Flex EV remains unavailable without joint outcome probabilities.
- Exchange: preserve the indicative quote and distinguish it from an executable ask. Require exact contract/outcome binding, current executable price, size/depth, fee and settlement rules before a cost comparison. The current SGO samples have no ticker, depth or fee information; expose each missing field and withhold probability/EV. Do not guess a Kalshi ticker from player names.

## UI and invariants

Book filters include all five requested books even when empty. Show per-book returned counts, missing coverage and source time. Cards/detail panels use platform-specific wording, direct blocking reasons, and a DFS worksheet. No field should call a DFS indicative price ordinary sportsbook odds. Freshness checks rerun as time advances. Session shortlist identities include book, side and exact line.

No changes to model coefficients, weights, algorithms, approvals, snapshots, validation writes, collectors, cron, historical outcomes or enrolled forecasts. No account credentials or bet placement. Existing source-only default API contract remains covered by regression tests.

Review resolutions: research calls use background priority and a distinct consumer, with 60-second cache and five-minute stale limit. DFS multipliers represent gross cash return including stake; the worksheet excludes voids/ties/reboots, bonus funds, variable pools and payouts depending on which pick misses. Users explicitly confirm that the entered schedule applies to every combination with the same correct count. Any-miss return must be zero for the joint all-hit break-even calculation. No provider verification is claimed for entered terms.

## Validation and release

Behavior tests cover separate research/default upstream requests, pagination and bounded errors, all five books, distinct lines, explicit availability, future/stale timestamps, malformed player/market IDs, missing books, no DFS/exchange no-vig math, payout arithmetic and incomplete schedules. Run full Node/Python suites and secret scan. Test real provider payload and browser desktop/mobile, stage hosted production build, then merge/release only after CI and hosted checks pass.

## References checked 2026-11-14

- https://sportsgameodds.com/docs/data-types/bookmakers
- https://www.prizepicks.com/help-center/payouts (entry-specific payouts vary; DNP/reboots can revert lineups)
- https://help.underdogsports.com/en/articles/13780101-pick-em-standard-flex-entry-payouts (official search excerpt; direct page returns HTTP 403)
- https://docs.kalshi.com/api-reference/market/get-market (contract rules, bid/ask dollars and size)
- https://docs.kalshi.com/api-reference/market/get-series (fee type/multiplier and settlement sources)
