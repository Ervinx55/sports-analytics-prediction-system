const BOARD_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/board";
const DECISION_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/decision";

const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

// Baseball Savant 2024-2026 three-year rolling overall Park Factor.
// 100 = neutral. Sutter Health Park falls back to neutral until a stable
// three-year sample exists.
const PARK_FACTORS = {
  "Coors Field": 112,
  "Fenway Park": 103,
  "Target Field": 103,
  "Chase Field": 103,
  "Citizens Bank Park": 102,
  "Nationals Park": 102,
  "Oriole Park at Camden Yards": 102,
  "Kauffman Stadium": 101,
  "Yankee Stadium": 101,
  "Rogers Centre": 101,
  "Great American Ball Park": 101,
  "PNC Park": 101,
  "UNIQLO Field at Dodger Stadium": 101,
  "Dodger Stadium": 101,
  "Daikin Park": 100,
  "Comerica Park": 100,
  "Truist Park": 100,
  "loanDepot park": 100,
  "Progressive Field": 99,
  "Rate Field": 99,
  "Angel Stadium": 99,
  "Wrigley Field": 98,
  "American Family Field": 98,
  "Citi Field": 98,
  "Petco Park": 97,
  "Oracle Park": 97,
  "Busch Stadium": 97,
  "Tropicana Field": 97,
  "Globe Life Field": 94,
  "T-Mobile Park": 92,
  "Sutter Health Park": 100,
};

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 500) };
  }
  if (!r.ok) {
    throw new Error(
      `${r.status} ${url}: ${JSON.stringify(body).slice(0, 500)}`
    );
  }
  return body;
}

function teamKey(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function americanToDecimal(odds) {
  const o = num(odds);
  if (!o || o === 0) return null;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}

function expectedValue(p, odds) {
  const d = americanToDecimal(odds);
  if (d === null || p === null) return null;
  return p * d - 1;
}

function bestOdds(books = {}) {
  let best = null;
  let bestBook = null;
  for (const [book, v] of Object.entries(books || {})) {
    if (!v || v.available === false) continue;
    const o = num(v.odds);
    if (o === null) continue;
    if (best === null || o > best) {
      best = o;
      bestBook = book;
    }
  }
  return { odds: best, book: bestBook };
}

function parseWind(weather = {}) {
  const text = String(weather.wind || "");
  const speedMatch = text.match(/(\d+(?:\.\d+)?)\s*mph/i);
  const mph = speedMatch ? Number(speedMatch[1]) : null;

  let direction = "unknown";
  if (/out to/i.test(text)) direction = "out";
  else if (/in from/i.test(text)) direction = "in";
  else if (/left to right|right to left/i.test(text)) direction = "cross";

  return { text, mph, direction };
}

function environmentMultiplier(gameData = {}) {
  const venue = gameData.venue || {};
  const weather = gameData.weather || {};
  const field = venue.fieldInfo || {};
  const parkFactor = PARK_FACTORS[venue.name] ?? 100;
  const parkMultiplier = clamp(parkFactor / 100, 0.88, 1.14);

  const elevationFt = num(venue?.location?.elevation) ?? 0;
  const altitudeSensitivity = 1 + clamp(elevationFt / 5200, 0, 1) * 0.15;

  const roofType = String(field.roofType || "Unknown");
  const controlledRoof = /dome|retractable/i.test(roofType);
  const tempF = num(weather.temp);
  const wind = parseWind(weather);

  let temperatureMultiplier = 1;
  let windMultiplier = 1;
  const warnings = [];

  if (controlledRoof) {
    warnings.push(
      "Retractable/dome venue: outdoor weather effects are suppressed unless roof status is explicitly known."
    );
  } else {
    if (tempF !== null) {
      // Statcast notes ~1% batted-ball distance per +10F.
      // Runs move less than distance, so apply only 0.4% per 10F.
      const tempEffect =
        ((tempF - 70) / 10) * 0.004 * altitudeSensitivity;
      temperatureMultiplier = clamp(1 + tempEffect, 0.975, 1.025);
    } else {
      warnings.push("Official temperature is unavailable.");
    }

    if (wind.mph !== null) {
      const strength = clamp(wind.mph / 10, 0, 2.5);
      if (wind.direction === "out") {
        windMultiplier = 1 + 0.008 * strength * altitudeSensitivity;
      } else if (wind.direction === "in") {
        windMultiplier = 1 - 0.008 * strength * altitudeSensitivity;
      } else if (wind.direction === "cross") {
        windMultiplier = 1;
      }
      windMultiplier = clamp(windMultiplier, 0.97, 1.03);
    } else {
      warnings.push("Official wind speed is unavailable.");
    }
  }

  const totalMultiplier = clamp(
    parkMultiplier * temperatureMultiplier * windMultiplier,
    0.86,
    1.18
  );

  return {
    venue: venue.name || null,
    parkFactor,
    parkMultiplier: Number(parkMultiplier.toFixed(4)),
    elevationFt,
    altitudeSensitivity: Number(altitudeSensitivity.toFixed(4)),
    roofType,
    controlledRoof,
    weather: {
      condition: weather.condition || null,
      tempF,
      wind: wind.text || null,
      windMph: wind.mph,
      windDirection: wind.direction,
    },
    temperatureMultiplier: Number(temperatureMultiplier.toFixed(4)),
    windMultiplier: Number(windMultiplier.toFixed(4)),
    totalMultiplier: Number(totalMultiplier.toFixed(4)),
    warnings,
    note:
      "Park Factor already captures the park's baseline altitude/environment. Elevation only changes sensitivity to same-day temperature/wind so altitude is not double-counted.",
  };
}

async function teamStats(teamId, group) {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=${group}&season=2026`
  );
  return data?.stats?.[0]?.splits?.[0]?.stat || {};
}

async function pitcherStats(id) {
  if (!id) return null;
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=pitching&season=2026`
  );
  const split =
    data?.stats?.[0]?.splits?.find((x) => !x.team) ||
    data?.stats?.[0]?.splits?.[0];
  return split?.stat || null;
}

function baseTeamRuns(offense, opponentPitching, opponentStarter) {
  const games = Math.max(1, num(offense.gamesPlayed) || 1);
  const offenseRpg = (num(offense.runs) || 0) / games;

  const oppEra = num(opponentPitching.era);
  const starterEra = num(opponentStarter?.era);

  // Team offense plus opposing run-prevention baseline.
  let projected = offenseRpg;
  if (oppEra !== null) {
    projected = 0.60 * offenseRpg + 0.40 * oppEra;
  }

  // Starter accounts for roughly 5.3 innings, damped to avoid overreacting
  // to ERA alone.
  if (oppEra !== null && starterEra !== null) {
    projected += (starterEra - oppEra) * (5.3 / 9) * 0.45;
  }

  return {
    offenseRpg: Number(offenseRpg.toFixed(3)),
    opponentTeamEra: oppEra,
    opponentStarterEra: starterEra,
    neutralRuns: Number(clamp(projected, 2.2, 6.8).toFixed(3)),
  };
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-x * x);
  return sign * y;
}

function normalCdf(x, mean, sd) {
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

function totalProbability(mean, line, side) {
  if (mean === null || line === null) return null;
  // MLB game totals have substantial dispersion; 3.15 is deliberately conservative.
  const sd = 3.15;
  if (side === "over") return 1 - normalCdf(line, mean, sd);
  return normalCdf(line, mean, sd);
}

function moneylineVarianceAdjust(baseP, runMultiplier) {
  if (!(baseP > 0 && baseP < 1)) return null;
  // More scoring opportunities modestly strengthen the better team;
  // lower-scoring environments move both sides slightly toward 50/50.
  const centered = baseP - 0.5;
  const scale = Math.sqrt(clamp(runMultiplier, 0.86, 1.18));
  return clamp(0.5 + centered * scale, 0.02, 0.98);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  try {
    const gamePk = Number(req.query.gamePk);
    if (!gamePk) {
      return res.status(400).json({ error: "gamePk is required" });
    }

    const feed = await fetchJson(
      `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`
    );

    const away = feed?.gameData?.teams?.away;
    const home = feed?.gameData?.teams?.home;
    const starters = feed?.gameData?.probablePitchers || {};
    const startsAt = feed?.gameData?.datetime?.dateTime;
    const date =
      feed?.gameData?.datetime?.originalDate ||
      (startsAt
        ? new Date(startsAt).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10));

    const [
      awayHit,
      homeHit,
      awayPitch,
      homePitch,
      awayStarter,
      homeStarter,
      board,
      decision,
    ] = await Promise.all([
      teamStats(away.id, "hitting"),
      teamStats(home.id, "hitting"),
      teamStats(away.id, "pitching"),
      teamStats(home.id, "pitching"),
      pitcherStats(starters?.away?.id),
      pitcherStats(starters?.home?.id),
      fetchJson(
        `${BOARD_URL}?leagues=MLB&books=${BOOKS.join(",")}`
      ),
      fetchJson(
        `${DECISION_URL}?date=${encodeURIComponent(date)}`
      ),
    ]);

    const awayRuns = baseTeamRuns(awayHit, homePitch, homeStarter);
    const homeRuns = baseTeamRuns(homeHit, awayPitch, awayStarter);
    const neutralTotal = awayRuns.neutralRuns + homeRuns.neutralRuns;

    const environment = environmentMultiplier(feed?.gameData || {});
    const rawEnvironmentTotal = clamp(
      neutralTotal * environment.totalMultiplier,
      5.0,
      14.5
    );

    const boardEvent = (board?.events || []).find((e) => {
      const namesMatch =
        teamKey(e?.matchup?.away?.name) === teamKey(away.name) &&
        teamKey(e?.matchup?.home?.name) === teamKey(home.name);
      const timeMatch =
        !startsAt ||
        !e?.startsAt ||
        Math.abs(Date.parse(e.startsAt) - Date.parse(startsAt)) <=
          3 * 60 * 60 * 1000;
      return namesMatch && timeMatch;
    });

    const totalOver = boardEvent?.markets?.total?.over || null;
    const totalUnder = boardEvent?.markets?.total?.under || null;
    const marketLine =
      num(totalOver?.consensus?.line) ??
      num(totalUnder?.consensus?.line);

    const bookLines = [
      ...Object.values(totalOver?.books || {}),
      ...Object.values(totalUnder?.books || {}),
    ]
      .filter((x) => x && x.available !== false)
      .map((x) => num(x.line))
      .filter((x) => x !== null);
    const uniqueBookLines = [...new Set(bookLines.map((x) => Number(x)))];
    const marketSplit = uniqueBookLines.length > 1;

    // Shrink the independent run model toward the live market before using it
    // for betting decisions. This reduces overconfidence from a simple
    // season-level scoring model while preserving park/weather information.
    const projectedTotal =
      marketLine === null
        ? rawEnvironmentTotal
        : 0.65 * rawEnvironmentTotal + 0.35 * marketLine;

    const overBest = bestOdds(totalOver?.books || {});
    const underBest = bestOdds(totalUnder?.books || {});
    const overProb = totalProbability(projectedTotal, marketLine, "over");
    const underProb = totalProbability(projectedTotal, marketLine, "under");
    const overEv =
      overBest.odds === null ? null : expectedValue(overProb, overBest.odds);
    const underEv =
      underBest.odds === null ? null : expectedValue(underProb, underBest.odds);

    let totalLean = "PASS";
    if (marketLine !== null) {
      const diff = projectedTotal - marketLine;
      if (
        !marketSplit &&
        diff >= 0.65 &&
        (overEv ?? -1) >= 0.04
      ) {
        totalLean = "OVER_CANDIDATE";
      } else if (
        !marketSplit &&
        diff <= -0.65 &&
        (underEv ?? -1) >= 0.04
      ) {
        totalLean = "UNDER_CANDIDATE";
      } else if (Math.abs(diff) >= 0.35 || marketSplit) {
        totalLean = "WATCH";
      }
    }

    const gameDecision = (decision?.decisions || []).find(
      (d) => Number(d.mlbGamePk) === gamePk
    );

    let moneylineEnvironment = null;
    if (gameDecision) {
      const homeBase = num(
        gameDecision?.projection?.modelHomeWinProb
      );
      const awayBase = num(
        gameDecision?.projection?.modelAwayWinProb
      );
      const homeAdjusted = moneylineVarianceAdjust(
        homeBase,
        environment.totalMultiplier
      );
      const awayAdjusted =
        homeAdjusted === null ? null : 1 - homeAdjusted;

      moneylineEnvironment = {
        homeBaseProbability: homeBase,
        awayBaseProbability: awayBase,
        homeEnvironmentAdjustedProbability:
          homeAdjusted === null ? null : Number(homeAdjusted.toFixed(4)),
        awayEnvironmentAdjustedProbability:
          awayAdjusted === null ? null : Number(awayAdjusted.toFixed(4)),
        homeProbabilityAdjustmentPctPoints:
          homeAdjusted === null || homeBase === null
            ? null
            : Number(((homeAdjusted - homeBase) * 100).toFixed(2)),
        awayProbabilityAdjustmentPctPoints:
          awayAdjusted === null || awayBase === null
            ? null
            : Number(((awayAdjusted - awayBase) * 100).toFixed(2)),
        note:
          "Run environment only makes a small variance adjustment to moneyline probability: high-scoring environments slightly favor the stronger team; low-scoring environments compress toward 50/50.",
      };
    }

    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      version: "Run Environment v1",
      source: {
        gameWeatherVenue: "MLB Stats live feed",
        parkFactor:
          "Baseball Savant 2024-2026 three-year rolling overall Park Factor",
      },
      gamePk,
      matchup: { away: away.name, home: home.name },
      startsAt,
      environment,
      baseline: {
        away: awayRuns,
        home: homeRuns,
        neutralTotal: Number(neutralTotal.toFixed(2)),
      },
      totalProjection: {
        rawEnvironmentTotal: Number(rawEnvironmentTotal.toFixed(2)),
        projectedTotal: Number(projectedTotal.toFixed(2)),
        marketLine,
        marketSplit,
        availableBookLines: uniqueBookLines.sort((a, b) => a - b),
        differenceRuns:
          marketLine === null
            ? null
            : Number((projectedTotal - marketLine).toFixed(2)),
        over: {
          probability:
            overProb === null ? null : Number(overProb.toFixed(4)),
          bestBook: overBest.book,
          bestOdds: overBest.odds,
          evPct:
            overEv === null ? null : Number((overEv * 100).toFixed(2)),
        },
        under: {
          probability:
            underProb === null ? null : Number(underProb.toFixed(4)),
          bestBook: underBest.book,
          bestOdds: underBest.odds,
          evPct:
            underEv === null ? null : Number((underEv * 100).toFixed(2)),
        },
        decision: totalLean,
      },
      moneylineEnvironment,
      methodology: {
        temperature:
          "0.4% run-environment change per 10F from 70F, far smaller than Statcast's roughly 1% batted-ball-distance effect per 10F",
        wind:
          "direction-aware conservative adjustment, capped at +/-3%",
        altitude:
          "venue elevation from MLB is used to modestly scale same-day temperature/wind sensitivity; baseline altitude is not added again because Park Factor already captures it",
        roof:
          "outdoor weather adjustments are suppressed at dome/retractable venues unless roof status is explicitly known",
        calibration:
          "the independent park/weather total is shrunk 35% toward the live market before betting thresholds are applied; split total lines are never auto-promoted",
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: "Run environment model failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
