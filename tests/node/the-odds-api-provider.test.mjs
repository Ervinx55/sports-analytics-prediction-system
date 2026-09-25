import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchTheOddsApiBoardLeague,
  fetchTheOddsApiMlbProps,
  fetchTheOddsApiNflProps,
  fetchTheOddsApiNbaProps,
  getTheOddsApiUsageSnapshot,
  normalizeTheOddsApiBoard
} from "../../sharp-service/lib/the-odds-api-provider.js";

const event = {
  id: "evt-mlb-1",
  sport_key: "baseball_mlb",
  sport_title: "MLB",
  commence_time: "2026-09-25T00:10:00Z",
  home_team: "Houston Astros",
  away_team: "Seattle Mariners",
  bookmakers: [
    {
      key: "draftkings",
      title: "DraftKings",
      last_update: "2026-09-24T23:40:00Z",
      markets: [
        {
          key: "h2h",
          last_update: "2026-09-24T23:40:00Z",
          outcomes: [
            { name: "Seattle Mariners", price: 105 },
            { name: "Houston Astros", price: -125 }
          ]
        },
        {
          key: "spreads",
          last_update: "2026-09-24T23:40:00Z",
          outcomes: [
            { name: "Seattle Mariners", price: -170, point: 1.5 },
            { name: "Houston Astros", price: 145, point: -1.5 }
          ]
        },
        {
          key: "totals",
          last_update: "2026-09-24T23:40:00Z",
          outcomes: [
            { name: "Over", price: -110, point: 8.5 },
            { name: "Under", price: -110, point: 8.5 }
          ]
        }
      ]
    },
    {
      key: "williamhill_us",
      title: "Caesars",
      last_update: "2026-09-24T23:40:03Z",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Seattle Mariners", price: 102 },
            { name: "Houston Astros", price: -122 }
          ]
        }
      ]
    }
  ]
};

test("The Odds API main markets normalize into Edge Lab contract", () => {
  const events = normalizeTheOddsApiBoard([event], {
    league: "MLB",
    books: ["draftkings", "caesars"],
    startsAfter: "2026-09-24T20:00:00Z",
    startsBefore: "2026-09-25T12:00:00Z",
    live: "false",
    now: Date.parse("2026-09-24T23:45:00Z")
  });

  assert.equal(events.length, 1);
  const normalized = events[0];
  assert.equal(normalized.provider, "The Odds API");
  assert.equal(normalized.eventID, "theodds:evt-mlb-1");
  assert.equal(normalized.matchup.away.name, "Seattle Mariners");
  assert.equal(normalized.matchup.home.name, "Houston Astros");
  assert.equal(
    normalized.markets.spread.home.books.draftkings.line,
    -1.5
  );
  assert.equal(
    normalized.markets.total.over.books.draftkings.line,
    8.5
  );
  assert.deepEqual(
    Object.keys(normalized.markets.moneyline.home.books).sort(),
    ["caesars", "draftkings"]
  );
});

test("The Odds API board request uses featured markets and bookmaker aliases", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "x-requests-remaining": "497",
        "x-requests-used": "3",
        "x-requests-last": "3"
      }),
      async text() {
        return JSON.stringify([event]);
      }
    };
  };

  try {
    const result = await fetchTheOddsApiBoardLeague({
      apiKey: "test-key",
      league: "MLB",
      books: ["draftkings", "caesars"],
      startsAfter: "2026-09-24T20:00:00Z",
      startsBefore: "2026-09-25T12:00:00Z"
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, "The Odds API");
    assert.equal(result.events.length, 1);
    assert.match(requestedUrl, /baseball_mlb\/odds/);
    assert.match(requestedUrl, /markets=h2h%2Cspreads%2Ctotals/);
    assert.match(
      requestedUrl,
      /bookmakers=draftkings%2Cwilliamhill_us/
    );
    assert.match(requestedUrl, /oddsFormat=american/);
    assert.match(requestedUrl, /apiKey=test-key/);

    const usage = getTheOddsApiUsageSnapshot();
    assert.equal(usage.remaining, 497);
    assert.equal(usage.lastCost, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("The Odds API MLB props use free events discovery then event odds", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];

  globalThis.fetch = async (url) => {
    const raw = String(url);
    seen.push(raw);

    if (/\/events\?/.test(raw)) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "x-requests-remaining": "497",
          "x-requests-used": "3",
          "x-requests-last": "0"
        }),
        async text() {
          return JSON.stringify([
            {
              id: "evt-props-1",
              sport_key: "baseball_mlb",
              sport_title: "MLB",
              commence_time: "2026-09-25T00:10:00Z",
              home_team: "Houston Astros",
              away_team: "Seattle Mariners"
            }
          ]);
        }
      };
    }

    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "x-requests-remaining": "494",
        "x-requests-used": "6",
        "x-requests-last": "3"
      }),
      async text() {
        return JSON.stringify({
          id: "evt-props-1",
          sport_key: "baseball_mlb",
          sport_title: "MLB",
          commence_time: "2026-09-25T00:10:00Z",
          home_team: "Houston Astros",
          away_team: "Seattle Mariners",
          bookmakers: [
            {
              key: "draftkings",
              title: "DraftKings",
              markets: [
                {
                  key: "pitcher_strikeouts",
                  last_update: "2026-09-24T23:42:00Z",
                  outcomes: [
                    {
                      name: "Over",
                      description: "Hunter Brown",
                      price: -115,
                      point: 6.5
                    },
                    {
                      name: "Under",
                      description: "Hunter Brown",
                      price: -105,
                      point: 6.5
                    }
                  ]
                },
                {
                  key: "batter_hits",
                  outcomes: [
                    {
                      name: "Over",
                      description: "Jose Altuve",
                      price: -130,
                      point: 0.5
                    },
                    {
                      name: "Under",
                      description: "Jose Altuve",
                      price: 100,
                      point: 0.5
                    }
                  ]
                },
                {
                  key: "batter_total_bases",
                  outcomes: [
                    {
                      name: "Over",
                      description: "Jose Altuve",
                      price: -110,
                      point: 1.5
                    },
                    {
                      name: "Under",
                      description: "Jose Altuve",
                      price: -110,
                      point: 1.5
                    }
                  ]
                }
              ]
            }
          ]
        });
      }
    };
  };

  try {
    const result = await fetchTheOddsApiMlbProps({
      apiKey: "test-key",
      books: ["draftkings"],
      startsAfter: "2026-09-24T20:00:00Z",
      startsBefore: "2026-09-25T12:00:00Z"
    });

    assert.equal(result.source, "The Odds API");
    assert.equal(result.events.length, 1);
    assert.equal(seen.length, 2);
    assert.match(seen[0], /baseball_mlb\/events\?/);
    assert.match(
      seen[1],
      /markets=pitcher_strikeouts%2Cbatter_hits%2Cbatter_total_bases/
    );

    const props = result.events[0].props;
    const strikeouts = props.find(
      (prop) => prop.statID === "pitching_strikeouts"
    );
    const hits = props.find(
      (prop) => prop.statID === "batting_hits"
    );
    const totalBases = props.find(
      (prop) => prop.statID === "batting_totalBases"
    );

    assert.equal(strikeouts.playerName, "Hunter Brown");
    assert.equal(strikeouts.over.books.draftkings.line, 6.5);
    assert.equal(hits.playerName, "Jose Altuve");
    assert.equal(hits.over.books.draftkings.line, 0.5);
    assert.equal(totalBases.over.books.draftkings.line, 1.5);
    assert.equal(result.usage.remaining, 494);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("The Odds API NFL props request and normalize v2 markets", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];

  globalThis.fetch = async (url) => {
    const raw = String(url);
    seen.push(raw);

    if (/americanfootball_nfl\/events\?/.test(raw)) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "x-requests-remaining": "490",
          "x-requests-used": "10",
          "x-requests-last": "0"
        }),
        async text() {
          return JSON.stringify([{
            id: "evt-nfl-1",
            sport_key: "americanfootball_nfl",
            sport_title: "NFL",
            commence_time: "2026-09-27T20:20:00Z",
            home_team: "Buffalo Bills",
            away_team: "Kansas City Chiefs"
          }]);
        }
      };
    }

    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "x-requests-remaining": "485",
        "x-requests-used": "15",
        "x-requests-last": "5"
      }),
      async text() {
        return JSON.stringify({
          id: "evt-nfl-1",
          sport_key: "americanfootball_nfl",
          sport_title: "NFL",
          commence_time: "2026-09-27T20:20:00Z",
          home_team: "Buffalo Bills",
          away_team: "Kansas City Chiefs",
          bookmakers: [{
            key: "draftkings",
            title: "DraftKings",
            markets: [
              {
                key: "player_pass_yds",
                outcomes: [
                  { name: "Over", description: "Patrick Mahomes", price: -110, point: 279.5 },
                  { name: "Under", description: "Patrick Mahomes", price: -110, point: 279.5 }
                ]
              },
              {
                key: "player_pass_tds",
                outcomes: [
                  { name: "Over", description: "Patrick Mahomes", price: 115, point: 2.5 },
                  { name: "Under", description: "Patrick Mahomes", price: -145, point: 2.5 }
                ]
              },
              {
                key: "player_rush_yds",
                outcomes: [
                  { name: "Over", description: "Isiah Pacheco", price: -115, point: 67.5 }
                ]
              },
              {
                key: "player_receptions",
                outcomes: [
                  { name: "Over", description: "Travis Kelce", price: -120, point: 5.5 }
                ]
              },
              {
                key: "player_reception_yds",
                outcomes: [
                  { name: "Over", description: "Travis Kelce", price: -110, point: 64.5 }
                ]
              }
            ]
          }]
        });
      }
    };
  };

  try {
    const result = await fetchTheOddsApiNflProps({
      apiKey: "test-key-nfl",
      books: ["draftkings"],
      startsAfter: "2026-09-27T12:00:00Z",
      startsBefore: "2026-09-28T06:00:00Z"
    });

    assert.equal(result.source, "The Odds API");
    assert.equal(result.league, "NFL");
    assert.equal(result.events.length, 1);
    assert.match(seen[0], /americanfootball_nfl\/events\?/);
    assert.match(
      seen[1],
      /markets=player_pass_yds%2Cplayer_pass_tds%2Cplayer_rush_yds%2Cplayer_receptions%2Cplayer_reception_yds/
    );

    const ids = new Set(
      result.events[0].props.map((prop) => prop.statID)
    );
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
    assert.equal(
      result.events[0].props.find(
        (prop) => prop.statID === "passing_yards"
      ).over.books.draftkings.line,
      279.5
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("The Odds API NBA props request and normalize core markets", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];

  globalThis.fetch = async (url) => {
    const raw = String(url);
    seen.push(raw);

    if (/basketball_nba\/events\?/.test(raw)) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "x-requests-remaining": "480",
          "x-requests-used": "20",
          "x-requests-last": "0"
        }),
        async text() {
          return JSON.stringify([{
            id: "evt-nba-1",
            sport_key: "basketball_nba",
            sport_title: "NBA",
            commence_time: "2026-10-20T23:30:00Z",
            home_team: "Boston Celtics",
            away_team: "Los Angeles Lakers"
          }]);
        }
      };
    }

    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "x-requests-remaining": "468",
        "x-requests-used": "32",
        "x-requests-last": "12"
      }),
      async text() {
        return JSON.stringify({
          id: "evt-nba-1",
          sport_key: "basketball_nba",
          sport_title: "NBA",
          commence_time: "2026-10-20T23:30:00Z",
          home_team: "Boston Celtics",
          away_team: "Los Angeles Lakers",
          bookmakers: [{
            key: "draftkings",
            title: "DraftKings",
            markets: [
              {
                key: "player_points",
                outcomes: [
                  { name: "Over", description: "Jayson Tatum", price: -115, point: 27.5 },
                  { name: "Under", description: "Jayson Tatum", price: -105, point: 27.5 }
                ]
              },
              {
                key: "player_rebounds",
                outcomes: [
                  { name: "Over", description: "Jayson Tatum", price: -110, point: 8.5 },
                  { name: "Under", description: "Jayson Tatum", price: -110, point: 8.5 }
                ]
              },
              {
                key: "player_assists",
                outcomes: [
                  { name: "Over", description: "Jayson Tatum", price: 100, point: 5.5 },
                  { name: "Under", description: "Jayson Tatum", price: -130, point: 5.5 }
                ]
              },
              {
                key: "player_threes",
                outcomes: [
                  { name: "Over", description: "Jayson Tatum", price: -120, point: 3.5 },
                  { name: "Under", description: "Jayson Tatum", price: -110, point: 3.5 }
                ]
              },
              {
                key: "player_points_rebounds_assists",
                outcomes: [
                  { name: "Over", description: "Jayson Tatum", price: -110, point: 41.5 },
                  { name: "Under", description: "Jayson Tatum", price: -110, point: 41.5 }
                ]
              }
            ]
          }]
        });
      }
    };
  };

  try {
    const result = await fetchTheOddsApiNbaProps({
      apiKey: "test-key-nba",
      books: ["draftkings"],
      startsAfter: "2026-10-20T12:00:00Z",
      startsBefore: "2026-10-21T06:00:00Z"
    });

    assert.equal(result.source, "The Odds API");
    assert.equal(result.league, "NBA");
    assert.equal(result.events.length, 1);
    assert.match(seen[0], /basketball_nba\/events\?/);
    assert.match(seen[1], /player_points/);
    assert.match(seen[1], /player_rebounds/);
    assert.match(seen[1], /player_assists/);
    assert.match(seen[1], /player_points_rebounds_assists/);

    const props = result.events[0].props;
    const ids = new Set(props.map((prop) => prop.statID));
    assert.ok(ids.has("points"));
    assert.ok(ids.has("rebounds"));
    assert.ok(ids.has("assists"));
    assert.ok(ids.has("threes_made"));
    assert.ok(ids.has("points_rebounds_assists"));

    const points = props.find((prop) => prop.statID === "points");
    assert.equal(points.playerName, "Jayson Tatum");
    assert.equal(points.over.books.draftkings.line, 27.5);
    assert.equal(points.under.books.draftkings.odds, -105);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
