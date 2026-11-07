# Research Board Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, task by task.

**Goal:** A usable NBA/NFL research board backed by existing Edge Lab APIs.
**Architecture:** Pure quote normalization plus static accessible UI. Existing endpoints remain authoritative; research shortlist is explicitly session-only.
**Tech Stack:** Node ESM, native browser modules, current Vercel static hosting.
**Spec:** docs/superpowers/specs/2026-10-25-research-platform-design.md

## Global Constraints
No paid upgrades, no fabricated evidence, no private credentials, no production influence changes. Preserve unrelated worktree changes. NBA quote-only rows cannot receive prediction probabilities. Shortlist is not a bet or settled result.

## Review Focus
Missing/future/stale timestamps must not appear fresh. Malformed/empty API output cannot imply PASS. Sport-switch races must not restore old rows. Null odds/probabilities remain unavailable. Quote identity must retain book/line/side so alternative lines never merge.

### Task 1: Research data contract
Files: sharp-service/research-data.js, tests/node/research-data.test.mjs.
- [ ] Write failing tests for NBA quote identity, NFL shadow estimates, timestamps, filtering and missing data.
- [ ] Implement normalizeResearch(data,sport,now) and filterResearch(rows,filters); no mutation of model decisions.
- [ ] Run targeted and full Node tests.

### Task 2: Research interface
Files: sharp-service/research.html, research.js, research.css; navigation in dashboard.html, nba.html, nfl.html, accounts.html.
- [ ] Implement responsive board and details using safe DOM text nodes, bounded rendering, session shortlist and clear source status.
- [ ] Guard fetch races and timeouts; refresh freshness periodically; no private data storage.
- [ ] Exercise local render/controller tests, browser validation where available, and full Node/Python suites.

### Task 3: Review and release gate
- [ ] Review scoped changes and fix findings; commit logical work.
- [ ] Deploy only after preview/production acceptance. Report browser or hosted setup blockers; do not claim release from unit tests alone.
