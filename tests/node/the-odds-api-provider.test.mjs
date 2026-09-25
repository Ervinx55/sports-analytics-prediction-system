import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchTheOddsApiBoardLeague,
  fetchTheOddsApiMlbProps,
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
