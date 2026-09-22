const DECISION_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/decision";

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
              },
              weather: assessWeather(feed?.gameData || {}),
              bullpen: {
                away: awayBullpen,
                home: homeBullpen,
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

      const lineupNetAdjustment =
        candidateLineup.available && opponentLineup.available
          ? candidateLineup.probabilityAdjustment -
            opponentLineup.probabilityAdjustment
          : 0;
      const adjustedProbability = Math.max(
        0.02,
        Math.min(0.98, baseProb + lineupNetAdjustment)
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
      } else {
        if (
          adjustedEdge === null ||
          adjustedEv === null ||
          adjustedEdge < 0.025 ||
          adjustedEv < 0.03
        ) {
          blockers.push(
            "lineup-adjusted edge no longer meets the model PLAY threshold"
          );
        }
        if (lineupNetAdjustment <= -0.01) {
          warnings.push(
            "confirmed lineups reduce candidate win probability by at least 1 point"
          );
        } else if (lineupNetAdjustment >= 0.01) {
          warnings.push(
            "confirmed lineups improve candidate win probability by at least 1 point"
          );
        }
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
          netProbabilityAdjustment: Number(
            lineupNetAdjustment.toFixed(4)
          ),
          netProbabilityAdjustmentPctPoints: Number(
            (lineupNetAdjustment * 100).toFixed(2)
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
      version: "Final Verification v3",
      date,
      method: {
        officialSource:
          "MLB Stats live feed for game status, starters, batting orders, venue/weather, and prior-game box scores",
        bullpen:
          "relief-pitch workload heuristic over the two most recent final games",
        lineupStrength:
          "confirmed batting orders are scored by batting-order-weighted season OPS, regressed toward team season OPS for small samples; each team effect is capped at +/-1.25 win-probability points",
        finalRule:
          "A model PLAY can only reach READY_FOR_SHARP_CHECK when official status, starters, both confirmed lineups, lineup-adjusted edge, weather, and bullpen workload pass. Direct sharp-book confirmation is still required before a final PLAY.",
      },
      summary,
      candidates: results,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Final Verification v3 failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
