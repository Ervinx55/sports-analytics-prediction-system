# Approval gate audit

## Findings

No evidence of a universally blocking defect in the existing shared MLB final evaluator. Executable positive-path tests retain PLAY for a fully upstream-qualified team card with current authoritative sharp sources, lineup and weather evidence, and for an already-qualified prop with current required inputs. Negative tests retain upstream PASS and reject missing/stale evidence in the final window. These are final-evaluator tests, not proof that upstream probability models are profitable.

NBA is a separate research path. `sgo-nba-collector.mjs`, `nba-pregame.mjs`, both prospective evaluators, and the research UI deliberately retain production weight zero and eligibility false. `nba-model.js` can return shadow PLAY but always production PASS. There is no end-to-end promoted NBA prop PLAY path in the inspected implementation. Completing collection alone cannot activate it.

Live audit at 2026-11-10 10:29 UTC: zero eligible saved forecasts; 364 minutes-comparison forecast records and zero settled records; baseline hash matches the registered frozen protocol. No currently validated NBA candidate was found to be incorrectly denied. The existing protocol remains collecting through December 1, with 100 games/500 player-games as sample floors rather than automatic promotion criteria.

## Corrected defect

The research-branch feed diagnostic asserted `UNTOUCHED_PROTOCOL_NOT_FROZEN` without querying the hosted validator. Replaced that unsupported assertion with `HOSTED_PROMOTION_APPROVAL_REQUIRED` and explicit `hostedValidationStatus: NOT_CHECKED_BY_FEED`. This is a reporting correction, not a model approval or live production release. The canonical deployed quote-only route does not use this research-branch helper.

## Remaining implementation dependency

A future promoted NBA decision path must consume a reviewed, server-controlled approval bound to the exact model hash, market scope, evaluation artifact and permitted production weight. It must reject absent/revoked/mismatched approval, then require current exact paired prices, verified player identity and availability, validated minutes assumptions, book settlement rules, and price-aware expected-value thresholds. Its output must feed the visible card and immutable decision ledger together. Do not substitute a caller-supplied boolean or remove research locks globally. Approval policy and statistical acceptance criteria must come from the completed evaluation review; the current evidence does not authorize promotion.

## Verification

132 Python and 517 Node tests passed, including four new executable gate-audit cases. The reporting regression failed before the fix and passed after it. Production model weights, validation rules and deployed services were not changed.


Recovery: after restoring readiness-followup.bundle, fetch approval-audit.bundle HEAD and check out FETCH_HEAD. This bundle adds local commit a1e2c4a; production unchanged.
