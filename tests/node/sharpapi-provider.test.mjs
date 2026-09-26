import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  fetchSharpApiOdds,
  normalizeSharpApiBoardRows,
  normalizeSharpApiMlbPropRows,
  normalizeSharpApiNflPropRows
} from "../../sharp-service/lib/sharpapi-provider.js";

afterEach(() => {
  globalThis.__edgeLabSharpApi.cache.clear();
  globalThis.__edgeLabSharpApi.inFlight.clear();
  globalThis.__edgeLabSharpApi.retryAt = 0;
});

test("SharpAPI respects Retry-After across leagues without repeated upstream calls", async (t) => {
  let now = Date.parse("2026-09-25T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ message: "Rate limited" }), {
      status: 429, headers: { "retry-after": "120" }
    });
  });
  await assert.rejects(fetchSharpApiOdds({ apiKey: "test", league: "MLB" }), { status: 429 });
  await assert.rejects(fetchSharpApiOdds({ apiKey: "test", league: "NFL" }), { status: 429 });
  assert.equal(calls, 1);
  now += 121_000;
  await assert.rejects(fetchSharpApiOdds({ apiKey: "test", league: "NFL" }), { status: 429 });
  assert.equal(calls, 2);
});

test("SharpAPI cache separates requested date windows", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ data: [], pagination: { has_more: false } }));
  });
  await fetchSharpApiOdds({ apiKey: "test", league: "MLB", startsBefore: "2026-09-25T23:59:59Z" });
  await fetchSharpApiOdds({ apiKey: "test", league: "MLB", startsBefore: "2026-09-26T23:59:59Z" });
  assert.equal(calls, 2);
});

const mainRows = [
  {
    sportsbook: "draftkings",
    event_id: "mlb_hou_sea_2026-09-25",
    sport: "baseball",
    league: "mlb",
    home_team: "Houston Astros",
    away_team: "Seattle Mariners",
    market_type: "moneyline",
    selection: "Houston Astros",
    selection_type: "home",
    odds_american: -125,
    line: null,
    event_start_time: "2026-09-25T00:10:00Z",
    timestamp: "2026-09-24T23:35:00Z",
    is_live: false,
    is_main_line: true
  },
  {
    sportsbook: "fanduel",
    event_id: "mlb_hou_sea_2026-09-25",
    sport: "baseball",
    league: "mlb",
    home_team: "Houston Astros",
    away_team: "Seattle Mariners",
    market_type: "moneyline",
    selection: "Houston Astros",
    selection_type: "home",
    odds_american: -120,
    line: null,
    event_start_time: "2026-09-25T00:10:00Z",
    timestamp: "2026-09-24T23:35:02Z",
    is_live: false,
    is_main_line: true
  },
  {
    sportsbook: "draftkings",
    event_id: "mlb_hou_sea_2026-09-25",
    sport: "baseball",
    league: "mlb",
    home_team: "Houston Astros",
    away_team: "Seattle Mariners",
    market_type: "moneyline",
    selection: "Seattle Mariners",
    selection_type: "away",
    odds_american: 105,
    line: null,
    event_start_time: "2026-09-25T00:10:00Z",
    timestamp: "2026-09-24T23:35:00Z",
    is_live: false,
    is_main_line: true
  },
  {
    sportsbook: "fanduel",
    event_id: "mlb_hou_sea_2026-09-25",
    sport: "baseball",
    league: "mlb",
    home_team: "Houston Astros",
    away_team: "Seattle Mariners",
    market_type: "moneyline",
    selection: "Seattle Mariners",
    selection_type: "away",
    odds_american: 102,
    line: null,
    event_start_time: "2026-09-25T00:10:00Z",
    timestamp: "2026-09-24T23:35:02Z",
    is_live: false,
    is_main_line: true
  },
  {
    sportsbook: "draftkings",
    event_id: "mlb_hou_sea_2026-09-25",
    sport: "baseball",
    league: "mlb",
    home_team: "Houston Astros",
    away_team: "Seattle Mariners",
    market_type: "run_line",
    selection: "Houston Astros",
    selection_type: "home",
    odds_american: 155,
    line: -1.5,
    event_start_time: "2026-09-25T00:10:00Z",
    timestamp: "2026-09-24T23:35:00Z",
    is_live: false,
    is_main_line: true
  },
  {
    sportsbook: "draftkings",
    event_id: "mlb_hou_sea_2026-09-25",
    sport: "baseball",
    league: "mlb",
    home_team: "Houston Astros",
    away_team: "Seattle Mariners",
    market_type: "total_runs",
    selection: "Over",
    selection_type: "over",
    odds_american: -110,
    line: 8.5,
    event_start_time: "2026-09-25T00:10:00Z",
    timestamp: "2026-09-24T23:35:00Z",
    is_live: false,
    is_main_line: true
  }
];

test("SharpAPI main odds normalize to Edge Lab board contract", () => {
  const events = normalizeSharpApiBoardRows(mainRows, {
    league: "MLB",
    books: ["draftkings", "fanduel"],
    startsAfter: "2026-09-24T20:00:00Z",
    startsBefore: "2026-09-25T12:00:00Z",
    now: Date.parse("2026-09-24T23:40:00Z")
  });

  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.eventID, "sharpapi:mlb_hou_sea_2026-09-25");
  assert.equal(event.provider, "SharpAPI");
  assert.equal(event.matchup.away.name, "Seattle Mariners");
  assert.equal(event.matchup.home.name, "Houston Astros");
  assert.deepEqual(
    Object.keys(event.markets.moneyline.home.books).sort(),
    ["draftkings", "fanduel"]
  );
  assert.equal(
    event.markets.spread.home.books.draftkings.line,
    -1.5
  );
  assert.equal(
    event.markets.total.over.books.draftkings.line,
    8.5
  );
  assert.ok(
    Number.isFinite(event.markets.moneyline.home.consensus.odds)
  );
});

test("SharpAPI provider keeps requested sportsbook filtering local", () => {
  const events = normalizeSharpApiBoardRows(mainRows, {
    league: "MLB",
    books: ["fanduel"]
  });
  assert.equal(events.length, 1);
  assert.deepEqual(
    Object.keys(events[0].markets.moneyline.home.books),
    ["fanduel"]
  );
});

test("SharpAPI MLB props preserve player, side, line, and book", () => {
  const rows = [
    {
      sportsbook: "draftkings",
      event_id: "mlb_hou_sea_2026-09-25",
      sport: "baseball",
      league: "mlb",
      home_team: "Houston Astros",
      away_team: "Seattle Mariners",
      market_type: "player_strikeouts",
      stat_category: "strikeouts",
      player_name: "Hunter Brown",
      selection: "Over",
      selection_type: "over",
      odds_american: -115,
      line: 6.5,
      event_start_time: "2026-09-25T00:10:00Z",
      timestamp: "2026-09-24T23:35:00Z",
      is_live: false
    },
    {
      sportsbook: "draftkings",
      event_id: "mlb_hou_sea_2026-09-25",
      sport: "baseball",
      league: "mlb",
      home_team: "Houston Astros",
      away_team: "Seattle Mariners",
      market_type: "player_strikeouts",
      stat_category: "strikeouts",
      player_name: "Hunter Brown",
      selection: "Under",
      selection_type: "under",
      odds_american: -105,
      line: 6.5,
      event_start_time: "2026-09-25T00:10:00Z",
      timestamp: "2026-09-24T23:35:00Z",
      is_live: false
    },
    {
      sportsbook: "fanduel",
      event_id: "mlb_hou_sea_2026-09-25",
      sport: "baseball",
      league: "mlb",
      home_team: "Houston Astros",
      away_team: "Seattle Mariners",
      market_type: "player_total_bases",
      stat_category: "total_bases",
      player_name: "Jose Altuve",
      selection: "Over",
      selection_type: "over",
      odds_american: -110,
      line: 1.5,
      event_start_time: "2026-09-25T00:10:00Z",
      timestamp: "2026-09-24T23:35:00Z",
      is_live: false
    }
  ];

  const events = normalizeSharpApiMlbPropRows(rows, {
    books: ["draftkings", "fanduel"]
  });

  assert.equal(events.length, 1);
  const props = events[0].props;
  const strikeouts = props.find(
    (prop) => prop.statID === "pitching_strikeouts"
  );
  const totalBases = props.find(
    (prop) => prop.statID === "batting_totalBases"
  );

  assert.equal(strikeouts.playerName, "Hunter Brown");
  assert.equal(strikeouts.over.consensus.line, 6.5);
  assert.equal(strikeouts.under.consensus.line, 6.5);
  assert.equal(strikeouts.over.books.draftkings.odds, -115);
  assert.equal(totalBases.playerName, "Jose Altuve");
  assert.equal(totalBases.over.books.fanduel.line, 1.5);
});

test("SharpAPI requests use API key header and documented filters", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = null;
  let seenKey = null;

  globalThis.fetch = async (url, options = {}) => {
    seenUrl = String(url);
    seenKey = options.headers?.["X-API-Key"];
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      async text() {
        return JSON.stringify({
          data: [],
          pagination: {
            has_more: false,
            next_cursor: null
          }
        });
      }
    };
  };

  try {
    const result = await fetchSharpApiOdds({
      apiKey: "test-key",
      league: "MLB",
      market: "main",
      live: "false"
    });
    assert.deepEqual(result.payload.data, []);
    assert.equal(seenKey, "test-key");
    assert.match(seenUrl, /league=mlb/);
    assert.match(seenUrl, /market=main/);
    assert.match(seenUrl, /is_live=false/);
    assert.match(seenUrl, /is_main_line=true/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("SharpAPI NFL props normalize supported v2 markets", () => {
  const rows = [
    ["player_passing_yards", "passing_yards", "Patrick Mahomes", "over", 279.5, -110],
    ["player_passing_yards", "passing_yards", "Patrick Mahomes", "under", 279.5, -110],
    ["player_passing_touchdowns", "passing_touchdowns", "Patrick Mahomes", "over", 2.5, 115],
    ["player_rushing_yards", "rushing_yards", "Isiah Pacheco", "over", 67.5, -115],
    ["player_receptions", "receptions", "Travis Kelce", "over", 5.5, -120],
    ["player_receiving_yards", "receiving_yards", "Travis Kelce", "over", 64.5, -110]
  ].map(([market_type, stat_category, player_name, selection_type, line, odds_american]) => ({
    sportsbook: "draftkings",
    event_id: "nfl_kc_buf_2026-09-27",
    sport: "football",
    league: "nfl",
    home_team: "Buffalo Bills",
    away_team: "Kansas City Chiefs",
    market_type,
    stat_category,
    player_name,
    selection_type,
    selection: selection_type === "over" ? "Over" : "Under",
    odds_american,
    line,
    event_start_time: "2026-09-27T20:20:00Z",
    timestamp: "2026-09-27T18:00:00Z",
    is_live: false
  }));

  const events = normalizeSharpApiNflPropRows(rows, {
    books: ["draftkings"]
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].league, "NFL");
  assert.equal(events[0].sport, "FOOTBALL");
  const ids = new Set(events[0].props.map((prop) => prop.statID));
  assert.deepEqual(
    [...ids].sort(),
    [
      "passing_touchdowns",
      "passing_yards",
      "receiving_receptions",
      "receiving_yards",
      "rushing_yards"
    ]
  );
  const passing = events[0].props.find(
    (prop) => prop.statID === "passing_yards"
  );
  assert.equal(passing.playerName, "Patrick Mahomes");
  assert.equal(passing.over.books.draftkings.line, 279.5);
  assert.equal(passing.under.books.draftkings.line, 279.5);
});
