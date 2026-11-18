# Prospective NBA/NFL winner and spread confirmation

Status: **NOT STARTED**. This document and its offline evaluator define a future confirmation procedure. They do not register a candidate or a holdout, change an NBA/NFL model, approve production, or enable PLAY. The existing source validation datasets and the November 17 analyses remain **DEVELOPMENT**. The current baselines remain unvalidated.

The policy draft timestamp is November 18, 2026 at 18:56:12 UTC. An actual registration must follow the independently recorded publication of the final policy bytes, as well as pass the evaluator's timestamp check. A later lineup observation or readiness assessment cannot retroactively make an earlier forecast eligible.

## First action before collecting confirmation data

Create a new, independently retained confirmation registry entry **before** the candidate's future collection window begins. Record the candidate, incumbent, feature/source schema and policy hashes; development/training/prior-holdout game inventories; the official schedule; the exact sport, market, period and season phase; forecast cutoffs; sample/power plan; and one fixed window end. Store immutable receipts outside the editable evaluation bundle. A registry steward must verify those receipts and holdout access records. This change does not create that registry or claim its records already exist.

Until that step is complete, continue research and evidence collection as development work. Do not relabel already issued forecasts as confirmation. Freeze a candidate only after development work is finished. A new feature, cutoff, probability mapping, exclusion rule or distribution requires a new version and an unused future holdout; the old holdout becomes development evidence.

## Separate cohorts and minimum design floors

Each sport/market/season-phase combination is evaluated separately. Only NBA and NFL full-game winners and integer/half-point spreads are supported. Regular season and postseason cannot be pooled by this implementation. Each scheduled game contributes one HOME-side forecast at one preregistered line; away probability is the complementary side where applicable. Repeated snapshots, both sides of a game, alternate lines, provider aliases and nested tickets do not add games. These rules prevent mechanical duplication; they do not make games involving the same teams statistically independent.

| Cohort | Minimum scored nonpush games | Minimum observed temporal blocks | Minimum registered window |
|---|---:|---:|---:|
| NBA winner | 300 | 60 Eastern calendar days with games | 60 days |
| NBA spread | 400 | 60 Eastern calendar days with games | 60 days |
| NFL winner | 200 | 20 Eastern Monday-start weeks with games | 140 days |
| NFL spread | 250 | 24 Eastern Monday-start weeks with games | 168 days |

These are conservative statistical design floors, not universal constants, guarantees, or transplanted prop thresholds. NFL requirements generally extend beyond one regular season, particularly because the season phases are separate. Calendar weeks without scored games do not count. A full count alone cannot pass: the preregistered power requirement, temporal coverage, data integrity, paired comparisons and calibration criteria all must pass. No thresholds are introduced for other sports.

The required scored sample is the **larger** of the table floor and a development-based power calculation. Register a target Brier improvement of 0.01, power at least 80%, the standard deviation of paired game-level loss differences, and a dependence design effect at least 1. Record the development source hash and its pre-registration estimate timestamp. The evaluator uses `ceil(((z(1-alpha/2) + z(power)) * pairedDifferenceSd / 0.01)^2 * designEffect)`. This normal approximation is planning evidence, not achieved-power proof. Independent review must assess whether the variance estimate and design effect are credible; the actual block intervals must still meet the criteria below.

## Evidence required for every captured game

1. Pin the exact candidate, incumbent, feature/source schemas and, for spreads, both independent margin-distribution artifacts. Hash the actual supplied artifact bytes. Their development reports must precede registration. A manifest claim alone does not prove the implementation produced the recorded probabilities.
2. Preregister exact input and issue offsets in seconds before scheduled start. Input cutoff must precede issue; issue must precede start by at least 60 seconds; immutable capture must follow issue by no more than the registered delay, capped at 120 seconds, and must still be pregame. The incumbent uses the same input cutoff and issues within 60 seconds of the candidate. This is a separate same-as-of confirmation cohort; older baseline predictions from another cutoff are not interchangeable.
3. Require both teams' verified, timestamped pregame starting lineups for NBA, or confirmed quarterbacks and official inactives for NFL, observed by the input cutoff. Bind that evidence to the exact event and both team IDs. Actual participants and postgame box scores are not pregame proof. Verification documents what was known; it does **not** certify that a model contains or correctly estimates a lineup adjustment.
4. Require both exact opposing prices from one identified book, matching game teams, market, full-game period and spread line. Prices must be observed no later than issue and at most 300 seconds before issue. Compute the two-side no-vig market reference from those decimal prices. A displayed quote is comparison evidence, not an executable order or a promise of fill. No ROI claim follows from Brier or logloss.
5. Bind every pregame field, including probabilities, evidence receipts and timestamps, to a forecast capture hash. Later result fields are stored separately. Bind normalized official settlement to event ID, both team IDs, period, status and final scores. Live scores are ineligible. Retain voids with reasons; preserve source receipt hashes and URLs for independent retrieval/audit.
6. Keep the complete preregistered official schedule and a pregame inclusion/exclusion ledger. No silently omitted losses or retrospective exclusions. At least 95% of scheduled games need paired captures, and every captured ledger entry needs a forecast. Missing rows fail integrity checks; missing eligible games cannot be repaired after their outcome is known.

The offline evaluator checks supplied bytes, identity, arithmetic and chronology. It cannot authenticate an HTTPS receipt, prove a timestamp is genuine, verify a caller's `scopeComplete` assertion, reconstruct a model execution from a hash, or discover undeclared training reuse. A caller could fabricate a mutually consistent bundle. Therefore even a clean result is only **HUMAN_REVIEW_ONLY** pending independent receipt, source, schedule-completeness, model-execution and access-log audit. A self-authored summary is not raw-data validation or an independent registry.

## Holdout and statistical decision rules

The registered window must close before the single final analysis or any unblinded holdout inspection. Training ends before registration. Supply explicit training, development and prior-holdout event inventories. Any overlap, prior interim look, early access, changed artifact or missing provenance blocks confirmation. There is no optional stopping when an attractive number appears, and a failed final holdout cannot be reused for the next candidate.

Compute candidate, frozen incumbent and same-as-of no-vig market **on the identical settled nonpush games**. The primary measures are Brier and logloss; hit rate is descriptive and never substitutes for either. Bootstrap paired losses by Eastern game-day blocks for NBA and Eastern Monday-start week blocks for NFL, using a fixed seed. Dependence across blocks, teams and seasons can remain; approximate percentile intervals are not a guarantee of nominal coverage.

| Check | Required result |
|---|---|
| Brier vs incumbent and vs market | Mean delta at most -0.005; adjusted upper interval bound below 0; interval width at most 0.04 |
| Logloss vs incumbent and vs market | Adjusted upper bound of candidate-minus-reference at most 0.005 |
| Fixed 10-bin calibration | Every occupied probability bin has at least 25 games; empty bins remain unsupported |
| Calibration uncertainty | ECE upper bound at most 0.05; mean probability-minus-outcome interval contained in [-0.025, 0.025] |
| Spread push calibration | Mean predicted-push-minus-observed-push interval contained in [-0.025, 0.025] |
| Spread full distribution vs incumbent | Three-class Brier upper delta at most 0; three-class logloss upper delta at most 0.005 |

Preregister the number of candidate/scope comparisons in the family. Allocate `alpha = 0.05 / (intervalsPerScope * familySize)`, with six non-null intervals for winner cohorts and nine for spread cohorts. This is a conservative multiplicity allocation, subject to the approximate bootstrap's coverage limitations. Use at least 5,000 bootstrap replicates and enough replicates for at least 20 expected observations in each adjusted tail. This bounded evaluator blocks if that requires more than 100,000 replicates; it does not invent precise extreme-tail intervals. A larger design requires a new preregistered numerical method. No favorable probability bin may be selected after inspection; unsupported bins do not acquire validation from overall results.

## Spread and push accounting

Winner probability is never a cover probability. Spreads require a separately developed and tested frozen margin/cover distribution for the **exact** offered line, for both candidate and incumbent. Each forecast contains unconditional `{win, push, loss}` probabilities summing to 1 and a conditional nonpush cover probability `win / (win + loss)`. Half-point lines must have zero push mass. Quarter lines, split stakes, derivatives and other periods require a separate protocol and are rejected.

Grade the selected side from `selectedScore - opponentScore + selectionLine`. A zero margin is a push. Pushes remain in the unconditional three-class distribution scores and push calibration, but are removed from the binary cover denominator. Voids remain auditable and are removed from scored outcomes. The paired two-price market Brier/logloss comparison is conditional on no push; two prices alone do not identify unconditional push probability, so the evaluator does not invent a market three-class score. An NFL winner tie is similarly retained as a push for this two-way tie-refund protocol. A final NBA full-game winner tie is invalid. Confirm the source market's actual settlement rules independently before including it.

## Offline interface and outcomes

The checked policy is `scripts/evaluation/prospective-validation-policy.json`; the evaluator is `scripts/evaluation/prospective-winner-spread-validation.mjs`. It imports only descriptive evaluation utilities, not live NBA/NFL model code. No application route imports the evaluator.

```sh
# Current truthful status: NOT_STARTED, productionEligible false, weight 0, PLAY false.
node scripts/evaluation/prospective-winner-spread-validation.mjs

# Evaluate a separately registered future evidence bundle offline.
node scripts/evaluation/prospective-winner-spread-validation.mjs path/to/bundle.json

# Synthetic fixtures exercise the contract; they are not registrations or evidence.
node --test tests/node/prospective-winner-spread-validation.test.mjs
```

The JSON bundle includes `registration`, exact-string `artifacts`, `registrationReceipt`, `scheduledEvents`, `scheduleReceipt`, `scopeComplete`, `ledger`, `rows`, `analysisAt`, `holdoutFirstOpenedAt` and `priorInterimAnalyses`. Registration contains the pinned policy/model hashes, explicit event inventories, power assumptions, fixed window and `forecastPolicy: {inputLeadSeconds, issueLeadSeconds, maximumCaptureDelaySeconds}`. The synthetic tests provide a complete executable schema example with reserved `.example` receipt URLs.

Hash protocol: SHA-256 over UTF-8 bytes. Policy and artifact hashes use exact file/string bytes. Registration and schedule hashes use the preserved `JSON.stringify` serialization. A forecast receipt hashes the row in its preserved property order after omitting only `settlement` and `forecastReceipt`, and its `recordedAt` must equal `capturedAt`. A settlement `payloadHash` hashes, in this exact order, `{eventId, selectedTeamId, opponentTeamId, period, status, selectedScore, opponentScore, reason}`, with absent score/reason values normalized to `null`; its separate `sha256` identifies source receipt bytes. Retain the original serialization; do not silently normalize or reorder a signed/immutable record later.

Outputs are `NOT_STARTED` (no registration), `BLOCKED` (invalid/missing integrity or unsupported design), `INSUFFICIENT_EVIDENCE` (valid inputs but criteria unmet), or `HUMAN_REVIEW_ONLY` (checks met, independent audit still required). In **every** state, `productionEligible=false`, `productionWeight=0`, and `automaticPlayEnabled=false`. Any later promotion is a separate decision under the existing approval process; this evaluator neither performs nor implies it.

## Relationship to the November 17 work

The archived protocol in `docs/evaluations/winner-validation-2026-11-17/protocol.md` and its existing evaluators remain descriptive development work. This new protocol does not revise their forecasts, labels, ranks, thresholds, source history or model parameters. Existing archives with incomplete pregame lineup receipts cannot be promoted by backfilling present-day readiness. No live NBA/NFL coefficient, probability, model card approval state, production weight or selection rule is changed here.
