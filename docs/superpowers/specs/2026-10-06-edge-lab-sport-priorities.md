# Edge Lab sport priorities — October 6, 2026

The user reprioritized Edge Lab to NBA, NFL, NHL, tennis, and soccer. Soccer scope is all leagues supported by the configured providers; tennis includes ATP and WTA. MLB remains supported in maintenance mode as its season ends. This updates the priority of the October 4 cross-sport performance design, without weakening its evidence or publication requirements.

## Execution order

1. Preserve the completed immutable ledger and reviewed MLB capture fixes. Complete the in-progress NFL capture integration because it supplies the shared tracking foundation.
2. Extend coverage and identity contracts to NHL, tennis, and soccer before exposing them in Results. Keep soccer league/competition identity and ATP/WTA tour identity distinct. Enumerate actual provider coverage rather than assuming every league is available.
3. Prioritize NBA and NFL model/source readiness, then NHL, tennis, and soccer. A provider market or schedule alone is not an independent model. Missing model coverage must be visible and must not produce fabricated forecasts or cleared PLAYs.
4. Complete settlement, performance reporting, and prospective evaluation for supported sources. Preserve MLB compatibility without expanding MLB research at the expense of the new priorities.

## Required sport distinctions

- Soccer draws and regulation-only versus extra-time markets must remain distinct. Three-way markets require appropriate normalization; two-sided no-vig assumptions cannot be reused blindly.
- NHL regulation versus overtime/shootout rules must be explicit in each saved market.
- Tennis match, set, and game markets must retain their scope, tour, format, and retirement/walkover policy. Missing settlement policy leaves an outcome unresolved.
- NBA and NFL retain the existing source identity, pregame timestamp, freshness, shadow-mode, and promotion requirements.
- All sports retain wins, losses, pushes, voids, unresolved outcomes, and paired model/market evaluation where the data supports them. Hypothetical returns remain separate from actual wager profit.

## Current evidence and boundaries

The production branch contains NFL shadow endpoints, NHL odds-provider mappings, and some MLS/soccer market handling. A bounded code inventory did not find independent NHL, tennis, or soccer models; full source/model validation remains work to do. NBA has no model endpoint on this production branch. ESPN is the user-authorized NBA source, but source access alone does not establish a validated live model.

No new sport is declared production-ready by this document. Existing examined holdouts stay development evidence. New model influence requires a frozen protocol and earned validation thresholds; tracking or provider availability never grants influence automatically.
