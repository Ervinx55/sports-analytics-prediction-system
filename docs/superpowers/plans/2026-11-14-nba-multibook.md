# NBA multi-book research implementation plan

Goal: expose requested platforms and truthful price/payout readiness without changing the frozen validation collection.

Architecture: additive research branch in `api/nbaprops.js`, bounded native SGO normalization in `lib/nba-research-props.js`, shared browser-safe checks in `prop-price-checks.js`, existing research renderer and loader. JavaScript ES modules, Node tests, existing Vercel project.

1. [ ] Add failing behavioral tests for `researchPropsResponse({now,key,fetchPage})`: five requested books, native identity preservation, different lines, two-page bound, source times, unavailable/malformed rows; retain default DraftKings tests.
2. [ ] Implement research-only collector and API dispatch; return coverage per book and no production weight. Preserve context binding and default route.
3. [ ] Add failing tests for `assessPropQuote({book,quote,opposite,generatedAt,now})` and `checkDfsPayout({book,mode,stake,picks,multipliers,termsReviewed})`: exact fresh pair vs missing, no DFS/exchange probability, missing terms, complete schedules, net payouts and joint all-hit threshold.
4. [ ] Implement platform checks, integrate normalization and age refresh, and preserve independent NFL behavior.
5. [ ] Route NBA research loader to explicit research view. Render platform labels, missing coverage, per-card price/payout blockers and session-only DFS worksheet; retain all requested books in filters. Test loader and normalization with mixed platform fixtures.
6. [ ] Run full Node and Python suites, secret scan, source diff review and frozen-file comparison. Verify live-shaped payload and desktop/mobile browser. Commit logical patch; CI, staged hosted endpoint and UI checks before release. Record actual observed versus missing platform coverage.

Use the existing isolated worktree; execute sequentially. No new dependencies or database migrations.
