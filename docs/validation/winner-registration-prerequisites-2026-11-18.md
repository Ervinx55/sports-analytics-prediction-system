# Winner and spread registration prerequisites

Audited November 18, 2026, 19:42 UTC. This is an artifact inventory and descriptive development audit, **not a candidate selection, registration receipt, activated holdout or promotion**. Both live models remain frozen. Exact bytes, hashes, coefficient objects and event inventories are in [the companion JSON](winner-registration-prerequisites-2026-11-18.json).

## What can be frozen without fitting another model

| Scope | Existing numerical definitions | What is missing before activation |
|---|---|---|
| NBA winner | `nba-independent-margin-ridge-v0-unvalidated`; fixed November 17 rest, defense and combined logistic-offset arms | Explicit candidate/incumbent choice; complete arm manifests; prospective arm feature/inference parity; same-cutoff captures |
| NFL winner | `nfl-independent-ridge-baseline-2023-frozen-v1`; fixed 2023-trained rest, defense and combined logistic arms | Explicit candidate/incumbent choice; complete arm manifests; prospective arm feature/inference parity; same-cutoff captures |
| NBA spread | Projected mean and binary winner mapping only | Independently developed/tested exact-line candidate and incumbent distributions, including push accounting |
| NFL spread | Existing independent mean plus continuous normal cover formula, sigma 13.6, inside the live implementation | Separate frozen independent distribution artifacts and development tests; integer-line push accounting; the market-blended simulation is not such an artifact |

Only the two research baselines are currently implemented in `sharp-service/lib/winner-prospective-models.js`. The baseline manifests are `e64b9841f72c9f00a51e8a015a88d60c93d05fcb19b45065c20bb85c2a894df6` (NBA) and `a8997909da1c5a1cf71c4cd4a463f2807020d830ba772a4869a2307d67765685` (NFL). These are canonical manifest-body hashes, not hashes of the full serialized manifest including its hash field.

The fixed NBA arm coefficients are in `outputs/winner-validation-2026-11-17/nba/report.json`, under `fitted.models`. That report is 32,543 bytes, SHA-256 `2e6a900c5447488865bd72303b34f588a1d42bd9f764061b7571709f6a22abe3`. The full NFL model bundle is `outputs/winner-validation-2026-11-17/nfl-reviewed/models.json`, 2,777 bytes, SHA-256 `e79b80d6b584bc41e5e7356044be5e24fc645a90584f40b154b0c90d05cd02bd`. The JSON inventory pins their feature runners and underlying baseline implementations as well; coefficients alone do not constitute a complete reproducible candidate.

The NFL live implementation is a distinct reference: its moneyline and spread independent shrinkage weights are zero. The 2023 research baseline must not be described as the live NFL model. NBA/NFL November 16 player-prop distribution artifacts also do not supply game-spread distributions. Pairing a model with itself cannot pass the required improvement criterion.

## Development evidence available now

NBA has 422 training targets, 227 January diagnostic targets and 519 later development targets across 66 Eastern days. Its previously inspected raw archive contains 1,230 games, including 62 early targets excluded for insufficient history. NFL has 224 training targets from 2023 regular-season weeks 4–18 and 224 development targets from the same weeks of 2024, across 15 season-week blocks. Exact IDs and inventory hashes are included in the JSON. They are not proof of a complete project-wide prior-use/holdout inventory.

| Development comparison | Games / blocks | Mean paired Brier difference | Paired game-level SD |
|---|---:|---:|---:|
| NBA rest minus baseline | 519 / 66 | -0.001692 | 0.020550 |
| NBA defense minus baseline | 519 / 66 | +0.000308 | 0.011961 |
| NBA combined minus baseline | 519 / 66 | -0.001416 | 0.022693 |
| NFL rest minus baseline | 224 / 15 | +0.001178 | 0.054935 |
| NFL defense minus baseline | 224 / 15 | +0.003344 | 0.028343 |
| NFL combined minus baseline | 224 / 15 | +0.004635 | 0.063029 |
| NFL baseline minus archived closing reference | 224 / 15 | +0.033658 | 0.102794 |

Negative differences favor the candidate. These are reproduced from frozen predictions, not new fits. The JSON records the sample-variance and cluster-sandwich formulas, source hashes, row filters and descriptive design-effect ratios. Those ratios do not establish cross-block independence. NFL development blocks are season-weeks; the new confirmation policy uses Eastern ISO weeks.

**No approved power plan exists.** NBA has no historical matched same-time market prices to estimate candidate-minus-market variance. NFL closing-price timestamps are unknown, so its market-relative variance is a retrospective proxy. The policy's 0.01 Brier planning target exceeds the largest observed NBA improvement, 0.001692; none of these added-feature arms meets the policy's -0.005 mean-improvement criterion on this development cohort. Registering an arm remains a prospective research decision, not a finding that it works.

## Concrete next steps

1. Preserve four pending study intents, with no activated holdout. Explicitly choose and pin each candidate and incumbent; do not implicitly select the best-looking development arm.
2. For winner arms beyond the current baselines, implement research-only feature/inference capture and demonstrate probability parity with the saved arm bytes. Keep the live model entry points unchanged.
3. Finish separate spread development artifacts and exact-line win/push/loss tests before registering either spread holdout. Do not derive cover probabilities from winner probabilities.
4. Complete the prior-use inventory and a reviewed power/family/dependence plan. The JSON's descriptive variance is an input to that review, not approval.
5. Choose a wholly future fixed window with a complete official schedule, exact forecast offsets, independently retained registration receipts and holdout access controls. NFL observed-week minima extend beyond a single regular season; unavailable future schedules are a real activation blocker.
6. Before activation, establish same-cutoff candidate/incumbent capture, both teams' verified lineup evidence and paired exact-line prices no more than 300 seconds old. Continue current lineup, price and final-outcome collection as development until then. Later receipts cannot repair earlier missing pregame evidence.

All existing historical evaluations and current November research captures remain development. No original forecast, source archive, model, coefficient, gate or database row was changed by this audit.
