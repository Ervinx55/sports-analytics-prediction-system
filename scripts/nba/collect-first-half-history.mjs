/**
 * Read-only historical NBA first-half source collector (research staging only).
 *
 * Sources:
 *   - ESPN public game-scoreboard JSON, for actual quarter 1+2 scores.
 *   - The Odds API paid historical event odds, market spreads_h1 ONLY.
 *
 * This script DOES NOT infer pregame model features, sharp no-vig probabilities
 * at unmatched lines, or emit backtest-ready CSV. It intentionally returns a
 * staging JSON envelope with provenance and missing fields explicitly flagged.
 *
 * Commands:
 *   node scripts/nba/collect-first-half-history.mjs --date=2025-11-07 --scores-only
 *   THE_ODDS_API_KEY=... node scripts/nba/collect-first-half-history.mjs --date=2025-11-07 --historical-odds --regions=us --max-events=10
 *
 * Cost warning: Historical The Odds API endpoints require a paid plan and consume quota.
 * Never use an API key in a URL printed to logs or stored artifacts.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NBA_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const ODDS_BASE = "https://api.the-odds-api.com/v4/historical/sports/basketball_nba";
const MARKET = "spreads_h1";

function isoMs(dateString, name) {
  if (typeof dateString !== "string" || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(dateString)) {
    throw new Error(name + " must be timezone-aware ISO-8601");
  }
  const ts = Date.parse(dateString);
  if (!Number.isFinite(ts)) throw new Error(name + " is invalid");
  return ts;
}

export function normalizeTeam(value) {
  return String(value || "").toLowerCase()
    .replace(/\b(the|nba)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function extractHalfScore(competitor) {
  const lines = competitor?.linescores;
  if (!Array.isArray(lines) || lines.length < 2) return null;
  const scores = lines.slice(0, 2).map(x => Number(x?.value ?? x?.displayValue));
  return scores.every(Number.isFinite) ? scores[0] + scores[1] : null;
}

/** ESPN scoreboards: only FINAL competitions with quarter-level score data. */
export function extractFinishedGames(payload) {
  if (!Array.isArray(payload?.events)) throw new Error("ESPN scoreboard missing events");
  const rows = [];
  for (const event of payload.events) {
    const competition = event.competitions?.[0];
    if (!competition || !event.id || !event.date) continue;
    const state = competition.status?.type?.state || event.status?.type?.state;
    const completed = competition.status?.type?.completed ?? event.status?.type?.completed;
    if (state !== "post" && completed !== true) continue;
    const competitors = competition.competitors || [];
    const home = competitors.find(x => x.homeAway === "home");
    const away = competitors.find(x => x.homeAway === "away");
    if (!home || !away) continue;
    const homeHalf = extractHalfScore(home);
    const awayHalf = extractHalfScore(away);
    if (homeHalf === null || awayHalf === null) continue;
    const teams = x => ({
      display: x.team?.displayName || null,
      abbreviation: x.team?.abbreviation || null,
      name: x.team?.name || null
    });
    rows.push({
      game_id: "espn:" + event.id,
      tipoff_utc: new Date(isoMs(event.date, "event.date")).toISOString(),
      home_team: teams(home), away_team: teams(away),
      halftime_home_score: homeHalf, halftime_away_score: awayHalf,
      score_source: "espn_scoreboard", score_event_id: String(event.id)
    });
  }
  return rows;
}

function validAmerican(price) {
  const n = Number(price);
  return Number.isInteger(n) && n !== 0 && Math.abs(n) >= 100 ? n : null;
}

export function parseHistoricalEventOdds(payload, event, requestedAt) {
  const actualSnapshot = payload?.timestamp;
  if (!actualSnapshot) throw new Error("Historical odds timestamp is missing");
  const snapshotMs = isoMs(actualSnapshot, "historical snapshot timestamp");
  const tipoffMs = isoMs(event.commence_time, "event commence time");
  if (snapshotMs > isoMs(requestedAt, "requestedAt") || snapshotMs >= tipoffMs) {
    throw new Error("Historical odds snapshot at/after tipoff or newer than requested");
  }
  const data = payload.data || {};
  if (data.id && data.id !== event.id) throw new Error("Historical event ID mismatch");
  const books = [];
  for (const book of data.bookmakers || []) {
    for (const market of book.markets || []) {
      if (market.key !== MARKET) continue; // Never silently fall back to full-game spreads.
      const updated = market.last_update || book.last_update || actualSnapshot;
      const updateMs = isoMs(updated, "book quote timestamp");
      if (updateMs >= tipoffMs || updateMs > snapshotMs + 5 * 60000) continue;
      const outcomes = market.outcomes || [];
      for (const o of outcomes) {
        if (o.name !== event.home_team && o.name !== event.away_team) continue;
        const point = Number(o.point);
        const price = validAmerican(o.price);
        if (!Number.isFinite(point) || price === null) continue;
        books.push({
          bookmaker: book.key, bookmaker_title: book.title || book.key,
          side: o.name === event.home_team ? "home" : "away",
          spread: point, american_odds: price,
          quote_updated_utc: new Date(updateMs).toISOString()
        });
      }
    }
  }
  return {
    odds_event_id: event.id, requested_at: requestedAt,
    snapshot_at: new Date(snapshotMs).toISOString(),
    market: MARKET, home_team: event.home_team,
    away_team: event.away_team, tipoff_utc: event.commence_time,
    quotes: books,
    reasons: books.length ? [] : ["FIRST_HALF_SPREAD_MARKET_UNAVAILABLE"]
  };
}

export function matchGames(scoreGames, oddsEvents, toleranceMinutes = 180) {
  const results = [];
  const used = new Set();
  for (const event of oddsEvents) {
    const candidates = scoreGames.filter(g =>
      !used.has(g.game_id) &&
      Math.abs(Date.parse(g.tipoff_utc) - Date.parse(event.commence_time)) <= toleranceMinutes * 60000 &&
      [g.home_team.display, g.home_team.name].some(n => normalizeTeam(n) === normalizeTeam(event.home_team)) &&
      [g.away_team.display, g.away_team.name].some(n => normalizeTeam(n) === normalizeTeam(event.away_team))
    );
    // No guessing if the event cannot be matched uniquely.
    if (candidates.length !== 1) {
      results.push({odds_event_id: event.id, status: candidates.length ? "AMBIGUOUS" : "UNMATCHED"});
      continue;
    }
    const game = candidates[0];
    used.add(game.game_id);
    results.push({odds_event_id: event.id, status: "MATCHED", scoreboard: game});
  }
  return results;
}

/** Collect safely with injected fetch for deterministic tests. */
export async function collect({date, scoresOnly = true, apiKey, regions = "us",
  maxEvents = 1, maxCredits = 10, fetcher = fetch}) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) {
    throw new Error("--date must be YYYY-MM-DD");
  }
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 20) {
    throw new Error("--max-events must be between 1 and 20");
  }
  if (!/^[a-z0-9,]+$/.test(regions)) throw new Error("Invalid region list");
  if (!Number.isInteger(maxCredits) || maxCredits < 0 || maxCredits > 1000) throw new Error("Invalid maxCredits");
  const regionCount = regions.split(",").length;
  const creditPerEvent = 10 * regionCount;
  if (!scoresOnly && maxEvents * creditPerEvent > maxCredits) {
    throw new Error("HISTORICAL_CREDIT_LIMIT: estimated usage exceeds --max-credits");
  }
  const scoreboardUrl = new URL(NBA_SCOREBOARD);
  scoreboardUrl.searchParams.set("dates", date.replaceAll("-", ""));
  const scoreboardRes = await fetcher(scoreboardUrl);
  if (!scoreboardRes.ok) throw new Error("NBA scoreboard request failed: " + scoreboardRes.status);
  const games = extractFinishedGames(await scoreboardRes.json());
  const report = {
    kind: "nba_first_half_historical_staging_v1",
    market: MARKET, date, scores: games,
    odds: [], matches: [], warnings: ["NOT_BACKTEST_READY", "NO_FROZEN_PREGAME_MODEL_FORECASTS"],
    metadata: {scoreboard: "ESPN", oddsProvider: "The Odds API", paidOddsQueried: !scoresOnly,
      estimatedMaxCredits: scoresOnly ? 0 : maxEvents * creditPerEvent, creditsSpentReported: 0}
  };
  if (scoresOnly) return report;
  if (!apiKey) throw new Error("THE_ODDS_API_KEY required for paid historical odds");
  // Explicit 11-credit ceiling: one historical discovery (1) and one
  // event-market/region request (up to 10). Never retry billable requests.
  if (quotaLimitedTest) {
    if (maxEvents !== 1 || regions !== "us") {
      throw new Error("Quota-limited trial requires one event and region us");
    }
    const quotaUrl = new URL("https://api.the-odds-api.com/v4/sports");
    quotaUrl.searchParams.set("apiKey", apiKey);
    const quotaRes = await fetcher(quotaUrl);
    if (!quotaRes.ok) throw new Error("Free quota inspection failed: HTTP " + quotaRes.status);
    const raw = quotaRes.headers?.get?.("x-requests-remaining");
    const remaining = raw === null || raw === undefined || !/^\d+$/.test(raw)
      ? null : Number(raw);
    if (remaining === null || remaining < 11) {
      throw new Error("Insufficient or unverified API quota for 11-credit test");
    }
    report.metadata.quotaBefore = remaining;
    report.metadata.maxTrialCredits = 11;
  }
  // The snapshot is 20 minutes before each historical event tipoff.
  // Discover event IDs from a prior historical events snapshot for this date.
  const discoveryTime = date + "T12:00:00Z";
  const eventsUrl = new URL(ODDS_BASE + "/events");
  eventsUrl.searchParams.set("apiKey", apiKey);
  eventsUrl.searchParams.set("date", discoveryTime);
  const eventsRes = await fetcher(eventsUrl);
  if (!eventsRes.ok) throw new Error("Historical events discovery failed: HTTP " + eventsRes.status);
  const eventEnvelope = await eventsRes.json();
  if (quotaLimitedTest) {
    const raw = eventsRes.headers?.get?.("x-requests-remaining");
    if (raw === null || raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 10) {
      throw new Error("Remaining quota after discovery insufficient or unverified");
    }
  }
  const localGameDate = (iso) => {
    const pieces = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(iso));
    const part = name => pieces.find(p => p.type === name)?.value;
    return part("year") + "-" + part("month") + "-" + part("day");
  };
  const oddsEvents = (eventEnvelope?.data || []).filter(e =>
    e?.id && e?.commence_time && e.home_team && e.away_team
   );
  // Scoreboard date follows the NBA local slate; events after midnight UTC
  // may belong to the previous local date. Never filter on UTC date equality.
  const verifiedMatches = matchGames(games, oddsEvents);
  const matched = verifiedMatches.filter(m => m.status === "MATCHED");
  const included = matched.slice(0, maxEvents);
  const selectedIds = new Set(included.map(m => m.odds_event_id));
  report.matches = included;
  const matchedEvents = oddsEvents.filter(e => selectedIds.has(e.id));
  for (const e of matchedEvents) {
    const requestTime = new Date(Date.parse(e.commence_time) - 20 * 60000).toISOString();
    const url = new URL(ODDS_BASE + "/events/" + encodeURIComponent(e.id) + "/odds");
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("regions", regions);
    url.searchParams.set("markets", MARKET);
    url.searchParams.set("oddsFormat", "american");
    url.searchParams.set("date", requestTime);
    const response = await fetcher(url);
    const billed = Number(response.headers?.get?.("x-requests-last"));
    const remaining = Number(response.headers?.get?.("x-requests-remaining"));
    if (Number.isFinite(billed) && billed >= 0) report.metadata.creditsSpentReported += billed;
    report.metadata.remainingCredits = Number.isFinite(remaining) ? remaining : null;
    if (report.metadata.creditsSpentReported > maxCredits) {
      report.warnings.push("HISTORICAL_CREDIT_LIMIT_EXCEEDED_STOP");
    }
    if (!response.ok) {
      report.odds.push({odds_event_id: e.id, status: "UNAVAILABLE", httpStatus: response.status});
      continue;
    }
    try {
      report.odds.push(parseHistoricalEventOdds(await response.json(), e, requestTime));
    } catch (err) {
      report.odds.push({odds_event_id: e.id, status: "REJECTED", reason: err.message});
    }
    if (report.metadata.creditsSpentReported > maxCredits ||
        (Number.isFinite(remaining) && remaining < creditPerEvent)) break;
  }
  return report;
}

function option(name) {
  const value = process.argv.find(x => x.startsWith("--" + name + "="));
  return value ? value.slice(name.length + 3) : null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const date = option("date");
  const withOdds = process.argv.includes("--historical-odds");
  if (!date) {
    process.stderr.write("Usage: node scripts/nba/collect-first-half-history.mjs --date=YYYY-MM-DD [--historical-odds] [--output=path]\n");
    process.exitCode = 2;
  } else {
    try {
      const report = await collect({
        date, scoresOnly: !withOdds,
        apiKey: process.env.THE_ODDS_API_KEY,
        regions: option("regions") || "us",
        maxEvents: Number(option("max-events") || 1),
        maxCredits: Number(option("max-credits") || 10)
      });
      const out = option("output");
      if (out) {
        fs.mkdirSync(path.dirname(out), {recursive: true});
        fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
        process.stdout.write(JSON.stringify({scores: report.scores.length,
          oddsEvents: report.odds.length, output: out, backtestReady: false}) + "\n");
      } else process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } catch (e) {
      process.stderr.write("Historical collection failed: " + e.message + "\n");
      process.exitCode = 1;
    }
  }
}
