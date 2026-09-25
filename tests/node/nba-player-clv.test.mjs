import test from "node:test";
import assert from "node:assert/strict";

import {
  clvClass,
  fair,
  latestAt,
  marketMetrics,
  openingRefs,
  quoteMatchesObservation
} from "../../supabase/functions/refresh-nba-player-prop-clv/nba-clv.js";

const quotes = [
  {
    observed_at: "2026-10-20T20:00:00Z",
    event_id: "evt1",
    player_id: "p1",
    player_name: "Jayson Tatum",
    stat_id: "points",
    book: "draftkings",
    side: "over",
    line: 27.5,
    odds: -110,
    provider_open_line: 27.5,
    provider_open_odds: -110,
    available: true
  },
  {
    observed_at: "2026-10-20T20:00:00Z",
    event_id: "evt1",
    player_id: "p1",
    player_name: "Jayson Tatum",
    stat_id: "points",
    book: "draftkings",
    side: "under",
    line: 27.5,
    odds: -110,
    provider_open_line: 27.5,
    provider_open_odds: -110,
    available: true
  },
  {
    observed_at: "2026-10-20T23:20:00Z",
    event_id: "evt1",
    player_id: "p1",
    player_name: "Jayson Tatum",
    stat_id: "points",
    book: "draftkings",
    side: "over",
    line: 28.5,
    odds: -115,
    available: true
  },
  {
    observed_at: "2026-10-20T23:20:00Z",
    event_id: "evt1",
    player_id: "p1",
    player_name: "Jayson Tatum",
    stat_id: "points",
    book: "draftkings",
    side: "under",
    line: 28.5,
    odds: -105,
    available: true
  }
];

test("NBA CLV fair probability removes same-book vig", () => {
  assert.equal(fair(-110, -110), 0.5);
});

test("NBA CLV opening and latest snapshots preserve time ordering", () => {
  const opening = openingRefs(quotes);
  assert.equal(
    opening.find((q) => q.side === "over").line,
    27.5
  );

  const latest = latestAt(
    quotes,
    Date.parse("2026-10-20T23:30:00Z")
  );
  assert.equal(
    latest.find((q) => q.side === "over").line,
    28.5
  );
});

test("NBA CLV market metrics require exact-line same-book pairs", () => {
  const latest = latestAt(
    quotes,
    Date.parse("2026-10-20T23:30:00Z")
  );
  const metrics = marketMetrics(
    latest,
    28.5,
    "over",
    "draftkings"
  );

  assert.equal(metrics.consensusLine, 28.5);
  assert.equal(metrics.sameBookOdds, -115);
  assert.equal(metrics.pairedBooks, 1);
  assert.ok(metrics.marketFair > 0.5);
});

test("NBA CLV classification respects line direction and staleness", () => {
  const close = {
    bookCount: 3
  };

  assert.equal(
    clvClass(true, close, 1, null, null, 5),
    "POSITIVE_LINE_CLV"
  );
  assert.equal(
    clvClass(true, close, -1, null, null, 5),
    "NEGATIVE_LINE_CLV"
  );
  assert.equal(
    clvClass(true, close, 1, null, null, 20),
    "STALE_CLOSE"
  );
});

test("NBA CLV quote matching uses event, player, and stat", () => {
  const observation = {
    event_id: "evt1",
    player_id: "different-provider-id",
    player_name: "Jayson Tatum Jr.",
    stat_id: "points"
  };

  assert.equal(
    quoteMatchesObservation(quotes[0], observation),
    true
  );

  assert.equal(
    quoteMatchesObservation(
      { ...quotes[0], player_name: "Jaylen Brown" },
      observation
    ),
    false
  );
});
