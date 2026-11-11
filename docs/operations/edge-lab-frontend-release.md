# Edge Lab frontend release source

Canonical site: https://sports-analytics-prediction-system-tau.vercel.app
Vercel project: sports-analytics-prediction-system-6ihx (prj_Rwlfunz2wnlTfXEOkhfVPOCyIV5z).
Team: ervinemanuel-4011s-projects. Root directory: sharp-service. Git production branch: master.

## Source reconciliation, 2026-11-11
The older bookmarked 4ojrjejjg deployment is a preview of feature/private-accounts at bd615f9. It is not the production source. The canonical alias was verified on production e2c3a7e; master 3e7ab79 additionally contains database-read repairs. Several richer static frontend files existed only in the preview branch.

This release starts from master 3e7ab79 and restores only static research/NBA pages and their browser dependencies, plus expandable evidence explanations. Backend functions, model code, validation protocols, approval gates, migrations and collectors are unchanged. The legacy preview NBA team-model endpoint is deliberately not requested because it does not exist in master; the page explicitly says so and shows reviewed live prop decisions and current quotes instead. Existing master research routes remain available. Preview-only accounts and strategies links are not added to production without their backends.

Future frontend releases must branch from master. Never promote feature/private-accounts wholesale: it also contains unrelated backend/model changes. Keep old immutable preview URLs as historical snapshots and use the canonical site for current releases.

## Verification
- Master-based Node suite: 166 passing tests.
- Browser regression: NBA live disclosure stays open across its one-second rerender; recorded evidence shown; research refresh preserves expansion; 390px layout has no horizontal overflow; NFL native disclosure works from keyboard; dashboard modules load with no page exceptions.
- Browser fixture uses synthetic data and intercepts API calls; it does not collect prices, publish forecasts, or change model approvals.
- Run browser tests from repository root: install tests/browser dependencies, then `node tests/browser/deep-dives.mjs`. `EDGE_LAB_BROWSER_PACKAGE` can select an existing installed package root. Screenshots are written outside the worktree.
- Stage a production-environment deployment with `--prod --skip-domain`, inspect its source/environment, verify hosted pages, then promote that tested build. Record final URL/commit separately after verification.
