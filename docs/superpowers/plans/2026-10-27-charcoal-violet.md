# Charcoal and Violet Implementation Plan
> Execute inline using superpowers:executing-plans.
Goal: apply the selected visual theme consistently to five Edge Lab pages.
Architecture: shared CSS tokens and scoped overrides; existing controllers unchanged.
Tech stack: HTML and CSS.
Spec: docs/superpowers/specs/2026-10-27-charcoal-violet-design.md
## Constraints
Preserve model decisions, account access controls and hidden/loading states. No paid services or dependencies.
## Review focus
Check text contrast, selected navigation, semantic result colors, narrow layouts and focus visibility.
## Tasks
- [ ] Add shared stylesheet and connect all five pages.
- [ ] Run existing regression suite and inspect hosted dashboard/research/accounts.
- [ ] Commit and publish preview; retain production release gate.
