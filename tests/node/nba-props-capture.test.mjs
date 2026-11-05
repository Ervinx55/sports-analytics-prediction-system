import test from "node:test";
import assert from "node:assert/strict";
import nbaHandler, {
  normalizeSportsGameOddsNbaProps,
  observedNbaEvents
} from "../../sharp-service/handlers/nbaprops.js";
import nflHandler from "../../sharp-service/api/nflprops.js";
import { normalizeSharpApiNbaPropRows } from "../../sharp-service/lib/sharpapi-provider.js";

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function sharpRow(overrides = {}) {
  return {
    league: "nba", sport: "BASKETBALL", event_id: "123",
    event_start_time: new Date(Date.now() + 3_600_000).toISOString(),
    away_team: "Boston Celtics", home_team: "New York Knicks",
    sportsbook: "draftkings", market_type: "player_points",
    stat_category: "points", player_name: "Fixture Player",
    is_player_prop: true, is_live: false, is_active: true,
    selection_type: "over", line: 21.5, odds_american: -110,
    timestamp: new Date().toISOString(), ...overrides
  };
}

test("SharpAPI NBA rows map observed player props with both book sides", () => {
  const rows = [sharpRow(), sharpRow({ selection_type: "under", odds_american: -105 })];
  const events = observedNbaEvents(normalizeSharpApiNbaPropRows(rows));
  assert.equal(events.length, 1);
  assert.equal(events[0].players[0].prop.statID, "points");
  assert.equal(events[0].players[0].prop.playerName, "Fixture Player");
  assert.equal(events[0].players[0].prop.quoteState, "OBSERVED");
  assert.equal(events[0].players[0].prop.over.books.draftkings.line, 21.5);
  assert.equal(events[0].players[0].prop.under.books.draftkings.odds, -105);
  assert.equal(events[0].players[0].prop.espnPlayerID, null);
  assert.deepEqual(events[0].players[0].candidates, []);
});

test("SportsGameOdds keeps only named provider players and valid quotes", () => {
  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const raw = [{
    eventID: "sgo-event", leagueID: "NBA", status: { startsAt },
    players: { provider7: { name: "Named Provider Player" } },
    odds: {
      good: {
        statID: "rebounds", sideID: "over", playerID: "provider7",
        byBookmaker: { fanduel: { odds: 100, overUnder: 8.5, available: true } }
      },
      unnamed: {
        statID: "assists", sideID: "over", playerID: "opaque8",
        byBookmaker: { fanduel: { odds: -110, overUnder: 5.5 } }
      },
      invalid: {
        statID: "points", sideID: "over", playerName: "Bad Quote",
        byBookmaker: { fanduel: { odds: null, overUnder: 20.5 } }
      }
    }
  }];
  const events = observedNbaEvents(normalizeSportsGameOddsNbaProps(raw));
  assert.equal(events.length, 1);
  assert.equal(events[0].players.length, 1);
  assert.equal(events[0].players[0].prop.playerName, "Named Provider Player");
  assert.equal(events[0].players[0].prop.playerID, "provider7");
  assert.equal(events[0].players[0].prop.quoteState, "FRESHNESS_UNVERIFIED");
});

test("SportsGameOdds preserves alternate book thresholds without cross-line pairing", () => {
  const updatedAt = new Date().toISOString();
  const raw = [{ eventID: "alt", leagueID: "NBA",
    status: { startsAt: new Date(Date.now() + 3_600_000).toISOString() },
    players: { p1: { name: "Provider Player" } },
    odds: {
      over18: { statID: "points", sideID: "over", playerID: "p1", byBookmaker: {
        fanduel: { odds: -110, overUnder: 18.5, lastUpdatedAt: updatedAt } } },
      over20: { statID: "points", sideID: "over", playerID: "p1", byBookmaker: {
        fanduel: { odds: 110, overUnder: 20.5, lastUpdatedAt: updatedAt } } },
      under20: { statID: "points", sideID: "under", playerID: "p1", byBookmaker: {
        draftkings: { odds: -105, overUnder: 20.5, lastUpdatedAt: updatedAt } } }
    }
  }];
  const events = observedNbaEvents(normalizeSportsGameOddsNbaProps(raw));
  assert.equal(events[0].players.length, 2);
  const byLine = new Map(events[0].players.map((row) => [row.prop.over?.books.fanduel?.line, row.prop]));
  assert.equal(byLine.get(18.5).under, null);
  assert.equal(byLine.get(18.5).quoteState, "ONE_SIDED");
  assert.equal(byLine.get(20.5).under.books.draftkings.line, 20.5);
  assert.equal(byLine.get(20.5).quoteState, "OBSERVED");
});

test("SportsGameOdds live status is never recast as upcoming", () => {
  const raw = [{ eventID: "live", leagueID: "NBA",
    status: { startsAt: new Date(Date.now() + 3_600_000).toISOString(), live: true },
    odds: { x: { statID: "points", sideID: "over", playerName: "Player",
      byBookmaker: { fanduel: { odds: -110, overUnder: 20.5 } } } }
  }];
  assert.deepEqual(normalizeSportsGameOddsNbaProps(raw), []);
  assert.deepEqual(observedNbaEvents([{ league: "NBA", startsAt: raw[0].status.startsAt,
    status: { finalized: true }, props: [{ over: { books: { fanduel: { odds: -110, line: 20.5 } } } }] }]), []);
});

test("SharpAPI requires documented full-game player market IDs and active prematch rows", () => {
  const invalid = [
    sharpRow({ market_type: "team_points" }),
    sharpRow({ market_type: "player_first_quarter_points" }),
    sharpRow({ market_type: "1st_quarter_player_points" }),
    sharpRow({ market_type: "player_points_rebounds_assists" }),
    sharpRow({ market_ref: { id: "team_points" } }),
    sharpRow({ is_player_prop: false }),
    sharpRow({ is_live: true }),
    sharpRow({ is_active: false }),
    sharpRow({ is_stale_pregame_price: true }),
    sharpRow({ sport: "football" }),
    sharpRow({ league: "wnba" })
  ];
  assert.deepEqual(normalizeSharpApiNbaPropRows(invalid), []);
  const rows = normalizeSharpApiNbaPropRows([
    sharpRow({ market_type: "player_rebounds", stat_category: "rebounds" }),
    sharpRow({ market_type: "player_assists", stat_category: "assists" })
  ]);
  assert.deepEqual(rows[0].props.map((row) => row.statID).sort(), ["assists", "rebounds"]);
});

test("one fresh book never masks stale, undated, or future book quotes", () => {
  const now = Date.now();
  const rows = [
    sharpRow({ timestamp: new Date(now).toISOString() }),
    sharpRow({ selection_type: "under", timestamp: new Date(now - 3_600_000).toISOString() }),
    sharpRow({ player_name: "Undated", timestamp: null }),
    sharpRow({ player_name: "Undated", selection_type: "under", timestamp: new Date(now).toISOString() }),
    sharpRow({ player_name: "Future", timestamp: new Date(now + 60_000).toISOString() }),
    sharpRow({ player_name: "Future", selection_type: "under", timestamp: new Date(now).toISOString() })
  ];
  const props = observedNbaEvents(normalizeSharpApiNbaPropRows(rows), { now })[0].players;
  const byName = new Map(props.map((row) => [row.prop.playerName, row.prop]));
  assert.equal(byName.get("Fixture Player").quoteState, "STALE");
  assert.equal(byName.get("Fixture Player").under.books.draftkings.quoteState, "STALE");
  assert.equal(byName.get("Undated").quoteState, "FRESHNESS_UNVERIFIED");
  assert.equal(byName.get("Undated").over.books.draftkings.quoteState, "FRESHNESS_UNVERIFIED");
  assert.equal(byName.get("Future").quoteState, "FUTURE_TIMESTAMP");
  assert.equal(byName.get("Future").over.books.draftkings.quoteState, "FUTURE_TIMESTAMP");
});

test("invalid, stale, and one-sided quotes do not create plays", () => {
  const stale = new Date(Date.now() - 3_600_000).toISOString();
  const rows = [
    sharpRow({ timestamp: stale }),
    sharpRow({ selection_type: "under", timestamp: stale }),
    sharpRow({ player_name: "One Side", line: 6.5 }),
    sharpRow({ player_name: "Invalid", odds_american: null })
  ];
  const events = observedNbaEvents(normalizeSharpApiNbaPropRows(rows));
  const byName = new Map(events[0].players.map((player) => [player.prop.playerName, player]));
  assert.equal(byName.get("Fixture Player").prop.quoteState, "STALE");
  assert.equal(byName.get("One Side").prop.quoteState, "ONE_SIDED");
  assert.equal(byName.has("Invalid"), false);
  assert.ok(events[0].players.every((player) => player.candidates.length === 0));
});

test("NBA route returns observed markets and explicit unavailable prediction", async () => {
  const previous = {
    sgo: process.env.SPORTS_ODDS_API_KEY,
    sharp: process.env.SHARPAPI_KEY,
    theOdds: process.env.THE_ODDS_API_KEY,
    fetch: globalThis.fetch
  };
  delete process.env.SPORTS_ODDS_API_KEY;
  process.env.SHARPAPI_KEY = "fixture-key";
  delete process.env.THE_ODDS_API_KEY;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /league=nba/);
    return new Response(JSON.stringify({ data: [sharpRow(), sharpRow({ selection_type: "under" })], pagination: { has_more: false } }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  try {
    const res = response();
    await nflHandler({ method: "GET", query: { nba: "1" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.events[0].players[0].prop.statID, "points");
    assert.equal(res.body.oddsProvider, "SharpAPI");
    assert.equal(res.body.predictionAvailability, "UNAVAILABLE");
    assert.equal(res.body.reason, "PLAYER_IDENTITY_OR_AVAILABILITY_UNVERIFIED");
    assert.equal(res.body.productionEligible, false);
    assert.equal(res.body.productionWeight, 0);
    assert.deepEqual(res.body.candidates, []);
    assert.equal(res.body.sourceHealth.odds.status, "OBSERVED");
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [["SPORTS_ODDS_API_KEY", previous.sgo], ["SHARPAPI_KEY", previous.sharp], ["THE_ODDS_API_KEY", previous.theOdds]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("no NBA provider is unavailable; NFL route keeps its own response", async () => {
  const saved = [process.env.SPORTS_ODDS_API_KEY, process.env.SHARPAPI_KEY, process.env.THE_ODDS_API_KEY];
  delete process.env.SPORTS_ODDS_API_KEY;
  delete process.env.SHARPAPI_KEY;
  delete process.env.THE_ODDS_API_KEY;
  try {
    const nba = response();
    await nbaHandler({ method: "GET", query: {} }, nba);
    assert.equal(nba.statusCode, 503);
    assert.equal(nba.body.sourceHealth.odds.status, "UNAVAILABLE");
    const nfl = response();
    await nflHandler({ method: "GET", query: {} }, nfl);
    assert.equal(nfl.statusCode, 500);
    assert.match(nfl.body.error, /NFL player-prop/);
  } finally {
    for (const [key, value] of [["SPORTS_ODDS_API_KEY", saved[0]], ["SHARPAPI_KEY", saved[1]], ["THE_ODDS_API_KEY", saved[2]]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("unsupported provider props report unavailable rather than an empty healthy board", async () => {
  const savedKey = process.env.SHARPAPI_KEY;
  const savedSgo = process.env.SPORTS_ODDS_API_KEY;
  const savedFetch = globalThis.fetch;
  process.env.SHARPAPI_KEY = "fixture-key";
  delete process.env.SPORTS_ODDS_API_KEY;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "NBA props unavailable on this plan" }), {
    status: 422, headers: { "content-type": "application/json" }
  });
  try {
    const res = response();
    const startsAfter = new Date(Date.now() + 2 * 60_000).toISOString();
    const startsBefore = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    await nbaHandler({ method: "GET", query: { startsAfter, startsBefore } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.sourceHealth.odds.status, "UNAVAILABLE");
    assert.equal(res.body.providerFailures[0].provider, "SharpAPI");
    assert.equal(res.body.providerFailures[0].status, 422);
    assert.equal(res.body.predictionAvailability, "UNAVAILABLE");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.SHARPAPI_KEY; else process.env.SHARPAPI_KEY = savedKey;
    if (savedSgo === undefined) delete process.env.SPORTS_ODDS_API_KEY; else process.env.SPORTS_ODDS_API_KEY = savedSgo;
  }
});
