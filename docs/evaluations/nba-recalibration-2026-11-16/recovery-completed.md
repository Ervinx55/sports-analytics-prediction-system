# NBA outcome recovery completed — November 16, 2026

The reviewed outcome-only transaction was applied to `yeoxroijaptomomshdii` and verified at **17:01:42 UTC**. All 111 originally selected missing observations are now accounted for. No pending quote identities remain within the reviewed target scope. This completion record follows the earlier [read-only recovery audit](outcome-recovery.md).

| Population | Rows | WIN | LOSS | INACTIVE |
|---|---:|---:|---:|---:|
| Original selected observations, after recovery | 111 | 41 | 38 | 32 |
| Existing automatic outcomes preserved | 33 | 14 | 19 | 0 |
| Selected observations inserted manually | 78 | 27 | 19 | 32 |
| All quote identities inserted manually | 230 | 65 | 65 | 100 |

The 230 inserts comprise the 78 selected observations plus 152 later quote identities for the same reviewed event/player/market combinations. Each was graded against its own frozen line and side. These additional quote rows do not increase the independent validation sample. The original selection covers 41 player-games across seven events: 30 with positive minutes and 11 with explicit nonparticipation. There were no pushes.

Official NBA game pages, schedule pages, final gamebook PDFs, and targeted official rosters were reread from their hash-pinned raw files. Positive minutes and six player statistics were checked field by field against both HTML and PDF. Current SportsGameOdds native player identities, names, teams, starts, and results were checked against this evidence. Three exact, scoped aliases are retained in [the identity review](recovery-identity-review.json). All seven current provider home/away orientations agree with official evidence; no fixture reversal was applied.

The 32 selected nonparticipants have explicit official DNP/DND/NWT rows or inactive-list evidence. Their outcomes use `INACTIVE`, `actual: null`, `actualMinutes: 0`, and `RESEARCH_INACTIVE_NOT_GRADED`. These records represent research nonparticipation, not under wins or sportsbook settlement. Provider participation in any captured period would have blocked an inactive import. Differing official DNP/DND reason labels remain in the evidence.

The transaction locked observations and outcomes before checking exact observation payloads, starts, the 33 existing automatic payloads, duplicate identities, and participation/statistic conflicts. Any changed or conflicting record would abort the transaction. It inserted only into `public.nba_prop_outcomes_v1`; no existing outcome, forecast, protocol, or model was overwritten.

The reviewed manifest SHA-256 is `24ddbeea0efc24f5d810256540a1f5a79b0469bc11d0e69841200bab78e385bb`. The applied 1,658,280-byte SQL artifact SHA-256 is `0fb47026c51bf9c7fa287155477086be387fcaa8e47e4fda94e469c4d042245d`. Both independent reviews passed with zero mismatches. [The compact review summary](recovery-review-summary.json) records their checks and full-report hashes; [the source index](recovery-source-index.json) records all 33 pinned source/support files, provider receipts, and frozen hosted-file hashes. Large raw files, the full manifest, and the SQL remain in the workspace evidence archive.

Collector version 44 also preserves bounded statistic-specific failure codes and reports unresolved rows, including a verified summary that omits a pending player. These diagnostic changes do not grade an absent player. The collector automatically recovered the 33 selected Dallas/Boston observations before the reviewed import; those outcomes were independently checked and preserved.

**Verification:** 97 Python tests passed, including 11 recovery tests, and 324 Node tests passed. Full evidence preparation reproduced the reviewed manifest exactly, and SQL generation independently repeated all source checks before emitting the transaction. The frozen baseline hash remains `31a5b080bdf88ff0ce6eb3b8c06c204e4bdd3e8693b1953cb919eb3a8aa2a0ce`; the paired candidate remains `880a76673cae94f50329671aaeb84254346348edaa6f4e7312a1f9910e442308`. Approved model count remained zero.

The [refreshed paired evaluation](recovery-paired-evaluation.json), as of 17:03:00 UTC, contains 4,598 registered quote forecasts, 1,546 selected player-markets, 1,278 scored player-markets, 82 verified inactive player-markets, and zero invalid observations. All 186 unresolved selections belong to future games starting November 17 at 00:00 UTC or later; missing outcomes for started selections are zero. The independent sample is **42 games and 481 player-games**, below the registered floors of 100 games and 500 player-games. Collection remains open through December 1 at 00:00 UTC.

| Game-balanced Brier score, lower is better | Frozen baseline | Frozen minutes candidate |
|---|---:|---:|
| Points | 0.268045 | 0.268438 |
| Rebounds | 0.256861 | 0.254276 |
| Assists | 0.251428 | 0.252987 |

Minutes MAE is 4.7568 for the baseline and 4.7768 for the candidate. These interim results are mixed: rebounds improve, while points/assists Brier and minutes MAE worsen. They do not support approval. This evaluation concerns the existing **`nba-minutes-paired-2026-11-10-v1`** protocol; newly developed offline recalibration candidates still require their own predeclared prospective protocol and independent review. The recovered quotes are not a new confirmation trial for those candidates.

To reproduce the local manifest and SQL, run from `work/deep-dives-release` in the archived workspace layout, where `outputs` is two levels above the repository. Python must provide `pdfplumber`; tests also require `pytest`. The following commands create local review artifacts only. Reapplying the completed SQL transaction would deliberately abort because the outcome identities now exist.

```powershell
$workspaceRoot = (Resolve-Path ../..).Path
$evidenceRoot = Join-Path $workspaceRoot 'outputs/nba-outcome-recovery-2026-11-16'
$python = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'

& $python scripts/nba/recover-reviewed-outcomes.py prepare `
  --workspace $workspaceRoot `
  --audit "$evidenceRoot/official-evidence-audit.json" `
  --observations "$evidenceRoot/missing-observations.json" `
  --provider "$evidenceRoot/current-sgo-outcome-sources.json" `
  --identity-review "$evidenceRoot/identity-review.json" `
  --pending "$evidenceRoot/all-target-pending-observations.json" `
  --existing "$evidenceRoot/automatically-recovered.json" `
  --as-of 2026-11-16T16:58:42Z `
  --output "$evidenceRoot/reproduced-manifest.json"

& $python scripts/nba/recover-reviewed-outcomes.py sql `
  --workspace $workspaceRoot `
  --manifest "$evidenceRoot/reproduced-manifest.json" `
  --reviewed-sha256 24ddbeea0efc24f5d810256540a1f5a79b0469bc11d0e69841200bab78e385bb `
  --output "$evidenceRoot/reproduced-inserts.sql"

$env:PYTHONPATH = "$workspaceRoot/work/python-deps-eeman;."
& $python -m pytest -q
```
