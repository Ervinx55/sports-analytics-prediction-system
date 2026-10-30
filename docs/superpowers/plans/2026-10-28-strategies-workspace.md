# Strategies Workspace Implementation Plan
> **For agentic workers:** Use superpowers:subagent-driven-development for independent calculation and account tasks; coordinator integrates and verifies the UI.
**Goal:** Four usable research tools without placing bets or changing model eligibility.
**Architecture:** Pure browser-compatible calculations; protected existing ledger for actual results; static four-tab interface. Provider scans require verified contracts.
**Tech Stack:** Node ESM, native browser DOM, existing account APIs and tests.
**Spec:** docs/superpowers/specs/2026-10-28-strategies-workspace-design.md

## Global Constraints
Free dependencies only; no automatic bets, money transfers or account connections. No private data in public storage. No promised profit. Missing rules, feeds and probability inputs remain explicit. Preserve unrelated SQL edits. Existing isolated worktree feature/private-accounts; production/master untouched.

## Review Focus
- Complete outcome coverage, integer pushes and different settlement rules.
- Monetary rounding, fees, positive lay liability and capital exposure.
- Input probabilities are assumptions, not proof of an edge.
- Corrections/multi-leg entries must not duplicate results.
- Unsupported promos must not display fabricated conversion profit.

### Task1: Calculation contracts
Files: sharp-service/lib/strategies/calculations.js; tests/node/strategy-calculations.test.mjs.
- [ ] Write failing tests for EV with push/fees;2/3way arb including rounding; cash/bonus back-lay scenarios with commission and limits.
- [ ] Implement bounded finite inputs and integer-cent outputs; reject missing outcomes/rules rather than infer a guarantee.
- [ ] Run tests and review. Do not modify model probabilities.

### Task2: Specialty/strategy records
Files: sharp-service/lib/strategies/specialties.js; account validation/UI as needed; tests/node/strategy-specialties.test.mjs, account tests.
- [ ] Add optional versioned strategy metadata to actual entries, default unclassified, validated and preserved across corrections/import.
- [ ] Inspect SQL contract before changes; if schema changes needed read Supabase skill and use new migration, never alter existing user SQL changes.
- [ ] Aggregate settled actual cash/promo separately, corrected records once, multi-leg unallocated unless explicitly classified. Group sport/market/book/strategy; incomplete coverage and missing CLV explicit.
- [ ] Expose result UI via existing signed-in accounts client; never simulate login or assume setup complete.
- [ ] Verify tests and applicable SQL checks.

### Task3: Four-tab interface
Files: sharp-service/strategies.html, strategies.js, strategies.css; navigation links.
- [ ] Build Value, Arbitrage, Promotions and My specialties panels; manual inputs blank, examples only explicitly hypothetical.
- [ ] Present per-outcome net returns, cash exposure, assumptions and unmet requirements clearly. Live scanner remains unavailable without exact verified rule/reference contracts.
- [ ] Integrate specialty aggregation with account login link and read-only snapshot flow.
- [ ] Keyboard/mobile/browser checks; no public persistence.

### Task4: Review and release
- [ ] Independent review, regression fixes, full Node/Python and applicable SQL checks.
- [ ] Logical commits; update draftPR32; preview deploy on existing6ihx project.
- [ ] Verify live UI and report unverified live feeds/account setup blockers accurately.
