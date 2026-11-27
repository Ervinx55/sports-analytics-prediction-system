# Publishing reviewed picks

The NBA homepage has two distinct sources. **Today's reviewed picks** reads the
manual recommendation journal. **Automated model decisions** reads the existing
approval-backed NBA service. A manual recommendation never creates a model
approval, model probability, current quote, or wager record.

## Publish the existing review

Use the supported `scripts/edge-lab/decision-journal.mjs record` command, with
`recordKind: recommendation`, `provenance: conversation`, the original decision,
exact event/player/market/period/side/line/book, original review time, and truthful
source evidence. Keep personal histories and raw captures outside this public
repository. Recording happens at the actual current time; do not backdate it.

To explicitly publish only the card fields, include this object in the record's
`context`:

```json
{
  "publication": {
    "surface": "edge-reviewed-picks-v1",
    "visibility": "public",
    "matchup": "Away team at Home team",
    "priceLimit": -110,
    "reviewNote": "Use the reviewed line at the stated price limit."
  }
}
```

`priceLimit` is the original American-odds limit, not a newly generated price or
recommendation. Publish only records the user requested to display. Recover exact
prior recommendations before importing them; conditional research must retain its
conditional decision. An absent record is not evidence of a rejected play.

Run without `--apply` to validate a record first. The existing recording RPC is
idempotent by source/reference; corrections append a new record rather than
overwriting history. Verify the returned journal ID and capture time.

## Read and amend

The same-origin route is `/api/dashboard?reviewedPicks=1&sport=NBA`. It uses the
existing server credential and service-only table permissions. No browser receives
a database credential or direct journal access. The response is an allowlist of
display fields; it never returns raw context, evidence, source references, ticket
details, model approval, or model probabilities.

The feed selects the game date in `America/Chicago`. An upcoming manual BUY is
shown as **REVIEWED BUY**, with the original book/price, review timestamp, and price
limit. Prices are labeled recorded. Started games remain visible for the current
day with **Game started**, and do not count as upcoming BUYs. Prior-day reviews
must not remain on the next day's board. Feed errors keep saved cards visibly
stale rather than claiming a verified zero-pick slate.

For a withdrawal or changed recommendation, append a new record with
`previousDecisionId` pointing to the old record and the same exact
sport/event/start/player/market/period identity. Side, line, and book can change.
A public amendment should carry the publication object so its explanation can be
shown. A private amendment still suppresses its public predecessor without
revealing the private amendment's contents. Duplicate captures never resurrect a
withdrawn latest pick.

The endpoint fails unavailable on incomplete or malformed upstream reads. It does
not weaken the automated NBA approval or price-freshness checks. The header's
refresh control refreshes both sources; publishing a journal record does not
require a frontend deployment after this reader is installed.

## Verification

Run the reviewed-pick API/view tests, existing NBA display tests, and normal CI.
On the hosted build, verify the displayed names, selections, recorded books and
prices, review times, and count against the explicit publication records. Confirm
the automatic count remains separate. Test an expanded card and the header
refresh at a mobile width. Follow the master-based frontend release path and
record the final production URL and commit in the release PR.
