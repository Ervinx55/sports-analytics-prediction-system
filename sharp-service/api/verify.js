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
  const players = feed?.gameData?.players || {};
  const names = order.map((id) => players[`ID${id}`]?.fullName || String(id));
  return {
    confirmed: order.length >= 9,
    count: order.length,
    battingOrder: names,
  };
}

function sameStarter(expected, actual) {
  if (!expected?.id || !actual?.id) return false;
  return Number(expected.id) === Number(actual.id);
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

            const [awayBullpen, homeBullpen] = await Promise.all([
              bullpenCache.get(bullpenKeyAway),
              bullpenCache.get(bullpenKeyHome),
            ]);

            const awayLineup = lineupFromFeed(feed, "away");
            const homeLineup = lineupFromFeed(feed, "home");
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

      const blockers = [];
      const warnings = [];
      if (!v.status.passed) blockers.push("official game status is not clear to play");
      if (!v.starters.passed) blockers.push("official probable starters do not both match");
      if (!v.lineups.passed) blockers.push("both starting lineups are not yet confirmed");
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
      version: "Final Verification v2",
      date,
      method: {
        officialSource:
          "MLB Stats live feed for game status, starters, batting orders, venue/weather, and prior-game box scores",
        bullpen:
          "relief-pitch workload heuristic over the two most recent final games",
        finalRule:
          "A model PLAY can only reach READY_FOR_SHARP_CHECK when official status, starters, both lineups, weather, and bullpen workload pass. Direct sharp-book confirmation is still required before a final PLAY.",
      },
      summary,
      candidates: results,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Final Verification v2 failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
