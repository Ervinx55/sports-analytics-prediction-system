# Team scoring context

## Goal

Show each team's historical points scored and points allowed beside existing NBA, NFL and CFB game estimates. Include recent five- and ten-game samples, source, cutoff and actual sample sizes. This implements the user's requested team averages while preserving the frozen live NBA/NFL models.

## Architecture and constraints

- A pure helper computes descriptive averages from the already-loaded verified score history, after inference. No extra provider calls are required.
- NBA uses the loaded prior 21-day window, NFL uses the current regular season, and CFB uses current-season FBS opponents. Labels describe this coverage rather than implying complete league or full-season coverage.
- Each target has its own pregame cutoff. Exclude the target, future/incomplete games, conflicting identities and invalid scores. Preserve zero scores. Apply NBA prior-slate, NFL prior-date/week and CFB delayed-completion rules.
- Missing samples remain unavailable. Points per game are distinct from possession-adjusted ratings, projected scores and win probabilities.
- Do not change model coefficients, pinned source artifacts, probability calculations, approval gates, immutable historical captures or production influence. Existing NFL weighted scoring inputs must not be counted again.
- Use a shared accessible renderer for compact both-team summaries and expandable evidence, including mobile layouts.

## Implementation and validation

1. Add failing unit tests for oriented scores, cutoff/season/window rules, partial samples, zero/missing values and duplicate/conflicting history. Implement `team-scoring-context.js`.
2. Attach context to NBA vNext report rows, NFL model events/markets and CFB forecast response rows outside inference.
3. Add renderer tests and integrate NBA/NFL research estimates, NFL cards and CFB research explanations. Verify exact event joins and safe text handling.
4. Exercise desktop and 390px browser fixtures with missing and partial data; verify original probabilities and research/PLAY-PASS states stay unchanged.
5. Run Node and Python suites, reconstruction secret scan and relevant browser regression suites. Review the diff and pinned model artifacts.
6. Commit the scoped changes on a master-based branch, create/update the PR, and stage a production-environment deployment only after validation. Verify the exact hosted build before promotion. Record any release/access blocker accurately.
