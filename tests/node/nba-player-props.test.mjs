import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import nbaPropsHandler from "../../sharp-service/api/nbaprops.js";
import {
  normalizePlayerName,
  parseMinutes,
  projectionFromHistory,
  statValue,
  exactPairs,
  marketIntegrity,
  officialInjuryContext,
  qualityScore,
  gradeProp
} from "../../sharp-service/lib/nba-player-props.js";

const originalFetch = globalThis.fetch;
const envNames = [
  "SPORTS_ODDS_API_KEY",
  "SHARPAPI_KEY",
  "THE_ODDS_API_KEY",
  "BALLDONTLIE_API_KEY"
];
const originalEnv = Object.fromEntries(
  envNames.map((name) => [name, process.env[name]])
);

function restoreEnv() {
  for (const name of envNames) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function createRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function invoke(query = {}, method = "GET") {
  const req = { method, query, headers: {} };
  const res = createRes();
  await nbaPropsHandler(req, res);
  return res;
}

function statRow({
  id,
  date,
  pts,
  reb,
  ast,
  fg3m,
  blk,
  stl,
  turnover,
  min
}) {
  return {
    id,
    pts,
    reb,
    ast,
    fg3m,
    blk,
    stl,
    turnover,
    min,
    player: {
      id: 1,
      first_name: "Jayson",
      last_name: "Tatum"
    },
    game: {
      id,
      date,
      datetime: `${date}T23:30:00Z`
    }
  };
}

const history = [
  statRow({ id: 1, date: "2026-10-01", pts: 24, reb: 8, ast: 5, fg3m: 3, blk: 1, stl: 1, turnover: 2, min: "34:00" }),
  statRow({ id: 2, date: "2026-10-03", pts: 28, reb: 9, ast: 6, fg3m: 4, blk: 0, stl: 2, turnover: 3, min: "36:00" }),
  statRow({ id: 3, date: "2026-10-05", pts: 31, reb: 7, ast: 4, fg3m: 5, blk: 1, stl: 1, turnover: 2, min: "37:30" }),
  statRow({ id: 4, date: "2026-10-07", pts: 27, reb: 10, ast: 7, fg3m: 3, blk: 1, stl: 0, turnover: 4, min: "35:00" }),
  statRow({ id: 5, date: "2026-10-09", pts: 29, reb: 8, ast: 5, fg3m: 4, blk: 2, stl: 1, turnover: 2, min: "36:30" }),
  statRow({ id: 6, date: "2026-10-11", pts: 33, reb: 11, ast: 6, fg3m: 5, blk: 1, stl: 2, turnover: 3, min: "38:00" })
];

function prop() {
  return {
    statID: "points",
    playerID: "JAYSON_TATUM_1_NBA",
    playerName: "Jayson Tatum",
    marketName: "Player Points",
    over: {
      consensus: { line: 28.5, odds: -110 },
      books: {
        draftkings: { line: 28.5, odds: -110, available: true },
        betmgm: { line: 28.5, odds: -105, available: true },
        fanduel: { line: 29.5, odds: -110, available: true }
      }
    },
    under: {
      consensus: { line: 28.5, odds: -110 },
      books: {
        draftkings: { line: 28.5, odds: -110, available: true },
        betmgm: { line: 28.5, odds: -115, available: true },
        fanduel: { line: 29.5, odds: -110, available: true }
      }
    }
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
  globalThis.__edgeLabSharpApi = {
    cache: new Map(),
    inFlight: new Map()
  };
  globalThis.__edgeLabNbaDataCache = new Map();
  globalThis.__edgeLabNbaPlayerCache = new Map();
});

test("NBA player helper normalizes names and minutes", () => {
  assert.equal(normalizePlayerName("Jayson Tatum Jr."), "jaysontatum");
  assert.equal(parseMinutes("36:30"), 36.5);
  assert.equal(parseMinutes("35"), 35);
});

test("NBA combo stats use the same underlying game row", () => {
  assert.equal(statValue(history[0], "points"), 24);
  assert.equal(
    statValue(history[0], "points_rebounds_assists"),
    37
  );
  assert.equal(
    statValue(history[0], "blocks_steals"),
    2
  );
});

test("NBA player projection combines rolling production and minutes", () => {
  const points = projectionFromHistory(
    history,
    "points",
    { beforeAt: "2026-10-20T23:30:00Z" }
  );
  const pra = projectionFromHistory(
    history,
    "points_rebounds_assists",
    { beforeAt: "2026-10-20T23:30:00Z" }
  );

  assert.equal(points.available, true);
  assert.equal(points.historyGames, 6);
  assert.ok(points.mean > 25 && points.mean < 34);
  assert.ok(points.projectedMinutes > 34);
  assert.ok(points.perMinuteRate > 0);
  assert.ok(points.sd > 0);

  assert.equal(pra.available, true);
  assert.ok(pra.mean > points.mean);
});

test("NBA exact prop pairs preserve sportsbook-specific lines", () => {
  const pairs = exactPairs(prop());
  assert.equal(pairs.length, 3);
  assert.equal(
    pairs.find((row) => row.book === "draftkings").line,
    28.5
  );
  assert.equal(
    pairs.find((row) => row.book === "fanduel").line,
    29.5
  );
});

test("Unparsed official injury status blocks shadow PLAY", () => {
  const projection = projectionFromHistory(
    history,
    "points",
    { beforeAt: "2026-10-20T23:30:00Z" }
  );
  const injury = officialInjuryContext({
    playerName: "Jayson Tatum",
    gameDate: "2026-10-20",
    secondary: {
      secondaryStatus: "PROBABLE",
      secondarySource: "BALLDONTLIE"
    }
  });

  const candidates = gradeProp({
    event: {
      eventID: "nba-lal-bos",
      startsAt: "2026-10-20T23:30:00Z",
      matchup: {
        away: { name: "Los Angeles Lakers" },
        home: { name: "Boston Celtics" }
      }
    },
    prop: prop(),
    projection,
    injury
  });

  assert.equal(injury.officialReportParsed, false);
  assert.equal(injury.resolvedForPlay, false);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((row) => row.status === "PASS"));
  assert.ok(candidates.every((row) => row.shadowStatus === "PASS"));
  assert.ok(candidates.every((row) => row.dataQuality <= 0.64));
});

test("Secondary OUT status hard-blocks NBA prop candidates", () => {
  const projection = projectionFromHistory(
    history,
    "points",
    { beforeAt: "2026-10-20T23:30:00Z" }
  );
  const injury = officialInjuryContext({
    playerName: "Jayson Tatum",
    gameDate: "2026-10-20",
    secondary: {
      secondaryStatus: "OUT",
      secondarySource: "BALLDONTLIE"
    }
  });

  const candidates = gradeProp({
    event: {
      eventID: "nba-lal-bos",
      startsAt: "2026-10-20T23:30:00Z",
      matchup: {
        away: { name: "Los Angeles Lakers" },
        home: { name: "Boston Celtics" }
      }
    },
    prop: prop(),
    projection,
    injury
  });

  assert.equal(injury.availabilityBlocked, true);
  assert.ok(candidates.every((row) => row.dataQuality <= 0.35));
  assert.ok(candidates.every((row) => row.shadowStatus === "PASS"));
});

test("NBA props API returns market-only PASS when player history is unavailable", async () => {
  delete process.env.SPORTS_ODDS_API_KEY;
  delete process.env.THE_ODDS_API_KEY;
  delete process.env.BALLDONTLIE_API_KEY;
  process.env.SHARPAPI_KEY = "test-sharp-key";

  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.startsWith("https://api.sharpapi.io/api/v1/odds")) {
      assert.equal(options.headers["X-API-Key"], "test-sharp-key");
      return new Response(JSON.stringify({
        data: [
          {
            sportsbook: "draftkings",
            event_id: "nba_lal_bos_2026-10-20",
            sport: "basketball",
            league: "nba",
            home_team: "Boston Celtics",
            away_team: "Los Angeles Lakers",
            market_type: "player_points",
            stat_category: "points",
            player_name: "Jayson Tatum",
            selection: "Over",
            selection_type: "over",
            odds_american: -110,
            line: 28.5,
            event_start_time: "2026-10-20T23:30:00Z",
            timestamp: "2026-10-20T21:00:00Z",
            is_live: false
          },
          {
            sportsbook: "draftkings",
            event_id: "nba_lal_bos_2026-10-20",
            sport: "basketball",
            league: "nba",
            home_team: "Boston Celtics",
            away_team: "Los Angeles Lakers",
            market_type: "player_points",
            stat_category: "points",
            player_name: "Jayson Tatum",
            selection: "Under",
            selection_type: "under",
            odds_american: -110,
            line: 28.5,
            event_start_time: "2026-10-20T23:30:00Z",
            timestamp: "2026-10-20T21:00:00Z",
            is_live: false
          }
        ],
        pagination: {
          has_more: false,
          next_cursor: null
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected fetch: ${value}`);
  };

  const response = await invoke({
    season: "2026",
    startsAfter: "2026-10-20T12:00:00Z",
    startsBefore: "2026-10-21T06:00:00Z"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.oddsProvider, "SharpAPI");
  assert.equal(response.body.productionEligible, false);
  assert.equal(
    response.body.sourceHealth.playerStats.status,
    "UNAVAILABLE"
  );
  assert.equal(response.body.candidateCount, 2);
  assert.equal(response.body.shadowPlayCount, 0);
  assert.ok(
    response.body.candidates.every(
      (row) =>
        row.status === "PASS" &&
        row.shadowStatus === "PASS" &&
        row.rawIndependentProbability === null
    )
  );
});

test("NBA props API rejects unsupported methods before fetching", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  };
  const response = await invoke({}, "POST");
  assert.equal(response.statusCode, 405);
  assert.equal(calls, 0);
});


test("NBA market integrity blocks isolated exact lines", () => {
  const pairs = exactPairs(prop());
  const isolated = pairs.find(
    (row) => row.book === "fanduel"
  );
  const integrity = marketIntegrity(
    pairs,
    isolated,
    "over",
    new Date("2026-10-20T21:05:00Z")
  );

  assert.equal(integrity.pairedBooks, 1);
  assert.equal(integrity.isolatedLine, true);
  assert.equal(integrity.blocked, true);
});

test("NBA market integrity blocks stale cross-book price outliers", () => {
  const pairs = [
    {
      book: "draftkings",
      line: 28.5,
      overOdds: 160,
      underOdds: -210,
      updatedAt: "2026-10-20T19:00:00Z"
    },
    {
      book: "fanduel",
      line: 28.5,
      overOdds: -110,
      underOdds: -110,
      updatedAt: "2026-10-20T21:00:00Z"
    },
    {
      book: "betmgm",
      line: 28.5,
      overOdds: -115,
      underOdds: -105,
      updatedAt: "2026-10-20T21:01:00Z"
    }
  ];

  const integrity = marketIntegrity(
    pairs,
    pairs[0],
    "over",
    new Date("2026-10-20T21:05:00Z")
  );

  assert.equal(integrity.stale, true);
  assert.equal(integrity.priceOutlier, true);
  assert.equal(integrity.staleOutlier, true);
  assert.equal(integrity.blocked, true);
  assert.ok(
    integrity.probabilityDeviationPctPoints > 5
  );
});

test("NBA market integrity keeps fresh aligned multi-book lines clear", () => {
  const pairs = [
    {
      book: "draftkings",
      line: 28.5,
      overOdds: -110,
      underOdds: -110,
      updatedAt: "2026-10-20T21:02:00Z"
    },
    {
      book: "fanduel",
      line: 28.5,
      overOdds: -105,
      underOdds: -115,
      updatedAt: "2026-10-20T21:01:00Z"
    },
    {
      book: "betmgm",
      line: 28.5,
      overOdds: -112,
      underOdds: -108,
      updatedAt: "2026-10-20T21:00:00Z"
    }
  ];

  const integrity = marketIntegrity(
    pairs,
    pairs[0],
    "over",
    new Date("2026-10-20T21:05:00Z")
  );

  assert.equal(integrity.pairedBooks, 3);
  assert.equal(integrity.stale, false);
  assert.equal(integrity.highDisagreement, false);
  assert.equal(integrity.blocked, false);
  assert.ok(integrity.score >= 0.9);
});


test("NBA role-change guard caps quality after a sudden minutes jump", () => {
  const roleHistory = [
    statRow({ id: 80, date: "2026-10-18", pts: 28, reb: 8, ast: 5, fg3m: 4, blk: 1, stl: 1, turnover: 2, min: "36:00" }),
    statRow({ id: 79, date: "2026-10-16", pts: 27, reb: 8, ast: 5, fg3m: 3, blk: 1, stl: 1, turnover: 2, min: "36:30" }),
    statRow({ id: 78, date: "2026-10-14", pts: 26, reb: 7, ast: 4, fg3m: 3, blk: 1, stl: 1, turnover: 2, min: "35:30" }),
    statRow({ id: 77, date: "2026-10-12", pts: 15, reb: 5, ast: 3, fg3m: 2, blk: 0, stl: 1, turnover: 1, min: "20:00" }),
    statRow({ id: 76, date: "2026-10-10", pts: 14, reb: 5, ast: 3, fg3m: 2, blk: 0, stl: 1, turnover: 1, min: "19:30" }),
    statRow({ id: 75, date: "2026-10-08", pts: 16, reb: 5, ast: 3, fg3m: 2, blk: 0, stl: 1, turnover: 1, min: "20:30" }),
    statRow({ id: 74, date: "2026-10-06", pts: 15, reb: 4, ast: 3, fg3m: 2, blk: 0, stl: 1, turnover: 1, min: "20:00" }),
    statRow({ id: 73, date: "2026-10-04", pts: 14, reb: 4, ast: 2, fg3m: 1, blk: 0, stl: 1, turnover: 1, min: "19:00" })
  ];

  const projection = projectionFromHistory(
    roleHistory,
    "points",
    { beforeAt: "2026-10-20T23:30:00Z" }
  );

  assert.equal(projection.roleChangeDetected, true);
  assert.ok(projection.minutesDelta >= 4.5);
  assert.ok(projection.roleStability < 0.75);

  const quality = qualityScore({
    projection,
    pairedBooks: 3,
    injury: {
      officialReportParsed: true,
      availabilityBlocked: false
    }
  });

  assert.ok(quality <= 0.69);
});
