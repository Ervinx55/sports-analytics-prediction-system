import test from "node:test";
import assert from "node:assert/strict";
import {
  extractFinishedGames, parseHistoricalEventOdds, matchGames, collect
} from "../../scripts/nba/collect-first-half-history.mjs";

const event = {
  id: "event_1", commence_time: "2025-11-07T23:00:00Z",
  home_team: "Houston Rockets", away_team: "Phoenix Suns"
};
const score = {
  events: [{
    id: "401", date: event.commence_time,
    status: {type: {state: "post", completed: true}},
    competitions: [{
      competitors: [
        {homeAway: "home", team: {displayName: "Houston Rockets", name: "Rockets"},
          linescores: [{value: 25}, {value: 28}, {value: 28}, {value: 22}]},
        {homeAway: "away", team: {displayName: "Phoenix Suns", name: "Suns"},
          linescores: [{value: 30}, {value: 27}, {value: 18}, {value: 22}]}
      ]
    }]
  }]
};
const response = (json, status = 200) => ({ok: status === 200, status, json: async () => json});
const prices = {
  timestamp: "2025-11-07T22:40:00Z",
  data: {id: "event_1", bookmakers: [{
    key: "pinnacle",
    markets: [
      {key: "spreads", last_update: "2025-11-07T22:39:00Z",
        outcomes: [{name: "Houston Rockets", point: -7.5, price: -110}]},
      {key: "spreads_h1", last_update: "2025-11-07T22:39:00Z",
        outcomes: [
          {name: "Houston Rockets", point: -3.5, price: -115},
          {name: "Phoenix Suns", point: 3.5, price: 105}
        ]}
    ]
  }]}
};

test("scoreboard derives halftime from quarters 1 and 2, never full final", () => {
  const games = extractFinishedGames(score);
  assert.equal(games.length, 1);
  assert.equal(games[0].halftime_home_score, 53);
  assert.equal(games[0].halftime_away_score, 57);
  const notFinal = structuredClone(score);
  notFinal.events[0].status.type.state = "in";
  notFinal.events[0].status.type.completed = false;
  assert.equal(extractFinishedGames(notFinal).length, 0);
});

test("historical quote extractor never swaps in full-game spreads", () => {
  const result = parseHistoricalEventOdds(prices, event, "2025-11-07T22:40:00Z");
  assert.equal(result.market, "spreads_h1");
  assert.equal(result.quotes.length, 2);
  assert.equal(result.quotes[0].spread, -3.5);
  const noHalf = structuredClone(prices);
  noHalf.data.bookmakers[0].markets = [noHalf.data.bookmakers[0].markets[0]];
  assert.equal(parseHistoricalEventOdds(noHalf, event, "2025-11-07T22:40:00Z").quotes.length, 0);
});

test("quotes cannot be sourced after kickoff or from a later snapshot", () => {
  assert.throws(() => parseHistoricalEventOdds({
    ...prices, timestamp: "2025-11-07T23:01:00Z"
  }, event, "2025-11-07T23:01:00Z"), /tipoff/);
  assert.throws(() => parseHistoricalEventOdds(prices, event, "2025-11-07T22:35:00Z"), /newer than requested/);
});

test("event matching demands unique teams and compatible tipoffs", () => {
  const games = extractFinishedGames(score);
  assert.equal(matchGames(games, [event])[0].status, "MATCHED");
  assert.equal(matchGames(games, [{...event, away_team: "Utah Jazz"}])[0].status, "UNMATCHED");
});

test("score-only collector never touches paid endpoints or requires credentials", async () => {
  const requests = [];
  const report = await collect({
    date: "2025-11-07", scoresOnly: true,
    fetcher: async url => {
      requests.push(String(url));
      return response(score);
    }
  });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].includes("dates=20251107"));
  assert.equal(report.scores.length, 1);
  assert.ok(report.warnings.includes("NOT_BACKTEST_READY"));
  assert.equal(report.odds.length, 0);
});

test("paid collector calls historical events and spreads_h1 only", async () => {
  const urls = [];
  const report = await collect({
    date: "2025-11-07", scoresOnly: false, apiKey: "FAKE_KEY",
    fetcher: async url => {
      const u = new URL(String(url));
      urls.push(u);
      if (u.hostname === "site.api.espn.com") return response(score);
      if (u.pathname.endsWith("/events")) return response({data: [event]});
      if (u.pathname.endsWith("/odds")) return response(prices);
      throw new Error("Unexpected endpoint");
    }
  });
  assert.equal(urls.length, 3);
  assert.equal(urls[2].searchParams.get("markets"), "spreads_h1");
  assert.equal(urls[2].searchParams.get("oddsFormat"), "american");
  assert.equal(report.matches[0].status, "MATCHED");
  assert.equal(report.odds[0].quotes.length, 2);
  assert.ok(report.warnings.includes("NO_FROZEN_PREGAME_MODEL_FORECASTS"));
});

test("paid collection without key fails closed", async () => {
  await assert.rejects(() => collect({
    date: "2025-11-07", scoresOnly: false, apiKey: "",
    fetcher: async () => response(score)
  }), /THE_ODDS_API_KEY/);
});

test("historical trial rejects any request budget exceeding one event and ten credits", async () => {
  let calls = 0;
  await assert.rejects(() => collect({
    date:"2025-11-07", scoresOnly:false, apiKey:"MOCK",
    maxEvents:2,maxCredits:10,fetcher: async () => { calls++;return response(score); }
  }), /HISTORICAL_CREDIT_LIMIT/);
  assert.equal(calls,0);
});

test("scoreboard local date can match a game after midnight UTC", async () => {
  const lateEvent = {...event,id:"event_late",commence_time:"2025-11-08T01:00:00Z"};
  const localScore = structuredClone(score);
  localScore.events[0].date=lateEvent.commence_time;
  const report=await collect({
    date:"2025-11-07",scoresOnly:false,apiKey:"MOCK",
    maxEvents:1,maxCredits:11,
    fetcher: async url => {
      const u=new URL(String(url));
      if(u.hostname==="site.api.espn.com") return response(localScore);
      if(u.pathname.endsWith("/events")) return response({data:[lateEvent]});
      return response({...prices,timestamp:"2025-11-08T00:40:00Z",
        data:{...prices.data,id:"event_late",
          bookmakers:[{key:"book",markets:[{key:"spreads_h1",
            last_update:"2025-11-08T00:39:00Z",
            outcomes:[{name:"Houston Rockets",point:-3.5,price:-110}]}]}] }});
    }
  });
  assert.equal(report.matches[0].status,"MATCHED");
  assert.equal(report.odds[0].quotes.length,1);
  assert.equal(report.metadata.estimatedMaxCredits,11);
});

test("11-credit trial inspects free quota and fails before billable calls",async()=>{
 const calls=[];
 await assert.rejects(()=>collect({
  date:"2025-11-07",scoresOnly:false,apiKey:"MOCK",maxEvents:1,
  maxCredits:11,quotaLimitedTest:true,
  fetcher:async u=>{
   const url=new URL(String(u));calls.push(url.pathname);
   if(url.hostname==="site.api.espn.com") return response(score);
   return {...response([]),headers:new Headers({"x-requests-remaining":"10"})};
  }
 }),/Insufficient or unverified/);
 assert.equal(calls.length,2);
 assert.equal(calls.at(-1),"/v4/sports");
});

test("trial with missing quota header fails closed",async()=>{
 await assert.rejects(()=>collect({
  date:"2025-11-07",scoresOnly:false,apiKey:"MOCK",maxEvents:1,
  maxCredits:11,quotaLimitedTest:true,
  fetcher:async u=>new URL(String(u)).hostname==="site.api.espn.com"
   ? response(score) : response([])
 }),/Insufficient or unverified/);
});
