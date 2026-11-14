# NBA sharp bookmaker collection

The bounded NBA quote endpoint requests the established sharp reference books
Pinnacle (`pinnacle`), Circa (`circa`) and BookMaker (`bookmakereu`), plus DraftKings
and PrizePicks. Provider IDs are documented at
https://sportsgameodds.com/docs/data-types/bookmakers.

- One combined bookmaker filter, not one request per bookmaker. Pagination stays
  capped at two pages of 16 events, and cache/polling intervals are unchanged.
- Matching event/player/market/line/side quotes retain each book's own price and
  timestamp. Different lines never form a single artificial over/under pair.
- PrizePicks is a DFS comparison target, not a sharp sportsbook. Its lines are
  returned separately in `comparisonLines`, with `pricingEligible: false`, and displayed as comparison-only cards in the research UI.
  No American price, fair probability or single-leg EV is fabricated for DFS.
- `coverage.bookmakers` is the requested set; `observedBookmakers` and
  `bookmakerCoverage` report what the response actually contained. `NOT_OBSERVED`
  does not mean unsupported or absent from the subscription, only absent from
  this bounded response. Page coverage and overall partial coverage remain explicit.
- Missing/failing providers do not relax production eligibility, calibration,
  freshness or automatic-BUY gates. The endpoint remains research-only.

Game-level board routes already accept arbitrary provider bookmaker filters; this
change fixes the dedicated NBA prop route, which previously discarded other books.
It does not add every sportsbook to the sharp consensus or alter reference weights.

## Rollout verification

Before deployment, verify account coverage and quota using one bounded upcoming-NBA
request. Record actual books returned and source timestamps rather than treating a
provider announcement as entitlement evidence. A no-quote result is inconclusive
when the slate/market is unavailable. Verify object quota remaining before raising
collection frequency. This patch does not raise frequency and retains existing
provider-protection request controls. The dedicated route now invokes the shared
object-limit optimizer with a two-page fanout; exhausted quota prevents upstream
quote requests and reduced page limits remain explicitly partial.

Local fixture tests verify multi-book merging, distinct lines, missing-book reporting,
DFS separation, two-page bounds, cache timestamps and unchanged production gates.
Live account coverage is not established by those fixtures.

## November 14 validation

At 04:42 UTC, the deployed provider status reported Pro, 300 requests/minute,
3,000,000 daily objects and 2,998,111 remaining (LOW pressure). Two bounded
existing sharp-route probes, limits 1 then 4, returned only DraftKings game
quotes across the available upcoming NBA events. They returned no Pinnacle,
Circa, BookMaker or PrizePicks quotes; absence is not proof of no entitlement.
Do not advertise these books as live until observed. No paid plan changes.

Local tests: 212 Node and 78 Python passing; secret scan and diff checks passed.
Browser fixture: tests/browser/sharp-books.mjs. Execution was blocked before
assertions because Chromium could not create a socket in this runtime. Browser
verification remains outstanding, so this is not a verified production release.
