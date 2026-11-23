# Edge Lab integrity and integration repair — 2026-11-23

## What this repair changes

The current dashboard was mixing MLB prop history into other sports, turning
failed reads into apparently empty slates, and ranking qualifying selections by
expected value ahead of their model win probability. NBA readiness and the
PrizePicks diagnostic also existed in detached proposals rather than the active
JavaScript route. The decision journal lacked a reproducible source history,
strict official-result reconciliation, and a reliable way to preserve analyst
recommendations without representing them as placed wagers.

This repair addresses those concrete integration and accounting defects. It
does not establish new calibrated prediction models or enable unapproved
production decisions.

## Current decisions

- Qualifying selections are sorted by model win probability, with expected
  value used only to break equal-probability ties. Ordering never promotes a
  pending or rejected decision.
- Current cards require the selected sport, a future scheduled start, and a
  valid capture time before both the present and the event. Started, mistimed,
  and wrong-sport observations are excluded from the current card.
- An expired, production-disabled, or probability-invalid `PLAY` is displayed
  as `PASS`, retaining its recorded status and an explanation. Stored history
  is not rewritten.
- Transport failures, malformed successful responses, invalid row shapes and
  error payloads produce explicit `UNAVAILABLE` state and null counts. They do
  not establish a verified zero-play slate.
- Non-MLB views no longer call the MLB-only prop card. They direct the user to
  that sport's research page and make the availability limitation visible.
- The dashboard uses BUY labels for qualifying cards and explains the ranking
  basis. A missing current source is no longer presented as a healthy live
  model connection.

## Props and feed integration

See [props repair evidence](repair-20261123-props.md) for the full contract and
verification. The active NBA research route now reports the missing evidence
for every player-market observation. Minutes, rotation, injury clearance,
matchup adjustments and calibration remain unverified; the response keeps
model probability null and production use disabled.

The protected PrizePicks diagnostic is available through the existing
`/api/nbaprops?view=prizepicks` route after deployment. It authenticates before
provider/cache access, uses the existing provider budget and coalescing layer,
limits pagination, and reports denial, quota, incomplete coverage and empty
results distinctly. It does not infer executable odds or a payout from a DFS
statistical line. The change does not add a provider subscription or create a
new Vercel function.

Research pagination rejects malformed cursors. Historical explanation failures
do not erase valid quotes. NFL estimates require the same event start time as
their quotes, so a rescheduled game cannot inherit a forecast for the previous
kickoff identity.

## Historical replay timing

The separate NBA score-only replay admitted results using game start times,
which allowed an overlapping game's eventual final score into an earlier
forecast. Version 2 requires archive metadata for the exact final result and
admits it only when its observed time is strictly before the forecast.
Missing, conflicting or invalid observations produce an explicit blocked state
and null accuracy metrics. Current historical feeds do not supply those
original archives; no retrospective capture times were fabricated. The
follow-up passed independent review and 15 focused regression tests.

## Journal and official results

The seven November 22 hosted journal migrations are recovered as deployment
history. They must not be replayed into the existing production project.

The additive integrity migration keeps original observations immutable,
distinguishes evaluations, analyst recommendations and documented tickets, and
allows an unknown original recommendation time to remain unknown. A service
CLI provides a dry-run plan before an explicitly applied write.

Official results require a league source URL, a captured source SHA-256 and
named reviewer identity evidence that binds the exact event, scheduled start,
player, market and scope. Corrections append revisions. Statistical grades use
only exact identities and the current official revision. Unknown market scope
does not become full-game evidence. Bounded scorecards count each exact market
side once by its earliest recorded decision and distinguish prospective
captures from retrospective imports.

These are statistical threshold outcomes. They do not establish a sportsbook
settlement, actual entry payout, stake, betting return, ROI or closing-line
value. No model evaluation may treat a later import as a prospectively captured
prediction.

## Pipeline and source recovery

See [pipeline repair evidence](repair-20261123-pipeline.md) and the associated
[inventory observation](repair-20261123-drift-observation.json).

The checked-in ML export source now exactly matches the already working
deployed version 10, including its existing credential override. No ML function
redeployment is required. The drift check now reports missing configuration and
query failures without printing credentials, and correctly includes applied
migrations with their hosted version aliases.

Two GitHub Actions secrets still require authorized configuration:
`SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. Remaining historical source
differences are recorded explicitly rather than accepted as a clean baseline.

## Validation and release record

The final integrated local suite passed **551 Node tests** and **84 Python
tests**. The frozen journal migration and CLI additionally passed independent
verification of **10 PostgreSQL integrity tests** and **6 CLI tests**. Source
secret scanning and `git diff --check` were clean.

The additive journal repair was applied to production at
**2026-11-23T17:19:26Z**, hosted migration version **20261123171926**. Its hosted
statement SHA-256 exactly matches the reviewed file:
`952204532c85061230b6db4b3eacf13e9bc73517cd9bc6612a767cbfdd833957`.
All **45,803** observations present immediately before deployment remained after
deployment. The three journal/result/grade tables have row-level security
enabled, no anonymous or authenticated grants, and only SELECT/INSERT grants
for the service role. The post-deployment security check reported only the
expected informational no-policy finding for these private service tables;
see [the Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

The complete repair, including the replay correction, passed GitHub Actions
Tests run **45228892885** and Probability Lab run **45228893124** on commit
`e97742ec026d5090bbfb25b2f52d6de335ada35e`. Tests included PostgreSQL, Python,
Node, the sharp-book browser check, and the desktop/mobile team-scoring browser
check. [PR #79](https://github.com/Ervinx55/sports-analytics-prediction-system/pull/79)
merged as `dfa4c2b724ca36e263e3aeebd0e04a75c6c1faf7`. The SQL regression suite
is now included in the main test workflow.

Vercel reported successful production deployment, and direct checks of
[the canonical site](https://sports-analytics-prediction-system-tau.vercel.app)
confirmed byte-for-byte matches for the reviewed current-card and replay
modules. The deployed NBA dashboard contract reports model-win-probability
ranking and routes NBA player observations to the NBA research page. The
research API returned **911** player-market records, with explicit unmet
readiness requirements and zero production-eligible predictions. Its book
coverage included **552** available and fresh PrizePicks DFS quote sides, with
zero comparable single-pick price sides. These are time-specific feed
observations, not proof of model readiness or executable standalone prices.

At that observation, the original diagnostic handler returned HTTP **503** with
`MONITOR_AUTH_UNAVAILABLE` because its shared `SHARP_MONITOR_TOKEN` was
unavailable. An authenticated diagnostic was not performed.
The Vercel connection available during repair did not expose the existing
project, so that configuration remains blocked on access to the owning team.
Code deployment succeeded through the existing Git integration. The two
missing GitHub drift credentials listed above remain separate blockers.

A subsequent source review found that adding `SHARP_MONITOR_TOKEN` would also
gate existing `/api/board` and `/api/sharp` consumers. Do not add that shared
variable just to enable the private diagnostic. The
[dedicated-credential repair](prizepicks-monitor-credential-20261123.md) uses only
`PRIZEPICKS_MONITOR_TOKEN` for that route and records the pending configuration
and live verification separately from the original production observation.

Live browser verification then exposed a further default-feed/display contract
defect: the NBA page lost team and roster metadata and omitted readiness
disclosures. The follow-up and its regression evidence are recorded in
[the props repair report](repair-20261123-props.md). The follow-up's integrated
Node suite passed **561 tests**, including seven new regressions through the
actual page renderer and three additional default-feed integrity regressions.
Malformed cursors cannot imply complete coverage, and arrays or booleans cannot
be coerced into numeric bookmaker observations. Its release and live
verification are recorded in its pull request.
