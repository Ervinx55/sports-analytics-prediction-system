const DECISION_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/decision";
const PITCHMIX_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/pitchmix";
const RUNENV_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/runenv";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, retries = 1) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
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
    } catch (err) {
      last = err;
      if (i < retries) await sleep(150);
    }
  }
  throw last;
}

function ymd(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function addDays(dateLike, days) {
  const d = new Date(dateLike);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function americanToDecimal(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return null;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}

function expectedValue(p, odds) {
  const d = americanToDecimal(odds);
  if (d === null || !Number.isFinite(p)) return null;
  return p * d - 1;
}

function parseWindMph(wind = "") {
  const m = String(wind).match(/(\d+(?:\.\d+)?)\s*mph/i);
  return m ? Number(m[1]) : null;
}

function assessWeather(gameData = {}) {
  const weather = gameData.weather || {};
  const venue = gameData.venue || {};
  const roofType = venue?.fieldInfo?.roofType || null;
  const condition = weather.condition || null;
  const tempF = weather.temp !== undefined ? Number(weather.temp) : null;
  const wind = weather.wind || null;
  const windMph = parseWindMph(wind);

  const controlledRoof = /dome|retractable/i.test(String(roofType || ""));
  const precipRisk = /rain|shower|thunder|storm|snow|sleet|drizzle/i.test(
    String(condition || "")
  );
  const extremeWind = windMph !== null && windMph >= 20;
  const notableWind = windMph !== null && windMph >= 15;
  const missing = !controlledRoof && (!condition || !wind);

  let level = "low";
  const warnings = [];
  if (controlledRoof) {
    warnings.push(`roof type: ${roofType}; weather can be mitigated by venue`);
  }
  if (precipRisk) {
    level = controlledRoof ? "medium" : "high";
    warnings.push(`precipitation condition: ${condition}`);
  }
  if (extremeWind) {
    level = "high";
    warnings.push(`extreme wind: ${wind}`);
  } else if (notableWind) {
    if (level === "low") level = "medium";
    warnings.push(`notable wind: ${wind}`);
  }
  if (missing) {
    if (level === "low") level = "unknown";
    warnings.push("official pregame weather is incomplete");
  }

  const passed =
    controlledRoof ||
    (!precipRisk && !extremeWind && !missing);

  return {
    passed,
    level,
    condition,
    tempF: Number.isFinite(tempF) ? tempF : null,
    wind,
    windMph,
    roofType,
    warnings,
  };
}

function lineupFromFeed(feed, side) {
  const teamBox = feed?.liveData?.boxscore?.teams?.[side] || {};
  const order = Array.isArray(teamBox.battingOrder)
    ? teamBox.battingOrder
    : [];
  const gamePlayers = feed?.gameData?.players || {};
  const boxPlayers = teamBox.players || {};
  const battingOrder = order.map((id, index) => {
    const box = boxPlayers[`ID${id}`] || {};
    const season = box?.seasonStats?.batting || {};
    return {
      spot: index + 1,
      id,
      name:
        gamePlayers[`ID${id}`]?.fullName ||
        box?.person?.fullName ||
        String(id),
      ops: season.ops ?? null,
      obp: season.obp ?? null,
      slg: season.slg ?? null,
      plateAppearances: season.plateAppearances ?? null,
      gamesPlayed: season.gamesPlayed ?? null,
    };
  });

  return {
    confirmed: order.length >= 9,
    count: order.length,
    battingOrder,
  };
}

function numberStat(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lineupStrength(lineup, teamBaseline) {
  if (!lineup?.confirmed || !teamBaseline) {
    return {
      available: false,
      reason: "confirmed nine-player lineup and team baseline required",
    };
  }

  const teamOps = numberStat(teamBaseline.ops);
  if (teamOps === null) {
    return { available: false, reason: "team OPS unavailable" };
  }

  // Approximate relative PA opportunity by lineup slot.
  const orderWeights = [1.12, 1.10, 1.08, 1.07, 1.04, 1.00, 0.96, 0.92, 0.88];
  let weighted = 0;
  let weightTotal = 0;
  const players = [];

  for (let i = 0; i < lineup.battingOrder.length; i++) {
    const p = lineup.battingOrder[i];
    const rawOps = numberStat(p.ops);
    const pa = numberStat(p.plateAppearances) || 0;
    const reliability = Math.max(0, Math.min(1, pa / 300));
    // Small-sample hitters are regressed heavily toward the team baseline.
    const regressedOps =
      rawOps === null
        ? teamOps
        : teamOps + reliability * (rawOps - teamOps);
    const w = orderWeights[i] || 0.85;
    weighted += regressedOps * w;
    weightTotal += w;
    players.push({
      ...p,
      rawOps,
      reliability: Number(reliability.toFixed(3)),
      regressedOps: Number(regressedOps.toFixed(3)),
      weight: w,
    });
  }

  const weightedOps = weightTotal ? weighted / weightTotal : teamOps;
  const deltaOps = weightedOps - teamOps;

  // Conservative conversion: a +.050 OPS lineup versus team baseline is worth
  // roughly +0.6 win-probability points. Per-team effect is capped at +/-1.25 pp.
  const probabilityAdjustment = Math.max(
    -0.0125,
    Math.min(0.0125, deltaOps * 0.12)
  );

  return {
    available: true,
    teamSeasonOps: Number(teamOps.toFixed(3)),
    weightedLineupOps: Number(weightedOps.toFixed(3)),
    deltaOps: Number(deltaOps.toFixed(3)),
    probabilityAdjustment: Number(probabilityAdjustment.toFixed(4)),
    probabilityAdjustmentPctPoints: Number(
      (probabilityAdjustment * 100).toFixed(2)
    ),
    players,
    methodology:
      "Confirmed batting order weighted by lineup slot; player season OPS is regressed toward team OPS based on plate appearances. Probability effect is conservative and capped at +/-1.25 points per team.",
  };
}


async function hitterPlatoonSplits(playerIds) {
  const ids = [...new Set((playerIds || []).filter(Boolean).map(Number))];
  if (!ids.length) return new Map();

  const hydrate =
    "stats(group=hitting,type=statSplits,sitCodes=[vr,vl],season=2026)";
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/people?personIds=${ids.join(",")}&hydrate=${encodeURIComponent(hydrate)}`
  );

  const map = new Map();
  for (const person of data?.people || []) {
    const splits = person?.stats?.[0]?.splits || [];
    const byCode = {};
    for (const split of splits) {
      const code = split?.split?.code;
      if (!code) continue;
      byCode[code] = {
        ops: split?.stat?.ops ?? null,
        obp: split?.stat?.obp ?? null,
        slg: split?.stat?.slg ?? null,
        plateAppearances: split?.stat?.plateAppearances ?? null,
        atBats: split?.stat?.atBats ?? null,
      };
    }
    map.set(Number(person.id), byCode);
  }
  return map;
}

function platoonLineupStrength(
  lineup,
  overallLineupStrength,
  splitMap,
  opposingStarterHand
) {
  if (!lineup?.confirmed || !overallLineupStrength?.available) {
    return {
      available: false,
      reason: "confirmed lineup and overall lineup strength required",
    };
  }

  const hand = String(opposingStarterHand || "").toUpperCase();
  const splitCode = hand === "L" ? "vl" : hand === "R" ? "vr" : null;
  if (!splitCode) {
    return {
      available: false,
      reason: "opposing starter handedness unavailable",
    };
  }

  const overallById = new Map(
    (overallLineupStrength.players || []).map((p) => [Number(p.id), p])
  );
  const orderWeights = [1.12, 1.10, 1.08, 1.07, 1.04, 1.00, 0.96, 0.92, 0.88];
  let weighted = 0;
  let weightTotal = 0;
  const players = [];

  for (let i = 0; i < lineup.battingOrder.length; i++) {
    const hitter = lineup.battingOrder[i];
    const overall = overallById.get(Number(hitter.id));
    const baselineOps =
      numberStat(overall?.regressedOps) ??
      numberStat(overallLineupStrength.weightedLineupOps);
    const split = splitMap.get(Number(hitter.id))?.[splitCode] || null;
    const rawSplitOps = numberStat(split?.ops);
    const splitPA = numberStat(split?.plateAppearances) || 0;

    // Full trust only after a substantial handedness sample.
    const reliability = Math.max(0, Math.min(1, splitPA / 150));
    const regressedSplitOps =
      baselineOps === null
        ? rawSplitOps
        : rawSplitOps === null
          ? baselineOps
          : baselineOps + reliability * (rawSplitOps - baselineOps);

    const w = orderWeights[i] || 0.85;
    if (regressedSplitOps !== null) {
      weighted += regressedSplitOps * w;
      weightTotal += w;
    }

    players.push({
      spot: hitter.spot,
      id: hitter.id,
      name: hitter.name,
      opposingStarterHand: hand,
      splitCode,
      rawSplitOps,
      splitPlateAppearances: splitPA,
      splitReliability: Number(reliability.toFixed(3)),
      overallRegressedOps: baselineOps,
      regressedSplitOps:
        regressedSplitOps === null
          ? null
          : Number(regressedSplitOps.toFixed(3)),
      weight: w,
    });
  }

  if (!weightTotal) {
    return { available: false, reason: "platoon split data unavailable" };
  }

  const weightedPlatoonOps = weighted / weightTotal;
  const weightedOverallOps = numberStat(
    overallLineupStrength.weightedLineupOps
  );
  if (weightedOverallOps === null) {
    return { available: false, reason: "overall weighted lineup OPS unavailable" };
  }

  const deltaOps = weightedPlatoonOps - weightedOverallOps;

  // Platoon is incremental to the overall lineup adjustment, so keep it smaller.
  // A +.050 matchup OPS delta is roughly +0.5 win-probability points.
  const probabilityAdjustment = Math.max(
    -0.01,
    Math.min(0.01, deltaOps * 0.10)
  );

  return {
    available: true,
    opposingStarterHand: hand,
    splitCode,
    weightedOverallOps: Number(weightedOverallOps.toFixed(3)),
    weightedPlatoonOps: Number(weightedPlatoonOps.toFixed(3)),
    deltaOps: Number(deltaOps.toFixed(3)),
    probabilityAdjustment: Number(probabilityAdjustment.toFixed(4)),
    probabilityAdjustmentPctPoints: Number(
      (probabilityAdjustment * 100).toFixed(2)
    ),
    players,
    methodology:
      "Hitter OPS vs the official opposing starter handedness is regressed toward each hitter's overall regressed OPS using split plate appearances, weighted by batting-order slot, and applied only as an incremental matchup adjustment capped at +/-1.0 win-probability point per team.",
  };
}

function sameStarter(expected, actual) {
  if (!expected?.id || !actual?.id) return false;
  return Number(expected.id) === Number(actual.id);
}

async function teamHittingBaseline(teamId) {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=hitting&season=2026`
  );
  const split = data?.stats?.[0]?.splits?.[0];
  const stat = split?.stat || {};
  return {
    teamId,
    ops: stat.ops ?? null,
    obp: stat.obp ?? null,
    slg: stat.slg ?? null,
    runs: stat.runs ?? null,
    plateAppearances: stat.plateAppearances ?? null,
  };
}

async function priorFinalGames(teamId, targetTime) {
  const target = new Date(targetTime);
  const start = ymd(addDays(target, -4));
  const end = ymd(addDays(target, -1));
  const schedule = await fetchJson(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${start}&endDate=${end}`
  );
  const games = (schedule?.dates || [])
    .flatMap((d) => d.games || [])
    .filter(
      (g) =>
        g?.status?.abstractGameState === "Final" &&
        Date.parse(g?.gameDate || "") < target.getTime()
    )
    .sort((a, b) => Date.parse(b.gameDate) - Date.parse(a.gameDate));
  return games.slice(0, 2);
}

function pitcherUsageFromBox(box, side) {
  const teamBox = box?.teams?.[side] || {};
  const pitchers = Array.isArray(teamBox.pitchers) ? teamBox.pitchers : [];
  const players = teamBox.players || {};
  const starter = pitchers[0] ?? null;
  const relievers = pitchers.slice(1);

  const usage = relievers.map((id) => {
    const p = players[`ID${id}`] || {};
    const pitches = Number(p?.stats?.pitching?.numberOfPitches || 0);
    return {
      id,
      name: p?.person?.fullName || String(id),
      pitches: Number.isFinite(pitches) ? pitches : 0,
    };
  });

  return {
    starter,
    relievers: usage,
    reliefPitches: usage.reduce((s, p) => s + p.pitches, 0),
  };
}

async function bullpenUsage(teamId, targetTime) {
  const prior = await priorFinalGames(teamId, targetTime);
  if (!prior.length) {
    return {
      level: "low",
      score: 0,
      recentGames: [],
      backToBackRelievers: [],
      relievers20PlusLastGame: [],
      note: "No prior final game found in the previous four days.",
    };
  }

  const boxes = await Promise.all(
    prior.map((g) =>
      fetchJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`)
    )
  );

  const details = [];
  for (let i = 0; i < prior.length; i++) {
    const g = prior[i];
    const homeId = Number(g?.teams?.home?.team?.id);
    const side = homeId === Number(teamId) ? "home" : "away";
    const usage = pitcherUsageFromBox(boxes[i], side);
    const hoursBeforeTarget =
      (Date.parse(targetTime) - Date.parse(g.gameDate)) / 3600000;
    details.push({
      gamePk: g.gamePk,
      gameDate: g.gameDate,
      hoursBeforeTarget: Number(hoursBeforeTarget.toFixed(1)),
      reliefPitches: usage.reliefPitches,
      relievers: usage.relievers,
    });
  }

  const first = details[0];
  const second = details[1] || null;

  const firstIds = new Set((first?.relievers || []).map((p) => p.id));
  const secondIds = new Set((second?.relievers || []).map((p) => p.id));
  const b2bIds = [...firstIds].filter((id) => secondIds.has(id));
  const nameById = new Map();
  for (const d of details) {
    for (const p of d.relievers) nameById.set(p.id, p.name);
  }
  const backToBackRelievers = b2bIds.map((id) => ({
    id,
    name: nameById.get(id) || String(id),
  }));

  const relievers20PlusLastGame = (first?.relievers || []).filter(
    (p) => p.pitches >= 20
  );

  let score = 0;
  const lastGameFresh = first && first.hoursBeforeTarget <= 36;
  const twoGameFresh =
    second && second.hoursBeforeTarget <= 60;

  if (lastGameFresh) {
    if (first.reliefPitches >= 75) score += 2;
    else if (first.reliefPitches >= 50) score += 1;

    if (relievers20PlusLastGame.length >= 2) score += 1;
  }

  if (twoGameFresh) {
    const twoTotal =
      (first?.reliefPitches || 0) + (second?.reliefPitches || 0);
    if (twoTotal >= 130) score += 2;
    else if (twoTotal >= 90) score += 1;

    if (backToBackRelievers.length >= 3) score += 2;
    else if (backToBackRelievers.length >= 1) score += 1;
  }

  const level = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return {
    level,
    score,
    recentGames: details,
    backToBackRelievers,
    relievers20PlusLastGame,
    note:
      "Bullpen stress is a heuristic from official MLB relief pitch counts over the two most recent final games.",
  };
}


function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function recentRelieverWorkload(recentUsage) {
  const latest = recentUsage?.recentGames?.[0] || null;
  const second = recentUsage?.recentGames?.[1] || null;
  const latestById = new Map(
    (latest?.relievers || []).map((p) => [Number(p.id), Number(p.pitches || 0)])
  );
  const secondById = new Map(
    (second?.relievers || []).map((p) => [Number(p.id), Number(p.pitches || 0)])
  );
  const b2b = new Set(
    (recentUsage?.backToBackRelievers || []).map((p) => Number(p.id))
  );

  return { latest, second, latestById, secondById, b2b };
}

function relieverAvailability(id, recentUsage) {
  const work = recentRelieverWorkload(recentUsage);
  const latestPitches = work.latestById.get(Number(id)) || 0;
  const secondPitches = work.secondById.get(Number(id)) || 0;
  const latestHours = Number(work.latest?.hoursBeforeTarget ?? 999);
  const secondHours = Number(work.second?.hoursBeforeTarget ?? 999);

  let weight = 1;

  if (latestHours <= 36) {
    if (latestPitches >= 30) weight *= 0.35;
    else if (latestPitches >= 20) weight *= 0.60;
    else if (latestPitches >= 10) weight *= 0.85;
  }

  if (secondHours <= 60 && secondPitches >= 20) {
    weight *= 0.85;
  }

  if (work.b2b.has(Number(id))) {
    weight *= 0.70;
  }

  return {
    weight: Number(clamp(weight, 0.2, 1).toFixed(3)),
    latestPitches,
    secondPitches,
    backToBack: work.b2b.has(Number(id)),
  };
}

function bullpenQualityProfile(feed, side, probableStarterId, recentUsage) {
  const teamBox = feed?.liveData?.boxscore?.teams?.[side] || {};
  const gamePlayers = feed?.gameData?.players || {};
  const relievers = [];

  for (const player of Object.values(teamBox.players || {})) {
    const id = Number(player?.person?.id);
    const pitching = player?.seasonStats?.pitching || {};
    const position = player?.position?.abbreviation;

    if (!id || position !== "P" || id === Number(probableStarterId)) continue;

    const gamesPitched = Number(pitching.gamesPitched || 0);
    const gamesStarted = Number(pitching.gamesStarted || 0);
    if (gamesPitched < 10) continue;

    // Keep true relievers and occasional openers/swingmen; exclude rotation starters.
    const relieverRole =
      gamesStarted <= 5 ||
      (gamesPitched > 0 && gamesStarted / gamesPitched <= 0.25);
    if (!relieverRole) continue;

    const era = numberStat(pitching.era);
    const whip = numberStat(pitching.whip);
    const k9 = numberStat(pitching.strikeoutsPer9Inn);
    const bb9 = numberStat(pitching.walksPer9Inn);
    if (era === null || whip === null) continue;

    const eraScore = clamp((4.20 - era) / 1.50, -1.5, 1.5);
    const whipScore = clamp((1.30 - whip) / 0.25, -1.5, 1.5);
    const kbb = k9 !== null && bb9 !== null ? k9 - bb9 : 4.0;
    const kbbScore = clamp((kbb - 4.0) / 3.0, -1.5, 1.5);
    const qualityIndex = clamp(
      0.45 * eraScore + 0.35 * whipScore + 0.20 * kbbScore,
      -1.5,
      1.5
    );

    const holds = Number(pitching.holds || 0);
    const saves = Number(pitching.saves || 0);
    const roleWeight =
      1 +
      Math.min(
        1.4,
        (Math.min(saves, 35) / 35) * 0.9 +
          (Math.min(holds, 30) / 30) * 0.6
      );

    const availability = relieverAvailability(id, recentUsage);
    const effectiveWeight = roleWeight * availability.weight;
    const hand = gamePlayers[`ID${id}`]?.pitchHand?.code || null;

    relievers.push({
      id,
      name: player?.person?.fullName || String(id),
      hand,
      era,
      whip,
      k9,
      bb9,
      holds,
      saves,
      qualityIndex: Number(qualityIndex.toFixed(3)),
      roleWeight: Number(roleWeight.toFixed(3)),
      availability,
      effectiveWeight: Number(effectiveWeight.toFixed(3)),
    });
  }

  const usable = relievers.filter((r) => r.effectiveWeight > 0);
  const weightTotal = usable.reduce((sum, r) => sum + r.effectiveWeight, 0);

  if (!weightTotal) {
    return {
      available: false,
      reason: "no usable relief-pitcher profile",
      relievers,
    };
  }

  const weightedQuality =
    usable.reduce(
      (sum, r) => sum + r.qualityIndex * r.effectiveWeight,
      0
    ) / weightTotal;

  const leftWeight = usable
    .filter((r) => r.hand === "L")
    .reduce((sum, r) => sum + r.effectiveWeight, 0);
  const rightWeight = usable
    .filter((r) => r.hand === "R")
    .reduce((sum, r) => sum + r.effectiveWeight, 0);
  const knownHandWeight = leftWeight + rightWeight;

  // Small team-level probability effect; final value is compared relatively.
  const qualityProbabilityAdjustment = clamp(weightedQuality * 0.004, -0.006, 0.006);

  return {
    available: true,
    weightedQualityIndex: Number(weightedQuality.toFixed(3)),
    qualityProbabilityAdjustment: Number(
      qualityProbabilityAdjustment.toFixed(4)
    ),
    qualityProbabilityAdjustmentPctPoints: Number(
      (qualityProbabilityAdjustment * 100).toFixed(2)
    ),
    handMix: {
      leftShare:
        knownHandWeight > 0
          ? Number((leftWeight / knownHandWeight).toFixed(3))
          : null,
      rightShare:
        knownHandWeight > 0
          ? Number((rightWeight / knownHandWeight).toFixed(3))
          : null,
    },
    relievers: usable.sort(
      (a, b) => b.effectiveWeight - a.effectiveWeight
    ),
    methodology:
      "Reliever quality blends ERA, WHIP and K-BB rate, weights high-leverage roles by saves/holds, and discounts recent workload/back-to-back usage. Rotation starters are excluded.",
  };
}

function lineupOpsVsHand(
  lineup,
  overallLineupStrength,
  splitMap,
  hand
) {
  if (!lineup?.confirmed || !overallLineupStrength?.available) return null;
  const splitCode = hand === "L" ? "vl" : hand === "R" ? "vr" : null;
  if (!splitCode) return null;

  const overallById = new Map(
    (overallLineupStrength.players || []).map((p) => [Number(p.id), p])
  );
  const orderWeights = [1.12, 1.10, 1.08, 1.07, 1.04, 1.00, 0.96, 0.92, 0.88];

  let weighted = 0;
  let weightTotal = 0;

  for (let i = 0; i < lineup.battingOrder.length; i++) {
    const hitter = lineup.battingOrder[i];
    const overall = overallById.get(Number(hitter.id));
    const baselineOps =
      numberStat(overall?.regressedOps) ??
      numberStat(overallLineupStrength.weightedLineupOps);
    const split = splitMap.get(Number(hitter.id))?.[splitCode] || null;
    const rawSplitOps = numberStat(split?.ops);
    const splitPA = numberStat(split?.plateAppearances) || 0;
    const reliability = clamp(splitPA / 150, 0, 1);
    const regressed =
      baselineOps === null
        ? rawSplitOps
        : rawSplitOps === null
          ? baselineOps
          : baselineOps + reliability * (rawSplitOps - baselineOps);

    if (regressed !== null) {
      const w = orderWeights[i] || 0.85;
      weighted += regressed * w;
      weightTotal += w;
    }
  }

  return weightTotal ? weighted / weightTotal : null;
}

function lineupVsBullpenHandMix(
  lineup,
  overallLineupStrength,
  splitMap,
  bullpenProfile
) {
  if (
    !lineup?.confirmed ||
    !overallLineupStrength?.available ||
    !bullpenProfile?.available
  ) {
    return {
      available: false,
      reason: "confirmed lineup, split data, and bullpen profile required",
    };
  }

  const leftShare = numberStat(bullpenProfile?.handMix?.leftShare);
  const rightShare = numberStat(bullpenProfile?.handMix?.rightShare);
  if (leftShare === null || rightShare === null) {
    return { available: false, reason: "bullpen handedness mix unavailable" };
  }

  const vsLeft = lineupOpsVsHand(
    lineup,
    overallLineupStrength,
    splitMap,
    "L"
  );
  const vsRight = lineupOpsVsHand(
    lineup,
    overallLineupStrength,
    splitMap,
    "R"
  );
  const overallOps = numberStat(overallLineupStrength.weightedLineupOps);

  if (vsLeft === null || vsRight === null || overallOps === null) {
    return { available: false, reason: "lineup platoon OPS unavailable" };
  }

  const expectedOps = leftShare * vsLeft + rightShare * vsRight;
  const deltaOps = expectedOps - overallOps;

  // Bullpen affects only part of the game, so cap this at +/-0.6 pp per offense.
  const probabilityAdjustment = clamp(deltaOps * 0.06, -0.006, 0.006);

  return {
    available: true,
    bullpenHandMix: { leftShare, rightShare },
    lineupOpsVsLeft: Number(vsLeft.toFixed(3)),
    lineupOpsVsRight: Number(vsRight.toFixed(3)),
    expectedOpsVsBullpenMix: Number(expectedOps.toFixed(3)),
    overallWeightedLineupOps: Number(overallOps.toFixed(3)),
    deltaOps: Number(deltaOps.toFixed(3)),
    probabilityAdjustment: Number(probabilityAdjustment.toFixed(4)),
    probabilityAdjustmentPctPoints: Number(
      (probabilityAdjustment * 100).toFixed(2)
    ),
    methodology:
      "Expected lineup OPS versus the available bullpen's left/right mix, with split samples regressed toward overall hitter strength; effect is capped because bullpen innings are only part of the game.",
  };
}

function candidateSideName(decision, side) {
  return side === "home"
    ? decision?.matchup?.home
    : decision?.matchup?.away;
}

function opponentSide(side) {
  return side === "home" ? "away" : "home";
}

function bullpenGate(candidateBullpen, opponentBullpen) {
  const warnings = [];
  let passed = true;

  if (candidateBullpen?.level === "high") {
    passed = false;
    warnings.push("candidate-side bullpen has high recent workload");
  } else if (candidateBullpen?.level === "medium") {
    warnings.push("candidate-side bullpen has medium recent workload");
  }

  if (
    candidateBullpen?.score - (opponentBullpen?.score || 0) >= 3
  ) {
    passed = false;
    warnings.push("candidate bullpen is materially more taxed than opponent bullpen");
  }

  return { passed, warnings };
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
    const includeWatch = String(req.query.includeWatch || "false") === "true";

    const decision = await fetchJson(
      `${DECISION_URL}?date=${encodeURIComponent(date)}`
    );

    const candidates = [];
    for (const d of decision?.decisions || []) {
      for (const side of ["away", "home"]) {
        const market = d?.moneyline?.[side];
        if (!market) continue;
        const wanted =
          market.modelDecision === "PLAY" ||
          (includeWatch && market.modelDecision === "WATCH");
        if (!wanted) continue;
        candidates.push({ decision: d, side, market });
      }
    }

    const gameCache = new Map();
    const bullpenCache = new Map();
    const teamStatsCache = new Map();

    async function gameVerification(d) {
      const key = String(d.mlbGamePk || d.eventID);
      if (!gameCache.has(key)) {
        gameCache.set(
          key,
          (async () => {
            const feed = await fetchJson(
              `https://statsapi.mlb.com/api/v1.1/game/${d.mlbGamePk}/feed/live`
            );

            let pitchMix;
            let runEnvironment;
            try {
              [pitchMix, runEnvironment] = await Promise.all([
                fetchJson(
                  `${PITCHMIX_URL}?gamePk=${d.mlbGamePk}`
                ),
                fetchJson(
                  `${RUNENV_URL}?gamePk=${d.mlbGamePk}`
                ),
              ]);
            } catch (err) {
              const message =
                err instanceof Error ? err.message : String(err);
              if (!pitchMix) {
                try {
                  pitchMix = await fetchJson(
                    `${PITCHMIX_URL}?gamePk=${d.mlbGamePk}`
                  );
                } catch {
                  pitchMix = { available: false, error: message };
                }
              }
              if (!runEnvironment) {
                try {
                  runEnvironment = await fetchJson(
                    `${RUNENV_URL}?gamePk=${d.mlbGamePk}`
                  );
                } catch {
                  runEnvironment = { available: false, error: message };
                }
              }
            }

            const awayTeamId = Number(feed?.gameData?.teams?.away?.id);
            const homeTeamId = Number(feed?.gameData?.teams?.home?.id);

            const bullpenKeyAway = `${awayTeamId}|${d.startsAt}`;
            const bullpenKeyHome = `${homeTeamId}|${d.startsAt}`;

            if (!bullpenCache.has(bullpenKeyAway)) {
              bullpenCache.set(
                bullpenKeyAway,
                bullpenUsage(awayTeamId, d.startsAt)
              );
            }
            if (!bullpenCache.has(bullpenKeyHome)) {
              bullpenCache.set(
                bullpenKeyHome,
                bullpenUsage(homeTeamId, d.startsAt)
              );
            }

            if (!teamStatsCache.has(awayTeamId)) {
              teamStatsCache.set(awayTeamId, teamHittingBaseline(awayTeamId));
            }
            if (!teamStatsCache.has(homeTeamId)) {
              teamStatsCache.set(homeTeamId, teamHittingBaseline(homeTeamId));
            }

            const [awayBullpen, homeBullpen, awayTeamHitting, homeTeamHitting] =
              await Promise.all([
                bullpenCache.get(bullpenKeyAway),
                bullpenCache.get(bullpenKeyHome),
                teamStatsCache.get(awayTeamId),
                teamStatsCache.get(homeTeamId),
              ]);

            const awayLineup = lineupFromFeed(feed, "away");
            const homeLineup = lineupFromFeed(feed, "home");
            const awayLineupStrength = lineupStrength(
              awayLineup,
              awayTeamHitting
            );
            const homeLineupStrength = lineupStrength(
              homeLineup,
              homeTeamHitting
            );
            const officialStarters = feed?.gameData?.probablePitchers || {};
            const expectedStarters = d?.probablePitchers || {};

            const gamePlayers = feed?.gameData?.players || {};
            const awayStarterHand =
              gamePlayers[`ID${officialStarters?.away?.id}`]?.pitchHand?.code ||
              null;
            const homeStarterHand =
              gamePlayers[`ID${officialStarters?.home?.id}`]?.pitchHand?.code ||
              null;

            const hitterIds = [
              ...awayLineup.battingOrder.map((p) => p.id),
              ...homeLineup.battingOrder.map((p) => p.id),
            ];
            const platoonSplits = await hitterPlatoonSplits(hitterIds);

            const awayPlatoonStrength = platoonLineupStrength(
              awayLineup,
              awayLineupStrength,
              platoonSplits,
              homeStarterHand
            );
            const homePlatoonStrength = platoonLineupStrength(
              homeLineup,
              homeLineupStrength,
              platoonSplits,
              awayStarterHand
            );

            const awayBullpenQuality = bullpenQualityProfile(
              feed,
              "away",
              officialStarters?.away?.id,
              awayBullpen
            );
            const homeBullpenQuality = bullpenQualityProfile(
              feed,
              "home",
              officialStarters?.home?.id,
              homeBullpen
            );

            const awayOffenseVsHomeBullpen = lineupVsBullpenHandMix(
              awayLineup,
              awayLineupStrength,
              platoonSplits,
              homeBullpenQuality
            );
            const homeOffenseVsAwayBullpen = lineupVsBullpenHandMix(
              homeLineup,
              homeLineupStrength,
              platoonSplits,
              awayBullpenQuality
            );

            const starterCheck = {
              away: {
                expected: expectedStarters.away || null,
                official: officialStarters.away || null,
                confirmed: sameStarter(
                  expectedStarters.away,
                  officialStarters.away
                ),
              },
              home: {
                expected: expectedStarters.home || null,
                official: officialStarters.home || null,
                confirmed: sameStarter(
                  expectedStarters.home,
                  officialStarters.home
                ),
              },
            };

            const status = feed?.gameData?.status || {};
            const statusPassed =
              status.abstractGameState === "Preview" &&
              !/postponed|cancelled|suspended/i.test(
                String(status.detailedState || "")
              );

            return {
              feedCheckedAt: new Date().toISOString(),
              status: {
                passed: statusPassed,
                abstractGameState: status.abstractGameState || null,
                detailedState: status.detailedState || null,
              },
              starters: {
                passed:
                  starterCheck.away.confirmed &&
                  starterCheck.home.confirmed,
                ...starterCheck,
              },
              lineups: {
                passed:
                  awayLineup.confirmed &&
                  homeLineup.confirmed,
                away: awayLineup,
                home: homeLineup,
                strength: {
                  away: awayLineupStrength,
                  home: homeLineupStrength,
                },
                platoon: {
                  away: awayPlatoonStrength,
                  home: homePlatoonStrength,
                },
              },
              pitchMix,
              runEnvironment,
              weather: assessWeather(feed?.gameData || {}),
              bullpen: {
                away: awayBullpen,
                home: homeBullpen,
                quality: {
                  away: awayBullpenQuality,
                  home: homeBullpenQuality,
                },
                matchup: {
                  awayOffenseVsHomeBullpen,
                  homeOffenseVsAwayBullpen,
                },
              },
            };
          })()
        );
      }
      return gameCache.get(key);
    }

    const results = [];
    for (const c of candidates) {
      const d = c.decision;
      if (!d?.mlbGamePk) {
        results.push({
          eventID: d?.eventID,
          matchup: d?.matchup,
          side: candidateSideName(d, c.side),
          modelDecision: c.market.modelDecision,
          verificationStatus: "WATCH",
          blockingReasons: ["missing official MLB game identifier"],
        });
        continue;
      }

      const v = await gameVerification(d);
      const candidateBullpen = v.bullpen[c.side];
      const oppBullpen = v.bullpen[opponentSide(c.side)];
      const bpGate = bullpenGate(candidateBullpen, oppBullpen);

      const candidateLineup =
        v.lineups?.strength?.[c.side] || { available: false };
      const opponentLineup =
        v.lineups?.strength?.[opponentSide(c.side)] || { available: false };
      const baseProb = Number(c.market.modelProbability);
      const marketFairProb =
        Number.isFinite(baseProb) && Number.isFinite(Number(c.market.edgePctPoints))
          ? baseProb - Number(c.market.edgePctPoints) / 100
          : null;

      const candidatePlatoon =
        v.lineups?.platoon?.[c.side] || { available: false };
      const opponentPlatoon =
        v.lineups?.platoon?.[opponentSide(c.side)] || { available: false };

      const lineupNetAdjustment =
        candidateLineup.available && opponentLineup.available
          ? candidateLineup.probabilityAdjustment -
            opponentLineup.probabilityAdjustment
          : 0;
      const platoonNetAdjustment =
        candidatePlatoon.available && opponentPlatoon.available
          ? candidatePlatoon.probabilityAdjustment -
            opponentPlatoon.probabilityAdjustment
          : 0;
      const totalLineupAdjustment =
        lineupNetAdjustment + platoonNetAdjustment;

      const candidateBullpenQuality =
        v.bullpen?.quality?.[c.side] || { available: false };
      const opponentBullpenQuality =
        v.bullpen?.quality?.[opponentSide(c.side)] || { available: false };

      const candidateOffenseBullpenMatchup =
        c.side === "away"
          ? v.bullpen?.matchup?.awayOffenseVsHomeBullpen
          : v.bullpen?.matchup?.homeOffenseVsAwayBullpen;
      const opponentOffenseBullpenMatchup =
        c.side === "away"
          ? v.bullpen?.matchup?.homeOffenseVsAwayBullpen
          : v.bullpen?.matchup?.awayOffenseVsHomeBullpen;

      const bullpenQualityNetAdjustment =
        candidateBullpenQuality.available &&
        opponentBullpenQuality.available
          ? candidateBullpenQuality.qualityProbabilityAdjustment -
            opponentBullpenQuality.qualityProbabilityAdjustment
          : 0;

      const bullpenHandednessNetAdjustment =
        candidateOffenseBullpenMatchup?.available &&
        opponentOffenseBullpenMatchup?.available
          ? candidateOffenseBullpenMatchup.probabilityAdjustment -
            opponentOffenseBullpenMatchup.probabilityAdjustment
          : 0;

      const totalBullpenAdjustment = clamp(
        bullpenQualityNetAdjustment + bullpenHandednessNetAdjustment,
        -0.012,
        0.012
      );

      const candidatePitchMix =
        c.side === "away"
          ? v.pitchMix?.awayOffenseVsHomeStarter
          : v.pitchMix?.homeOffenseVsAwayStarter;
      const opponentPitchMix =
        c.side === "away"
          ? v.pitchMix?.homeOffenseVsAwayStarter
          : v.pitchMix?.awayOffenseVsHomeStarter;

      const pitchMixNetAdjustment =
        candidatePitchMix?.available && opponentPitchMix?.available
          ? clamp(
              candidatePitchMix.probabilityAdjustment -
                opponentPitchMix.probabilityAdjustment,
              -0.012,
              0.012
            )
          : 0;

      const runEnvironmentAdjustmentPctPoints =
        c.side === "home"
          ? numberStat(
              v.runEnvironment?.moneylineEnvironment
                ?.homeProbabilityAdjustmentPctPoints
            )
          : numberStat(
              v.runEnvironment?.moneylineEnvironment
                ?.awayProbabilityAdjustmentPctPoints
            );
      const runEnvironmentAdjustment =
        runEnvironmentAdjustmentPctPoints === null
          ? 0
          : runEnvironmentAdjustmentPctPoints / 100;

      const totalContextAdjustment =
        totalLineupAdjustment +
        totalBullpenAdjustment +
        pitchMixNetAdjustment +
        runEnvironmentAdjustment;

      const adjustedProbability = Math.max(
        0.02,
        Math.min(0.98, baseProb + totalContextAdjustment)
      );
      const adjustedEdge =
        marketFairProb === null ? null : adjustedProbability - marketFairProb;
      const adjustedEv = expectedValue(
        adjustedProbability,
        c.market.bestOdds
      );

      const blockers = [];
      const warnings = [];
      if (!v.status.passed) blockers.push("official game status is not clear to play");
      if (!v.starters.passed) blockers.push("official probable starters do not both match");
      if (!v.lineups.passed) {
        blockers.push("both starting lineups are not yet confirmed");
      } else if (!candidateLineup.available || !opponentLineup.available) {
        blockers.push("lineup strength could not be scored");
      } else if (!candidatePlatoon.available || !opponentPlatoon.available) {
        blockers.push("platoon matchup strength could not be scored");
      } else {
        if (
          adjustedEdge === null ||
          adjustedEv === null ||
          adjustedEdge < 0.025 ||
          adjustedEv < 0.03
        ) {
          blockers.push(
            "final context-adjusted edge no longer meets the model PLAY threshold"
          );
        }
        if (totalLineupAdjustment <= -0.01) {
          warnings.push(
            "confirmed lineup plus platoon matchup reduces candidate win probability by at least 1 point"
          );
        } else if (totalLineupAdjustment >= 0.01) {
          warnings.push(
            "confirmed lineup plus platoon matchup improves candidate win probability by at least 1 point"
          );
        }
      }

      if (
        !candidatePitchMix?.available ||
        !opponentPitchMix?.available
      ) {
        blockers.push("starter pitch-mix matchup could not be fully scored");
      }

      if (
        !v.runEnvironment ||
        v.runEnvironment?.version !== "Run Environment v1"
      ) {
        blockers.push("park/weather run-environment model is unavailable");
      } else {
        if (v.runEnvironment?.totalProjection?.marketSplit) {
          warnings.push(
            "total market is split across books; exact total number must be verified"
          );
        }
        const totalDecision =
          v.runEnvironment?.totalProjection?.decision;
        if (
          totalDecision === "OVER_CANDIDATE" ||
          totalDecision === "UNDER_CANDIDATE"
        ) {
          warnings.push(
            `run-environment model has a ${totalDecision.toLowerCase()} at the current total`
          );
        }
      }

      if (runEnvironmentAdjustment <= -0.005) {
        warnings.push(
          "park/weather run environment reduces candidate moneyline probability by at least 0.5 points"
        );
      } else if (runEnvironmentAdjustment >= 0.005) {
        warnings.push(
          "park/weather run environment improves candidate moneyline probability by at least 0.5 points"
        );
      }

      if (pitchMixNetAdjustment <= -0.005) {
        warnings.push(
          "starter pitch-mix matchup reduces candidate win probability by at least 0.5 points"
        );
      } else if (pitchMixNetAdjustment >= 0.005) {
        warnings.push(
          "starter pitch-mix matchup improves candidate win probability by at least 0.5 points"
        );
      }

      if (
        !candidateBullpenQuality.available ||
        !opponentBullpenQuality.available
      ) {
        blockers.push("bullpen quality profile could not be scored");
      }
      if (
        !candidateOffenseBullpenMatchup?.available ||
        !opponentOffenseBullpenMatchup?.available
      ) {
        blockers.push("bullpen handedness matchup could not be scored");
      }

      if (totalBullpenAdjustment <= -0.0075) {
        warnings.push(
          "bullpen quality/handedness matchup reduces candidate win probability by at least 0.75 points"
        );
      } else if (totalBullpenAdjustment >= 0.0075) {
        warnings.push(
          "bullpen quality/handedness matchup improves candidate win probability by at least 0.75 points"
        );
      }

      if (!v.weather.passed) blockers.push("weather check is not clear");
      if (!bpGate.passed) blockers.push(...bpGate.warnings);
      else warnings.push(...bpGate.warnings);
      warnings.push(...(v.weather.warnings || []));

      const nonSharpPassed = blockers.length === 0;
      results.push({
        eventID: d.eventID,
        mlbGamePk: d.mlbGamePk,
        startsAt: d.startsAt,
        matchup: d.matchup,
        side: candidateSideName(d, c.side),
        sideKey: c.side,
        modelDecision: c.market.modelDecision,
        currentModelPrice: {
          bestBook: c.market.bestBook,
          bestOdds: c.market.bestOdds,
          modelProbability: c.market.modelProbability,
          edgePctPoints: c.market.edgePctPoints,
          evPct: c.market.evPct,
          minAcceptableOddsFor2PctEV:
            c.market.minAcceptableOddsFor2PctEV,
        },
        lineupAdjustment: {
          candidate: candidateLineup,
          opponent: opponentLineup,
          candidatePlatoon,
          opponentPlatoon,
          overallNetProbabilityAdjustment: Number(
            lineupNetAdjustment.toFixed(4)
          ),
          overallNetProbabilityAdjustmentPctPoints: Number(
            (lineupNetAdjustment * 100).toFixed(2)
          ),
          platoonNetProbabilityAdjustment: Number(
            platoonNetAdjustment.toFixed(4)
          ),
          platoonNetProbabilityAdjustmentPctPoints: Number(
            (platoonNetAdjustment * 100).toFixed(2)
          ),
          totalNetProbabilityAdjustment: Number(
            totalLineupAdjustment.toFixed(4)
          ),
          totalNetProbabilityAdjustmentPctPoints: Number(
            (totalLineupAdjustment * 100).toFixed(2)
          ),
          adjustedModelProbability: Number(
            adjustedProbability.toFixed(4)
          ),
          adjustedEdgePctPoints:
            adjustedEdge === null
              ? null
              : Number((adjustedEdge * 100).toFixed(2)),
          adjustedEvPct:
            adjustedEv === null
              ? null
              : Number((adjustedEv * 100).toFixed(2)),
        },
        runEnvironmentAdjustment: {
          environment: v.runEnvironment?.environment || null,
          totalProjection:
            v.runEnvironment?.totalProjection || null,
          moneylineEnvironment:
            v.runEnvironment?.moneylineEnvironment || null,
          probabilityAdjustment:
            Number(runEnvironmentAdjustment.toFixed(4)),
          probabilityAdjustmentPctPoints:
            Number((runEnvironmentAdjustment * 100).toFixed(2)),
          finalContextProbability:
            Number(adjustedProbability.toFixed(4)),
          finalContextEdgePctPoints:
            adjustedEdge === null
              ? null
              : Number((adjustedEdge * 100).toFixed(2)),
          finalContextEvPct:
            adjustedEv === null
              ? null
              : Number((adjustedEv * 100).toFixed(2)),
        },
        pitchMixAdjustment: {
          candidateOffenseVsOpponentStarter: candidatePitchMix || null,
          opponentOffenseVsCandidateStarter: opponentPitchMix || null,
          netProbabilityAdjustment: Number(
            pitchMixNetAdjustment.toFixed(4)
          ),
          netProbabilityAdjustmentPctPoints: Number(
            (pitchMixNetAdjustment * 100).toFixed(2)
          ),
          finalContextProbability: Number(
            adjustedProbability.toFixed(4)
          ),
          finalContextEdgePctPoints:
            adjustedEdge === null
              ? null
              : Number((adjustedEdge * 100).toFixed(2)),
          finalContextEvPct:
            adjustedEv === null
              ? null
              : Number((adjustedEv * 100).toFixed(2)),
        },
        bullpenAdjustment: {
          candidateBullpenQuality,
          opponentBullpenQuality,
          candidateOffenseVsOpponentBullpen:
            candidateOffenseBullpenMatchup || null,
          opponentOffenseVsCandidateBullpen:
            opponentOffenseBullpenMatchup || null,
          qualityNetProbabilityAdjustment: Number(
            bullpenQualityNetAdjustment.toFixed(4)
          ),
          qualityNetProbabilityAdjustmentPctPoints: Number(
            (bullpenQualityNetAdjustment * 100).toFixed(2)
          ),
          handednessNetProbabilityAdjustment: Number(
            bullpenHandednessNetAdjustment.toFixed(4)
          ),
          handednessNetProbabilityAdjustmentPctPoints: Number(
            (bullpenHandednessNetAdjustment * 100).toFixed(2)
          ),
          totalBullpenProbabilityAdjustment: Number(
            totalBullpenAdjustment.toFixed(4)
          ),
          totalBullpenProbabilityAdjustmentPctPoints: Number(
            (totalBullpenAdjustment * 100).toFixed(2)
          ),
          finalAdjustedModelProbability: Number(
            adjustedProbability.toFixed(4)
          ),
          finalAdjustedEdgePctPoints:
            adjustedEdge === null
              ? null
              : Number((adjustedEdge * 100).toFixed(2)),
          finalAdjustedEvPct:
            adjustedEv === null
              ? null
              : Number((adjustedEv * 100).toFixed(2)),
        },
        verificationStatus: nonSharpPassed
          ? "READY_FOR_SHARP_CHECK"
          : "WATCH",
        sharpConfirmationRequired: true,
        nonSharpPassed,
        blockingReasons: blockers,
        warnings,
        checks: v,
      });
    }

    const summary = {
      totalCandidates: results.length,
      readyForSharpCheck: results.filter(
        (x) => x.verificationStatus === "READY_FOR_SHARP_CHECK"
      ).length,
      watch: results.filter((x) => x.verificationStatus === "WATCH").length,
    };

    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      version: "Final Verification v7",
      date,
      method: {
        officialSource:
          "MLB Stats live feed for game status, starters, batting orders, venue/weather, and prior-game box scores",
        bullpen:
          "relief-pitch workload heuristic over the two most recent final games",
        lineupStrength:
          "confirmed batting orders are scored by batting-order-weighted season OPS, regressed toward team season OPS for small samples; each team effect is capped at +/-1.25 win-probability points",
        platoonMatchup:
          "each confirmed hitter is re-scored versus the official opposing starter's handedness using MLB vr/vl splits, regressed toward overall hitter strength by split plate appearances; the incremental platoon effect is capped at +/-1.0 win-probability point per team",
        bullpenQuality:
          "available relievers are graded with ERA, WHIP and K-BB, weighted by saves/holds role and discounted for recent pitch workload/back-to-back use",
        bullpenHandedness:
          "the confirmed lineup is matched against the available bullpen's left/right composition using regressed vr/vl hitter splits; bullpen context is capped at +/-1.2 win-probability points in total",
        pitchMix:
          "Baseball Savant starter pitch usage is matched to confirmed hitters' Statcast xwOBA by pitch type, regressed toward pitch-type league baselines by pitches seen; the net pitch-mix effect is capped at +/-1.2 win-probability points",
        runEnvironment:
          "Baseball Savant three-year Park Factor plus official MLB temperature, wind, roof type, and venue elevation produce a conservative run-environment multiplier. Elevation changes same-day weather sensitivity rather than being double-counted on top of Park Factor.",
        totals:
          "an independent team/starter scoring baseline is park/weather adjusted and then shrunk toward the live total market; split book totals are WATCH-only",
        finalRule:
          "A model PLAY can only reach READY_FOR_SHARP_CHECK when official status, starters, both confirmed lineups, lineup/platoon, starter pitch-mix, park/weather run environment, bullpen quality/handedness, weather, and bullpen workload checks pass. Direct sharp-book confirmation is still required before a final PLAY.",
      },
      summary,
      candidates: results,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Final Verification v7 failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
