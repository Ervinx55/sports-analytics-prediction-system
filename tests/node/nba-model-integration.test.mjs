import test from "node:test";
import assert from "node:assert/strict";
import { loadNbaEspnHistory } from "../../sharp-service/lib/nba-espn-history.js";
import { projectEvent } from "../../sharp-service/lib/nba-model.js";
import handler from "../../sharp-service/api/nflmodel.js";

const now = "2026-10-22T18:00:00.000Z";
const response = body => new Response(JSON.stringify(body), { status: 200 });
function page(url, { postseason = false, ambiguous = false } = {}) {
  const day = new URL(url).searchParams.get("dates");
  const eventId = String(Number(day) + 400000000);
  const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T00:00:00Z`;
  return { leagues: [{ id: "46", uid: "s:40~l:46" }], events: [{
    id: eventId, uid: `s:40~l:46~e:${eventId}`, season: { type: postseason ? 3 : 2 },
    competitions: [{ id: eventId, date,
      status: { type: { name: "STATUS_FINAL", state: "post", completed: true } },
      competitors: [
        { id: "2", homeAway: "home", team: { id: "2", displayName: "Boston Celtics" }, score: "118" },
        { id: ambiguous ? "2" : "13", homeAway: "away",
          team: { id: ambiguous ? "2" : "13", displayName: "Los Angeles Lakers" }, score: "111" }
      ] }] }] };
}
function boardEvent() {
  return { eventID: "nba-test", startsAt: "2026-10-23T00:00:00Z",
    status: { started: false, live: false, completed: false, finalized: false },
    matchup: { home: { name: "Boston Celtics" }, away: { name: "Los Angeles Lakers" } },
    markets: { moneyline: { home: null, away: null }, spread: { home: null, away: null },
      total: { over: null, under: null } } };
}
function pricedMarkets(updatedAt) {
  const quote = odds => ({ consensus: { odds, line: null },
    books: { draftkings: { odds, line: null, updatedAt, available: true } } });
  return { moneyline: { home: quote(-110), away: quote(-110) },
    spread: { home: null, away: null }, total: { over: null, under: null } };
}
function mockRes() {
  return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

test("bounded ESPN regular-season finals yield real team projection after observation", async () => {
  let calls = 0;
  const history = await loadNbaEspnHistory({ targetAt: now, clock: () => now,
    teams: ["BOS", "LAL"], fetchImpl: async url => { calls++; return response(page(url)); } });
  assert.equal(history.ok, true);
  assert.equal(calls, 12);
  assert.equal(history.games.length, 12);
  assert.equal(history.games[0].home_team_score, 118);
  assert.equal(history.retrievedAt, now);
  const projection = projectEvent({ event: boardEvent(), games: history.games, season: 2026,
    simulationIterations: 100 });
  assert.equal(projection.available, true);
  assert.equal(projection.model.productionWeight, 0);
  assert.ok(Number.isFinite(projection.model.projectedHomeMargin));
  assert.equal(projection.teamFeatures.home.games, 12);
});

test("postseason and ambiguous finals cannot provide NBA model history", async () => {
  const post = await loadNbaEspnHistory({ targetAt: "2027-10-22T18:00:00Z",
    clock: () => "2027-10-22T18:00:00Z", teams: [],
    fetchImpl: async url => response(page(url, { postseason: true })) });
  assert.equal(post.ok, true);
  assert.equal(post.games.length, 0);
  assert.equal(projectEvent({ event: boardEvent(), games: post.games, season: 2027 }).available, false);
  const ambiguous = await loadNbaEspnHistory({ targetAt: "2028-10-22T18:00:00Z",
    clock: () => "2028-10-22T18:00:00Z", teams: [],
    fetchImpl: async url => response(page(url, { ambiguous: true })) });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, "INVALID_SCOREBOARD");
});

test("thin current-season history adds a bounded prior regular-season window", async () => {
  const targetAt = "2029-10-22T18:00:00Z";
  let calls = 0;
  const history = await loadNbaEspnHistory({ targetAt, clock: () => targetAt,
    teams: ["BOS", "LAL"], fetchImpl: async url => {
      calls++;
      const day = new URL(url).searchParams.get("dates");
      return response(day === "20291021" || day.startsWith("202904")
        ? page(url) : { leagues: [{ id: "46", uid: "s:40~l:46" }], events: [] });
    } });
  assert.equal(history.ok, true);
  assert.equal(history.previousSeasonWindow, true);
  assert.equal(calls, 24);
  assert.equal(history.games.length, 13);
  assert.equal(history.games.filter(game => game.season === 2028).length, 12);
});

test("handler returns shadow-only unavailable projections on ESPN failure", async () => {
  const priorFetch = globalThis.fetch, priorDateNow = Date.now;
  Date.now = () => Date.parse(now);
  globalThis.fetch = async url => String(url).includes("/api/board")
    ? response({ events: [{ ...boardEvent(), league: "NBA" }] })
    : new Response("", { status: 503 });
  try {
    const res = mockRes();
    await handler({ method: "GET", query: { nba: "1" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.productionEligible, false);
    assert.equal(res.body.productionWeight, 0);
    assert.equal(res.body.availableEventCount, 0);
    assert.equal(res.body.sourceHealth.games.status, "UNAVAILABLE");
    assert.equal(res.body.sourceHealth.injuries.status, "UNKNOWN");
    assert.equal(res.body.events[0].available, false);
  } finally { globalThis.fetch = priorFetch; Date.now = priorDateNow; }
});

test("unpriced ESPN-backed model remains visible but unavailable as a market projection", async () => {
  const priorFetch = globalThis.fetch;
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  globalThis.fetch = async url => String(url).includes("/api/board")
    ? response({ events: [{ ...boardEvent(), startsAt, league: "NBA" }] })
    : response(page(url));
  try {
    const res = mockRes();
    await handler({ method: "GET", query: { nba: "1" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.availableEventCount, 0);
    assert.equal(res.body.modelAvailableEventCount, 1);
    assert.equal(res.body.events[0].marketAvailable, false);
    assert.match(res.body.events[0].reason, /No current.*market quote pair/);
    assert.ok(Number.isFinite(res.body.events[0].model.projectedHomeMargin));
    assert.equal(res.body.forecastAt >= res.body.sourceHealth.games.retrievedAt, true);
    assert.equal(res.body.productionWeight, 0);
  } finally { globalThis.fetch = priorFetch; }
});

test("all 21 bounded NBA board events retain priced projection coverage", async () => {
  const priorFetch = globalThis.fetch;
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const updatedAt = new Date().toISOString();
  const events = Array.from({ length: 21 }, (_, index) => ({
    ...boardEvent(), eventID: `nba-${index + 1}`, league: "NBA", startsAt,
    markets: pricedMarkets(updatedAt)
  }));
  globalThis.fetch = async url => String(url).includes("/api/board")
    ? response({ events }) : response(page(url));
  try {
    const res = mockRes();
    await handler({ method: "GET", query: { nba: "1" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.eventCount, 21);
    assert.equal(res.body.events.length, 21);
    assert.equal(res.body.availableEventCount, 21);
    assert.equal(res.body.modelAvailableEventCount, 21);
    assert.equal(res.body.marketCount, 42);
    assert.equal(res.body.events.at(-1).eventID, "nba-21");
  } finally { globalThis.fetch = priorFetch; }
});

test("stale market quotes do not make a computed model available for markets", async () => {
  const priorFetch = globalThis.fetch;
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const staleAt = new Date(Date.now() - 11 * 60000).toISOString();
  globalThis.fetch = async url => String(url).includes("/api/board")
    ? response({ events: [{ ...boardEvent(), league: "NBA", startsAt,
      markets: pricedMarkets(staleAt) }] })
    : response(page(url));
  try {
    const res = mockRes();
    await handler({ method: "GET", query: { nba: "1" } }, res);
    assert.equal(res.body.modelAvailableEventCount, 1);
    assert.equal(res.body.availableEventCount, 0);
    assert.equal(res.body.marketCount, 0);
    assert.equal(res.body.events[0].marketAvailable, false);
  } finally { globalThis.fetch = priorFetch; }
});
