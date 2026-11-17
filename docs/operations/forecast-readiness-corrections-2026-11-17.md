# Forecast-readiness corrections — November 17, 2026

The November 16 review exposed a stale NFL starter selection and misleading probability labels. These corrections repair input and presentation contracts; they do not establish better forecast accuracy, change frozen NBA/NFL coefficients, promote a model, or alter saved historical predictions.

## Corrections

- Current NFL forecasts require a schedule quarterback and one dated daily depth-chart QB1 that agree. Missing, conflicting, ambiguous, undated, future, or more-than-48-hour-old depth evidence blocks the forecast. Evidence is bounded by both forecast time and kickoff. Agreement is not confirmation of final active status. Blocked games retain their matchup and reason instead of silently disappearing.
- Current schedule identity must match both teams, season, and the NFL Eastern game date uniquely. A UTC-date mismatch must not fall back to an earlier meeting between the same teams. Historical availability-disabled replay retains its original matching behavior.
- NFL probabilities carry their source, calibration version and effective independent contribution. Winner/spread probabilities with zero independent contribution remain market references, with no model percentage displayed. Blended totals disclose the contribution. Unknown provenance is not inferred from numerical similarity. Research and legacy probability views retain no-vig book comparisons separately.
- NBA's experimental historical baseline requires all 21 requested daily feeds. Nineteen successful requests must not be labelled complete. Existing baseline coefficients and research-only status remain unchanged.
- The research shortlist shows repeated exact selections across platforms and multiple selections from the same game, across current filters. Counts refer only to the current page shortlist; they are not joint probabilities, ownership, stakes or linked account exposure. Known SportsGameOdds prop/game event prefixes reconcile; unrelated provider identities remain separate.
- Historical NFL replay with availability adjustments disabled retains its original numerical semantics. No recalibration was fitted to yesterday's selected tickets.

## Verification

Regressions reproduce the bad source selection, market-only display, missing blocked-game explanation, future response timestamps, incomplete history, and shortlist identity/exposure cases before correction. Tests exercise real adapters and rendered HTML; browser fixtures are synthetic and never create bets or collect production forecasts.

On the isolated master-based release branch: 314 Node tests, 78 Python tests, the reconstruction secret scan and both sharp-books/deep-dives browser suites passed. Mobile layouts and shortlist add/remove/filter behavior were exercised with synthetic fixtures. Independent review reproduced and then cleared the wrong-game schedule match and legacy provenance issues; its final 43 targeted tests passed. Historical availability-disabled replay retained every original numerical output field across five evidence variants.

Use the current Vercel project's production environment for a staged build; verify it before assigning the production domain. This release excludes the separate, still-open recalibration research branch and private ticket artifacts.

## Remaining model work

Source agreement does not supply a new verified injury-adjusted NFL forecast. The experimental NBA winner model still lacks current rest/lineup/role adjustments and remains research-only. The public NBA live-decision RPC omits evidence needed to display projected minutes/availability details; until a narrowly whitelisted summary is implemented and reviewed, those fields must remain unavailable. Evaluate future candidate improvements against the full chronological saved cohort and untouched holdout, not just yesterday's losing tickets.
