# CFB game-winner forecasts

Status: design for user review. The user selected **game-winner probabilities first** on November 14, 2026. Model details below are the assistant's recommendations, not previously approved model settings.

## Intent and scope

Put independent college-football game-winner estimates beside the book comparisons in Edge Lab's existing Research → Games → CFB board. Explain the forecast, source age, and why a selection is or is not cleared. The near-term deliverable is an operating, testable prediction pipeline, not a promise of daily profitable plays.

NBA and NFL parameters, frozen comparisons, collectors, and approval rules remain unchanged. This release does not forecast CFB spreads, totals, props, or in-play markets, purchase data, place wagers, or automatically approve a new model. Those markets keep their existing price comparisons.

## What exists and what was verified

- Master `e1cc813009649e3c938a7a27e0e4a20017715385` routes CFB to SGO's NCAAF league. The live board returned 100 events with a continuation cursor; this is partial coverage, not a complete Saturday slate.
- No CFB model or CFB observations were found in the existing prediction/audit tables. Current game rows intentionally have `model: null`.
- SGO documents NCAAF results and historical finalized-event queries. The production quote connection works. An older local exported credential returned HTTP 401 on a history probe; this does not establish that the current hosted credential lacks historical access. Use the existing hosted secret, never export it to browser code or request it in chat.
- ESPN scoreboard reads succeeded for November 2, 2024; November 1, 2025; October 31 and November 7, 2026; and today's schedule. Each response contained 25 events, including IDs, scores, completed status, and neutral-site flags. Date-range requests failed. Completeness, all-season coverage, and cross-provider identity matching are **not yet verified**. These probes establish access, not a complete training set or independently reconciled outcomes.
- A follow-up matched all 25 current ESPN sample games uniquely to SGO's 100-event sample using both team names and kickoff time within 15 minutes. The resulting candidate IDs are saved in `identity-candidates.json`; this is useful mapping evidence, not a blanket approval of aliases or historical coverage. ESPN page-two and week queries repeated the same 25 games, while its core week endpoint reported 20 items. Resolve this coverage discrepancy before declaring the history complete.
- Evidence is saved under `outputs/cfb-forecast-2026-11-14` in the parent task workspace. No product code or model was changed during the probes.

## Approaches

1. **Independent game-winner rating baseline, selected scope.** Use verified completed results, opponent ratings, and verified home/neutral venue. It needs less input than a full scoring model and supports an honest early forecast. It does not capture quarterback changes or separate defensive efficiency yet.
2. Winner, spread, and total distributions together. More markets, but requires validated score distributions, correlation, pushes, and additional context. The user chose to defer this wider scope.
3. Use book consensus as the forecast. Useful as a benchmark, already supported by comparisons; rejected as the independent model because it would relabel market prices as our own prediction.

## Sources and collection

SportsGameOdds remains the primary price and event source. A bounded authenticated hosted collector reads finalized NCAAF events using the existing `SPORTS_ODDS_API_KEY`; historical reads must not filter `oddsAvailable=true`, which could drop finished games. Use narrow odds IDs, pagination, stored cursors, deduplication, retry-after handling, and the existing provider budget protections. Bound each invocation and resume later; never download whole seasons in a dashboard request.

Use ESPN as a separately identified results/venue source where accessible. Enumerate the source's schedule/calendar and verify coverage counts before treating a season as complete. Date probes alone are insufficient. If history is truncated, retain an explicit partial status and excluded-game counts. Do not silently seed missing teams at a league-average rating and publish a confident estimate.

Preserve source payload hashes, event/team IDs, source times when present, fetch time, scores, completed/cancelled state, venue evidence, and reconciliation status. Exact provider IDs are canonical. Cross-provider mappings require a unique verified pair of team identities, compatible kickoff time, and consistent game orientation; spelling alone is insufficient. Store reviewed aliases explicitly. Disagreeing scores, duplicate identities, missing neutral-site evidence, and unsupported divisions are quarantined, with reasons.

Initial forecast scope is verified FBS-vs-FBS games. FCS or unknown division games remain quote-only; expose that limit clearly. Historical FBS-vs-FCS results cannot be treated as ordinary equal-pool rating updates. Support for changing division membership must use season-specific evidence. No new paid subscription is required.

On a source outage, preserve dated last-good research evidence but withhold fresh-forecast readiness when the scheduled collection is overdue. Market freshness stays governed by the existing five-minute quote checks. A historical source fetch time must never be presented as a pregame data-observation time.

## Rating model and time discipline

Use a transparent Elo-style win/loss rating baseline in the existing JavaScript stack, with season regression and home advantage only when venue evidence is verified. Odds are excluded from independent model features. Ties/voids/cancelled games are not binary win/loss samples. Do not use final-season rankings, later outcomes, or final-game statistics in an earlier forecast.

Recommended small development grid: update factor 16/24/32, home advantage 0/35/65 Elo points, and season carry-over 0.50/0.75. Initial ratings are equal within the verified FBS pool; the first season is a warm-up, not evaluation evidence. Select one configuration using only the development period's mean log loss, with Brier score reported and a deterministic simpler-model tie break. No margin multiplier, weather, injuries, defensive ranks, or extra fitting in this first model.

Target split: 2024 warm-up, 2025 development, 2026 completed games through November 13 as a locked retrospective holdout. Record the split and candidate grid before running evaluation. If a complete valid source period is unavailable, report the missing coverage and do not silently change the split or claim holdout success. New games after the freeze form the untouched prospective cohort.

Freeze model parameters and the split manifest with a content hash. Rolling team ratings may update only from newly finalized, eligible games; that normal state update is distinct from refitting coefficients. Historical replay updates ratings only after a conservative availability boundary: use a reliable finalization time when archived, otherwise make a result available no earlier than the following UTC day and disclose the assumption. Forecast all games sharing an availability batch before applying that batch's results.

Publish no estimate for a team lacking at least eight verified eligible games in the prior 18 months, an ambiguous matchup, an unverified division/venue, or an incomplete history refresh that could omit recent team results. These are operational data minimums, not evidence of profitability. Return home and away probabilities summing to one with model version, input cutoff, latest eligible result, history count, and limitation labels. Never put a game-winner probability on a spread, total, regulation three-way, or player-prop row.

## Evaluation and clearance

Report eligible/excluded game counts and reasons, distinct teams, accuracy, Brier score, log loss, reliability bins, and comparisons with a 50% baseline, a development-only home-win baseline, and matched no-vig closing prices where genuine pregame timestamps and settlement terms are available. Show the denominator of every comparison. Missing historical prices mean no market-skill or ROI claim, not a substitute with today's odds. Reconstructed historical evaluations remain labeled retrospective; they are not captured pregame predictions.

Save prospective forecasts before kickoff with immutable model/config/input hashes. Settlement uses finalized results and appends corrections without overwriting original predictions. Separate experimental prediction accuracy from cleared plays and actual account profit. Database constraints must prevent duplicate forecasts from inflating sample counts.

Prospective snapshot rule (assistant recommendation, frozen before collection): evaluate the first integrity-valid forecast captured between 24 hours and 30 minutes before the scheduled kickoff, once per event and model version. Save its kickoff-as-known and exact entry-price snapshot when available; a missing valid price excludes only price-based comparisons, not forecast accuracy. Later display refreshes remain separately timestamped and cannot replace the evaluation row. A first forecast inside 30 minutes may display as research but is excluded from this cohort. If a captured event is subsequently rescheduled, mark that evaluation row ineligible with the reschedule evidence, report it in exclusions, and do not select a replacement retrospectively. Also report the number of scheduled eligible-scope games with no qualifying capture, so selective coverage remains visible.

This implementation may display functioning research forecasts after integrity checks, including when a model fails accuracy checks, but must make the failure/insufficient evidence explicit. **It cannot authorize PLAY.** Approval stays at zero until a separate recorded review establishes performance on the frozen holdout and prospective cohort, then applies the existing price, availability/context, freshness, and market-integrity gates. No new arbitrary sample count in this build becomes automatic permission to play. A forecast labeled 66% is not by itself a bet recommendation.

## Serving and interface

Use the same Research page and CFB selector. Keep quotes visible while optional forecasts load, show an independent loading/error status, and attach only by exact event/team/period identity. Display winner probability, paired market probability when valid, difference in percentage points, forecast time, and `RESEARCH — NOT CLEARED`. The expandable explanation includes opponent-adjusted rating difference, home/neutral treatment, history sample, source cutoff, and missing context. Do not invent defensive/quarterback analysis or imply that generic Elo explicitly measures defense.

Serve cached stored forecasts through an existing API route/view to stay within the repository's 14-function Vercel budget. No season downloads or model fitting on a page request. Use authenticated hosted collection and server-side persistence, RLS/no public writes, bounded reads, and an overlap-safe schedule appropriate for CFB. Prefer existing infrastructure; inspect tables/functions before choosing schema or schedule changes. Frontend source failure must not remove book comparisons or show stale probabilities as current. Do not feed experimental CFB records into a contract that requires an approved LIVE model; use an explicit research cohort/schema.

## Completion checks

1. Confirm authorized hosted history access, source completeness, FBS identity/venue coverage, and quarantine behavior.
2. Reproduce deterministic rating replay and the frozen split, with meaningful tests for future leakage, season transitions, neutral sites, duplicates, identities, ties, missing histories, and corrections.
3. Produce a machine-readable evaluation report and save the first eligible prospective forecasts before their kickoffs. If none qualify, show exact reasons; never backdate a capture.
4. Verify quote/forecast identity, separate timeouts, stale/offline/error handling, model/market labels, and 320/390/768px layouts with browser checks.
5. Run relevant tests plus required repository CI, review the patch, stage a hosted deployment, verify live endpoints and observed coverage, then promote only the tested release. Record deployment and commit identifiers.

## Builder decisions

The builder may choose table/function names, batch sizes within existing quotas, scheduling intervals, deterministic hashing and fixtures, and exact explanatory wording. Those choices must respect the limits above. If verified source coverage cannot support the chosen model/split, report the blocker and keep prices working; changing to a materially different model or paid source requires a new decision.

## References

- SportsGameOdds NCAAF coverage: https://sportsgameodds.com/leagues/ncaaf-odds-api
- Historical queries and settlement: https://sportsgameodds.com/docs/faq
- Events endpoint: https://sportsgameodds.com/docs/endpoints/getEvents
- ESPN source probe: https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261107&groups=80&limit=1000
