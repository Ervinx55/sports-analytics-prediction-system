import {
  scorePlayerPropTensorflowShadow,
  tensorflowShadowMetadata
} from "../lib/tensorflow-shadow.js";

const PROPS_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/props";

const LEAGUE_K_RATE = 0.225;
const LEAGUE_H9 = 8.3;
const FINAL_WINDOW_MINUTES = 20;

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function normalizeName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store"
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

function impliedProbability(odds) {
  const o = num(odds);
  if (o === null || o === 0) return null;
  return o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100);
}

function americanToDecimal(odds) {
  const o = num(odds);
  if (o === null || o === 0) return null;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}

function expectedValue(winProb, pushProb, odds) {
  const d = americanToDecimal(odds);
  if (d === null || winProb === null || pushProb === null) return null;
  const lossProb = Math.max(0, 1 - winProb - pushProb);
  return winProb * (d - 1) - lossProb;
}

function poissonArray(lambda, max = 30) {
  if (!Number.isFinite(lambda) || lambda <= 0) return [];
  const out = [];
  let p = Math.exp(-lambda);
  out.push(p);
  let sum = p;
  for (let k = 1; k <= max; k++) {
    p *= lambda / k;
    out.push(p);
    sum += p;
  }
  if (sum > 0) {
    for (let i = 0; i < out.length; i++) out[i] /= sum;
  }
  return out;
}

function normalizeDistribution(dist) {
  const sum = dist.reduce((a, b) => a + b, 0);
  return sum > 0 ? dist.map((x) => x / sum) : dist;
}

function convolve(a, b) {
  const out = Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      out[i + j] += a[i] * b[j];
    }
  }
  return out;
}

function repeatedDistribution(single, n) {
  let out = [1];
  for (let i = 0; i < n; i++) out = convolve(out, single);
  return normalizeDistribution(out);
}

function mixedAtBatDistribution(single, expectedAB) {
  const lo = Math.max(1, Math.floor(expectedAB));
  const hi = lo + 1;
  const frac = clamp(expectedAB - lo, 0, 1);
  const a = repeatedDistribution(single, lo);
  const b = repeatedDistribution(single, hi);
  const len = Math.max(a.length, b.length);
  const out = Array(len).fill(0);
  for (let i = 0; i < len; i++) {
    out[i] =
      (1 - frac) * (a[i] || 0) +
      frac * (b[i] || 0);
  }
  return normalizeDistribution(out);
}

function distributionSideProbability(dist, line, side) {
  if (!Array.isArray(dist) || !dist.length || line === null) return null;
  let win = 0;
  let push = 0;
  let loss = 0;
  const isInteger = Math.abs(line - Math.round(line)) < 1e-9;
  for (let k = 0; k < dist.length; k++) {
    const p = dist[k];
    const diff = k - line;
    if (side === "over") {
      if (diff > 1e-9) win += p;
      else if (isInteger && Math.abs(diff) <= 1e-9) push += p;
      else loss += p;
    } else {
      if (diff < -1e-9) win += p;
      else if (isInteger && Math.abs(diff) <= 1e-9) push += p;
      else loss += p;
    }
  }
  const total = win + push + loss;
  return total > 0
    ? { win: win / total, push: push / total, loss: loss / total }
    : null;
}

function blendWithMarket(dist, marketFair, weight = 0.65) {
  if (!dist) return null;
  if (marketFair === null) return dist;
  const nonPush = Math.max(0, 1 - dist.push);
  if (nonPush <= 0) return dist;
  const rawConditional = dist.win / nonPush;
  const blendedConditional =
    weight * rawConditional + (1 - weight) * marketFair;
  return {
    win: nonPush * blendedConditional,
    push: dist.push,
    loss: nonPush * (1 - blendedConditional),
    rawWin: dist.win
  };
}

function poissonSideProbability(lambda, line, side) {
  const probs = poissonArray(lambda, Math.max(30, Math.ceil(lambda + 10 * Math.sqrt(lambda + 1))));
  if (!probs.length || line === null) return null;

  let win = 0;
  let push = 0;
  let loss = 0;
  const isInteger = Math.abs(line - Math.round(line)) < 1e-9;

  for (let k = 0; k < probs.length; k++) {
    const p = probs[k];
    const diff = k - line;
    if (side === "over") {
      if (diff > 1e-9) win += p;
      else if (isInteger && Math.abs(diff) <= 1e-9) push += p;
      else loss += p;
    } else {
      if (diff < -1e-9) win += p;
      else if (isInteger && Math.abs(diff) <= 1e-9) push += p;
      else loss += p;
    }
  }

  const total = win + push + loss;
  if (total <= 0) return null;
  return {
    win: win / total,
    push: push / total,
    loss: loss / total
  };
}

function timeToStartMinutes(startsAt) {
  const t = Date.parse(startsAt || "");
  if (!Number.isFinite(t)) return null;
  return (t - Date.now()) / 60000;
}

function missingStatus(startsAt) {
  const mins = timeToStartMinutes(startsAt);
  return mins !== null && mins <= FINAL_WINDOW_MINUTES ? "PASS" : "PENDING";
}

function bestPriceAtLine(sideMarket, line) {
  let bestOdds = null;
  let bestBook = null;
  let count = 0;
  for (const [book, p] of Object.entries(sideMarket?.books || {})) {
    if (!p || p.available === false) continue;
    if (num(p.line) === null || Math.abs(num(p.line) - line) > 1e-9) continue;
    const odds = num(p.odds);
    if (odds === null) continue;
    count++;
    if (bestOdds === null || odds > bestOdds) {
      bestOdds = odds;
      bestBook = book;
    }
  }
  return { bestOdds, bestBook, count };
}

function exactLineMarket(prop, line) {
  const paired = [];
  for (const book of new Set([
    ...Object.keys(prop?.over?.books || {}),
    ...Object.keys(prop?.under?.books || {})
  ])) {
    const o = prop?.over?.books?.[book];
    const u = prop?.under?.books?.[book];
    if (!o || !u || o.available === false || u.available === false) continue;
    if (
      num(o.line) === null ||
      num(u.line) === null ||
      Math.abs(num(o.line) - line) > 1e-9 ||
      Math.abs(num(u.line) - line) > 1e-9
    ) continue;
    const po = impliedProbability(o.odds);
    const pu = impliedProbability(u.odds);
    if (po === null || pu === null || po + pu <= 0) continue;
    paired.push({
      book,
      overFair: po / (po + pu),
      underFair: pu / (po + pu)
    });
  }

  const avg = (xs) =>
    xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

  return {
    pairedBooks: paired.length,
    overFair: avg(paired.map((x) => x.overFair)),
    underFair: avg(paired.map((x) => x.underFair)),
    overBest: bestPriceAtLine(prop.over, line),
    underBest: bestPriceAtLine(prop.under, line)
  };
}

function uniqueLines(prop) {
  const lines = [];
  for (const side of ["over", "under"]) {
    for (const p of Object.values(prop?.[side]?.books || {})) {
      if (!p || p.available === false) continue;
      const l = num(p.line);
      if (l !== null) lines.push(l);
    }
  }
  return [...new Set(lines.map(Number))].sort((a, b) => a - b);
}

function findOfficialPlayer(feed, playerName) {
  const target = normalizeName(playerName);
  const gamePlayers = feed?.gameData?.players || {};
  for (const [key, p] of Object.entries(gamePlayers)) {
    if (normalizeName(p?.fullName) === target) {
      return {
        id: Number(String(key).replace("ID", "")),
        name: p?.fullName || playerName
      };
    }
  }
  return null;
}

function playerSide(feed, playerId) {
  for (const side of ["away", "home"]) {
    if (feed?.liveData?.boxscore?.teams?.[side]?.players?.[`ID${playerId}`]) {
      return side;
    }
  }
  return null;
}

function lineupInfo(feed, side, playerId) {
  const teamBox = feed?.liveData?.boxscore?.teams?.[side] || {};
  const order = Array.isArray(teamBox.battingOrder)
    ? teamBox.battingOrder.map(Number)
    : [];
  const idx = order.indexOf(Number(playerId));
  return {
    confirmed: order.length >= 9,
    inLineup: idx >= 0,
    spot: idx >= 0 ? idx + 1 : null,
    battingOrder: order
  };
}

function boxPlayer(feed, side, playerId) {
  return feed?.liveData?.boxscore?.teams?.[side]?.players?.[`ID${playerId}`] || null;
}

function weightedOpponentKRate(feed, side) {
  const teamBox = feed?.liveData?.boxscore?.teams?.[side] || {};
  const order = Array.isArray(teamBox.battingOrder)
    ? teamBox.battingOrder.map(Number)
    : [];
  if (order.length < 9) return null;

  const weights = [1.12, 1.10, 1.08, 1.07, 1.04, 1.00, 0.96, 0.92, 0.88];
  let numSum = 0;
  let den = 0;
  for (let i = 0; i < order.length; i++) {
    const season = teamBox.players?.[`ID${order[i]}`]?.seasonStats?.batting || {};
    const k = num(season.strikeOuts);
    const pa = num(season.plateAppearances);
    if (k === null || pa === null || pa <= 0) continue;
    const w = weights[i] || 0.85;
    numSum += (k / pa) * w;
    den += w;
  }
  return den > 0 ? numSum / den : null;
}

function pitcherProjection(feed, player, side) {
  const other = side === "home" ? "away" : "home";
  const probableId = Number(feed?.gameData?.probablePitchers?.[side]?.id);
  const isStarter = probableId === Number(player.id);
  if (!isStarter) {
    return {
      available: false,
      temporary:
        !Number.isFinite(probableId) || probableId <= 0,
      reason: "player is not the official probable starter"
    };
  }

  const season = boxPlayer(feed, side, player.id)?.seasonStats?.pitching || {};
  const k = num(season.strikeOuts);
  const bf = num(season.battersFaced);
  const gs = num(season.gamesStarted);
  const pitches = num(season.pitchesThrown) ?? num(season.numberOfPitches);
  const oppKRate = weightedOpponentKRate(feed, other);

  if (
    k === null ||
    bf === null ||
    bf <= 0 ||
    gs === null ||
    gs < 5 ||
    oppKRate === null
  ) {
    return {
      available: false,
      temporary: oppKRate === null,
      reason:
        oppKRate === null
          ? "opponent starting lineup is not confirmed"
          : "starter sample is too small for the strikeout model"
    };
  }

  const kPerBF = k / bf;
  const bfPerStart = bf / gs;
  const opponentFactor = clamp(oppKRate / LEAGUE_K_RATE, 0.85, 1.15);
  const rawLambda = kPerBF * bfPerStart * opponentFactor;
  const reliability = clamp(gs / 18, 0, 1);
  const regressedLambda =
    reliability * rawLambda +
    (1 - reliability) * (LEAGUE_K_RATE * bfPerStart);

  return {
    available: true,
    lambda: clamp(regressedLambda, 1.0, 12.0),
    reliability,
    inputs: {
      strikeouts: k,
      battersFaced: bf,
      gamesStarted: gs,
      pitchesPerStart:
        pitches === null ? null : Number((pitches / gs).toFixed(1)),
      kPerBF: Number(kPerBF.toFixed(4)),
      opponentKRate: Number(oppKRate.toFixed(4)),
      opponentFactor: Number(opponentFactor.toFixed(3))
    },
    methodology:
      "Starter season K per batter faced × season batters faced per start, adjusted conservatively for the confirmed opponent lineup strikeout rate and regressed toward league-average K rate."
  };
}

function battingProjection(feed, player, side, statID) {
  const lineup = lineupInfo(feed, side, player.id);
  if (!lineup.confirmed) {
    return {
      available: false,
      temporary: true,
      reason: "starting lineup is not confirmed"
    };
  }
  if (!lineup.inLineup) {
    return {
      available: false,
      temporary: false,
      reason: "player is not in the confirmed starting lineup"
    };
  }

  const season = boxPlayer(feed, side, player.id)?.seasonStats?.batting || {};
  const pa = num(season.plateAppearances);
  const ab = num(season.atBats);
  const hits = num(season.hits);
  const doubles = num(season.doubles);
  const triples = num(season.triples);
  const homeRuns = num(season.homeRuns);
  const totalBases = num(season.totalBases);

  if (
    pa === null ||
    ab === null ||
    ab <= 0 ||
    pa < 100 ||
    hits === null ||
    doubles === null ||
    triples === null ||
    homeRuns === null ||
    totalBases === null
  ) {
    return {
      available: false,
      temporary: false,
      reason: "hitter season sample is too small for the prop model"
    };
  }

  const other = side === "home" ? "away" : "home";
  const opponentStarterId = Number(feed?.gameData?.probablePitchers?.[other]?.id);
  const opponentPitcher = Number.isFinite(opponentStarterId)
    ? boxPlayer(feed, other, opponentStarterId)?.seasonStats?.pitching || {}
    : {};

  const h9 = num(opponentPitcher.hitsPer9Inn);
  const pitcherFactor =
    h9 === null
      ? 1
      : clamp(1 + 0.30 * (h9 / LEAGUE_H9 - 1), 0.92, 1.08);

  const paBySpot = [4.72, 4.62, 4.53, 4.45, 4.36, 4.27, 4.16, 4.05, 3.94];
  const projectedPA = paBySpot[(lineup.spot || 9) - 1] || 4.0;
  const abPerPA = clamp(ab / pa, 0.72, 0.95);
  const projectedAB = clamp(projectedPA * abPerPA, 3.0, 4.6);
  const reliability = clamp(pa / 500, 0, 1);

  const singles = Math.max(0, hits - doubles - triples - homeRuns);

  let singleAB;
  if (statID === "batting_hits") {
    const rawHitRate = hits / ab;
    const regressed =
      reliability * rawHitRate + (1 - reliability) * 0.245;
    const pHit = clamp(regressed * pitcherFactor, 0.14, 0.38);
    singleAB = [1 - pHit, pHit];
  } else {
    const leagueRates = {
      single: 0.160,
      double: 0.045,
      triple: 0.004,
      homeRun: 0.031
    };
    let p1 =
      (reliability * (singles / ab) +
        (1 - reliability) * leagueRates.single) *
      pitcherFactor;
    let p2 =
      (reliability * (doubles / ab) +
        (1 - reliability) * leagueRates.double) *
      pitcherFactor;
    let p3 =
      (reliability * (triples / ab) +
        (1 - reliability) * leagueRates.triple) *
      pitcherFactor;
    let p4 =
      (reliability * (homeRuns / ab) +
        (1 - reliability) * leagueRates.homeRun) *
      pitcherFactor;

    const hitProb = p1 + p2 + p3 + p4;
    if (hitProb > 0.42) {
      const scale = 0.42 / hitProb;
      p1 *= scale;
      p2 *= scale;
      p3 *= scale;
      p4 *= scale;
    }
    singleAB = [1 - p1 - p2 - p3 - p4, p1, p2, p3, p4];
  }

  const distribution = mixedAtBatDistribution(singleAB, projectedAB);
  const mean = distribution.reduce((sum, p, k) => sum + p * k, 0);

  return {
    available: true,
    distribution,
    lambda: mean,
    reliability,
    inputs: {
      lineupSpot: lineup.spot,
      plateAppearances: pa,
      atBats: ab,
      projectedPA: Number(projectedPA.toFixed(2)),
      projectedAB: Number(projectedAB.toFixed(2)),
      seasonHits: hits,
      seasonTotalBases: totalBases,
      seasonSingles: singles,
      seasonDoubles: doubles,
      seasonTriples: triples,
      seasonHomeRuns: homeRuns,
      opponentStarterHitsPer9: h9,
      opponentPitcherFactor: Number(pitcherFactor.toFixed(3))
    },
    methodology:
      statID === "batting_hits"
        ? "Confirmed batting-order opportunity with a regressed per-at-bat hit probability; game hits are modeled from the mixed 3/4/5-at-bat binomial distribution."
        : "Confirmed batting-order opportunity with regressed per-at-bat single/double/triple/home-run rates; total bases are modeled by convolving the hitter's base-outcome distribution across expected at-bats."
  };
}

function candidateStatus({
  projection,
  startsAt,
  pairedBooks,
  sideBookCount,
  edge,
  ev
}) {
  if (!projection?.available) {
    if (projection?.temporary) {
      return {
        status: missingStatus(startsAt),
        reason:
          missingStatus(startsAt) === "PASS"
            ? `${projection.reason}; required information was still missing inside the final ${FINAL_WINDOW_MINUTES}-minute window`
            : projection.reason
      };
    }
    return { status: "PASS", reason: projection?.reason || "model unavailable" };
  }

  if (pairedBooks < 1 || sideBookCount < 2) {
    return {
      status: "PASS",
      reason: "insufficient exact-line two-sided market coverage"
    };
  }

  if (
    projection.reliability < 0.75 ||
    edge === null ||
    ev === null ||
    edge < 0.06 ||
    ev < 0.06
  ) {
    return {
      status: "PASS",
      reason: "model edge/EV/data-quality threshold not met"
    };
  }

  return {
    status: "PLAY",
    reason:
      "confirmed role/lineup, strong sample, exact-line market coverage, >=6 pp edge and >=6% modeled EV after market shrinkage"
  };
}

async function gameFeedForEvent(event, scheduleGames, feedCache) {
  const away = normalizeName(event.matchup?.away?.name);
  const home = normalizeName(event.matchup?.home?.name);
  const eventMs = Date.parse(event.startsAt || "");

  const game = scheduleGames
    .filter((g) =>
      normalizeName(g?.teams?.away?.team?.name) === away &&
      normalizeName(g?.teams?.home?.team?.name) === home
    )
    .sort((a, b) => {
      const da = Math.abs(Date.parse(a.gameDate || "") - eventMs);
      const db = Math.abs(Date.parse(b.gameDate || "") - eventMs);
      return da - db;
    })[0];

  if (!game?.gamePk) return null;
  if (!feedCache.has(game.gamePk)) {
    feedCache.set(
      game.gamePk,
      fetchJson(
        `https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`
      )
    );
  }
  return {
    gamePk: game.gamePk,
    feed: await feedCache.get(game.gamePk)
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  try {
    const date = String(
      req.query.date || new Date().toISOString().slice(0, 10)
    );
    const startsAfter = req.query.startsAfter
      ? String(req.query.startsAfter)
      : "";
    const startsBefore = req.query.startsBefore
      ? String(req.query.startsBefore)
      : "";

    const propParams = new URLSearchParams({
      books: "draftkings,fanduel,betmgm,caesars",
      limit: "100"
    });
    if (startsAfter) propParams.set("startsAfter", startsAfter);
    if (startsBefore) propParams.set("startsBefore", startsBefore);

    const [board, schedule] = await Promise.all([
      fetchJson(`${PROPS_URL}?${propParams.toString()}`),
      fetchJson(
        `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${encodeURIComponent(
          date
        )}&hydrate=probablePitcher,team`
      )
    ]);

    const scheduleGames = (schedule?.dates || []).flatMap(
      (d) => d.games || []
    );
    const feedCache = new Map();
    const results = [];

    for (const event of board.events || []) {
      const official = await gameFeedForEvent(
        event,
        scheduleGames,
        feedCache
      );
      if (!official?.feed) continue;
      const feed = official.feed;

      for (const prop of event.props || []) {
        const player = findOfficialPlayer(feed, prop.playerName);
        const lines = uniqueLines(prop);

        if (!player) {
          for (const line of lines) {
            for (const side of ["over", "under"]) {
              results.push({
                eventID: event.eventID,
                gamePk: official.gamePk,
                startsAt: event.startsAt,
                matchup: event.matchup,
                playerID: prop.playerID,
                playerName: prop.playerName,
                statID: prop.statID,
                market: prop.marketName,
                line,
                side,
                status: "PASS",
                reason: "player could not be matched to the official MLB game feed"
              });
            }
          }
          continue;
        }

        const side = playerSide(feed, player.id);
        if (!side) continue;

        const projection =
          prop.statID === "pitching_strikeouts"
            ? pitcherProjection(feed, player, side)
            : battingProjection(feed, player, side, prop.statID);

        for (const line of lines) {
          const exact = exactLineMarket(prop, line);
          const rawOverDist = projection.available
            ? prop.statID === "pitching_strikeouts"
              ? poissonSideProbability(projection.lambda, line, "over")
              : distributionSideProbability(projection.distribution, line, "over")
            : null;
          const rawUnderDist = projection.available
            ? prop.statID === "pitching_strikeouts"
              ? poissonSideProbability(projection.lambda, line, "under")
              : distributionSideProbability(projection.distribution, line, "under")
            : null;

          for (const marketSide of ["over", "under"]) {
            const rawDist =
              marketSide === "over" ? rawOverDist : rawUnderDist;
            const marketFair =
              marketSide === "over" ? exact.overFair : exact.underFair;
            const best =
              marketSide === "over" ? exact.overBest : exact.underBest;
            const dist = blendWithMarket(rawDist, marketFair, 0.65);
            const modelProb = dist?.win ?? null;
            const rawModelProb = rawDist?.win ?? null;
            const edge =
              modelProb === null || marketFair === null
                ? null
                : modelProb - marketFair;
            const ev =
              dist === null
                ? null
                : expectedValue(
                    dist.win,
                    dist.push,
                    best.bestOdds
                  );

            const grade = candidateStatus({
              projection,
              startsAt: event.startsAt,
              pairedBooks: exact.pairedBooks,
              sideBookCount: best.count,
              edge,
              ev
            });

            const modeledRow = {
              eventID: event.eventID,
              gamePk: official.gamePk,
              startsAt: event.startsAt,
              matchup: event.matchup,
              playerID: prop.playerID,
              mlbPlayerId: player.id,
              playerName: player.name,
              statID: prop.statID,
              market: prop.marketName,
              line,
              side: marketSide,
              label:
                `${player.name} ${marketSide.toUpperCase()} ${line} ` +
                (prop.statID === "pitching_strikeouts"
                  ? "Ks"
                  : prop.statID === "batting_hits"
                  ? "Hits"
                  : "Total Bases"),
              modelMean:
                projection.available
                  ? Number(projection.lambda.toFixed(3))
                  : null,
              modelProbability:
                modelProb === null
                  ? null
                  : Number(modelProb.toFixed(4)),
              rawIndependentProbability:
                rawModelProb === null
                  ? null
                  : Number(rawModelProb.toFixed(4)),
              pushProbability:
                dist === null
                  ? null
                  : Number(dist.push.toFixed(4)),
              marketFairProbability:
                marketFair === null
                  ? null
                  : Number(marketFair.toFixed(4)),
              edgePctPoints:
                edge === null
                  ? null
                  : Number((edge * 100).toFixed(2)),
              bestBook: best.bestBook,
              bestOdds: best.bestOdds,
              exactLineBookCount: best.count,
              pairedBooks: exact.pairedBooks,
              evPct:
                ev === null
                  ? null
                  : Number((ev * 100).toFixed(2)),
              dataQuality:
                projection.available
                  ? Number(projection.reliability.toFixed(3))
                  : 0,
              status: grade.status,
              reason: grade.reason,
              projection
            };
            modeledRow.tensorflowShadow =
              scorePlayerPropTensorflowShadow(modeledRow);
            results.push(modeledRow);
          }
        }
      }
    }

    const rank = { PLAY: 0, PENDING: 1, PASS: 2 };
    results.sort(
      (a, b) =>
        (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
        (b.evPct ?? -999) - (a.evPct ?? -999)
    );

    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      version: "MLB Player Props Model v1.2",
      date,
      finalWindowMinutes: FINAL_WINDOW_MINUTES,
      method: {
        pitcherStrikeouts:
          "Poisson count model from official starter season K/BF and BF/start, adjusted for confirmed opposing-lineup K rate and regressed toward league average.",
        batterHits:
          "Mixed-at-bat binomial distribution from confirmed batting-order opportunity and regressed season hit probability per AB, with a conservative opponent-starter H/9 adjustment.",
        batterTotalBases:
          "Mixed-at-bat compound distribution from regressed single/double/triple/home-run rates, with a conservative opponent-starter H/9 adjustment.",
        market:
          "Every sportsbook line is treated as a distinct wager. No-vig fair probability is calculated only from exact-line two-sided book pairs.",
        playRule:
          "PLAY requires sufficient official sample/role confirmation, >=1 exact-line two-sided book pair, >=2 books offering the selected side at that exact line, data quality >=0.75, model edge >=6 percentage points and modeled EV >=6% after shrinking independent probability 35% toward the exact-line no-vig market.",
        lifecycle:
          "Missing required information is PENDING only until 20 minutes before first pitch; then it becomes PASS.",
        tensorflowShadow:
          "A TensorFlow meta-model challenger scores every feature-complete prop prospectively in SHADOW mode. It has zero decision weight until chronological promotion gates pass."
      },
      summary: {
        rows: results.length,
        play: results.filter((x) => x.status === "PLAY").length,
        pending: results.filter((x) => x.status === "PENDING").length,
        pass: results.filter((x) => x.status === "PASS").length,
        tensorflowShadow: {
          ...tensorflowShadowMetadata(),
          scored: results.filter(
            (x) => x.tensorflowShadow?.available
          ).length,
          affectsDecision: false
        }
      },
      plays: results.filter((x) => x.status === "PLAY"),
      pending: results.filter((x) => x.status === "PENDING"),
      props: results
    });
  } catch (error) {
    return res.status(500).json({
      error: "Player props model failed",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}