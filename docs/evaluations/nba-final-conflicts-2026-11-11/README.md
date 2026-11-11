# Final two explanation conflicts and context refresh resilience

## Verified explanation corrections

Both formerly excluded games now have exact-basis-bound explanation overlays. `nba_explanation_backfills_v1` contains 97 rows (58 earlier backfills, 37 official corrections, and these two). Original provider records, frozen models, forecast inputs, calibration cohorts, approval thresholds, and collector schedules were not changed.

- **Washington at Detroit, NBA 0022600205:** the complete official HTML roster, final scorer's gamebook, and BALLDONTLIE roster identify Isaac Jones. The unsupported SGO Mason Jones entry is excluded only from the explanation copy. It is not renamed or linked to Isaac. Isaac retains `bdl:1028205331`; the raw SGO profile/result and exclusion rationale are recorded in the manifest.
- **Denver at Houston, NBA 0022600208:** the final scorer's gamebook confirms Fred VanVleet at **30:00**, resolving HTML `29:60`. The gamebook also records Alperen Sengun at **12 rebounds, 7 defensive**, corroborated by 12 rebound play-by-play entries and fresh SGO results. HTML and original BDL values of 11/6 are preserved; exact correction fields record the discrepancy and authoritative gamebook evidence.

Sources: [Detroit final gamebook](https://statsdmz.nba.com/pdfs/20261109/20261109_WASDET_book.pdf), [Houston final gamebook](https://statsdmz.nba.com/pdfs/20261109/20261109_DENHOU_book.pdf). PDFs were fetched directly, hashed, parsed, and visually inspected on page 1. Every positive-minute gamebook row was compared with the official HTML; all differences are explicitly recorded. The unchanged strict reconciler accepted both corrected copies. Independent replay and review passed before insertion; existing rows were not overwritten.

The fixed 77-player cohort remains 77 defense / 69 defense-versus-position / 77 usage. These two corrections improve evidence completeness but do not manufacture additional position samples or authorize plays.

## Context refresh defect and repair

The former reader discarded all cached evidence after one failed refresh. A production snapshot query took 5.75 seconds near its six-second client timeout; database logs also contained statement timeouts. The former route returned HTTP 200 and CDN-cached quotes even when all contexts were null, while swallowing the failure reason.

The reader now shares one in-flight request, retries a cold transient failure once, and preserves previously validated historical evidence for a maximum of ten minutes from acquisition and generation. Cached-after-error context carries its original timestamp and is visibly disclosed in the deep dive. Authentication, malformed data, stale snapshots, and rate limits fail closed. Rate limits honor Retry-After. Sanitized failure categories support diagnosis without exposing credentials. Degraded/missing-context props responses use `no-store`.

No query timeout threshold was increased. An alternative SQL query was compared and returned identical histories/targets with fewer temporary writes, but its measured improvement was small; it was not applied. The release changes read resilience only, not database/model semantics.

## Verification

- Regression tests reproduced missing cold recovery, discarded warm context, absent stale disclosure, and early retry after rate limiting before fixes.
- 192 Node tests and 78 Python tests pass; reconstruction secret scan passes.
- Separate read-only reviewer replayed both candidates and independently ran 18 focused tests; no material blockers.
- Preview build `dpl_AkcwbzAMMASG5PJxwT968V2noMbv` passed API and browser checks: dashboard 500/440/500 and props 265/243/255 rows with defense / position / usage evidence respectively. Rows are markets, not unique players.
- Desktop and 390px mobile deep dives render without page errors or horizontal overflow. All enriched contexts retain production weight zero and eligibility false.

Transient infrastructure failures remain possible. Bounded, disclosed fallback and retry prevent a single refresh failure from erasing warm context; extended outages correctly leave evidence unavailable.
