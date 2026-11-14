# All-book research implementation plan

> Use superpowers:executing-plans, with independent review before merge.

**Goal:** Expand research book coverage and make exact-market price comparisons visible for props and games while both models remain frozen.
**Architecture:** Shared platform catalog and pure comparison helpers; existing APIs and research page only.
**Spec:** ../specs/2026-11-14-all-book-comparison-design.md

## Constraints and review focus

Default model/validation requests unchanged; background quota and bounded pages retained. Fail closed on unsupported platform type, incomplete outcomes, malformed identity/line, unknown timestamps, or settlement mismatch. Do not present a market reference as true/model probability. Preserve NFL exact-quote estimates without allowing broader quotes to change model calculations.

## Tasks

- [ ] Add official platform catalog and all-book NBA/NFL quote research with unknown types excluded from probability calculations. Test omitted filters, explicit filters, quota bounds, strict identity, and unchanged default APIs.
- [ ] Add pure exact-market comparison and game-row normalization. Test matching line/period/outcomes, stale/future/invalid prices, pushes, leave-one-book-out reference, aliases, and thin coverage.
- [ ] Integrate props/games loader and UI using existing APIs; preserve NFL exact quote binding, deep dives, and worksheets. Test failed/stale requests and sport/view changes.
- [ ] Extend browser regression checks, run Node/Python/CI checks, inspect staged mobile/desktop, review patch, and release only validated changes.
