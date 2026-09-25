const BOARD_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/board";
const ALERT_URL =
  "https://yeoxroijaptomomshdii.supabase.co/functions/v1/market-alerts";

const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

function americanToProb(odds) {
  const o = num(odds);
  if (!o || o === 0) return null;
  return o > 0 ? 100 / (o + 100) : (-o) / ((-o) + 100);
}

function americanToDecimal(odds) {
  const o = num(odds);
  if (!o || o === 0) return null;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}

function probToAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  if (p >= 0.5) return Math.round(-100 * p / (1 - p));
  return Math.round(100 * (1 - p) / p);
}

function logit(p) {
  return Math.log(p / (1 - p));
}

function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

function noVig(side, opp) {
  const a = americanToProb(side);
  const b = americanToProb(opp);
  if (a === null || b === null || a + b <= 0) return null;
  return a / (a + b);
}

function expectedValue(p, odds) {
  const d = americanToDecimal(odds);
  if (d === null || p === null) return null;
  return p * d - 1;
}

function minAcceptableOdds(p, targetEv = 0.02) {
  if (!(p > 0 && p < 1)) return null;
  const d = (1 + targetEv) / p;
  if (d <= 1) return null;
  if (d >= 2) return Math.round((d - 1) * 100);
  return Math.round(-100 / (d - 1));
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

function teamKey(name = "") {
  const s = name.toLowerCase();
  const aliases = [
    ["diamondbacks", "diamondbacks"], ["d-backs", "diamondbacks"],
    ["athletics", "athletics"], ["braves", "braves"], ["orioles", "orioles"],
    ["red sox", "red sox"], ["cubs", "cubs"], ["white sox", "white sox"],
    ["reds", "reds"], ["guardians", "guardians"], ["rockies", "rockies"],
    ["tigers", "tigers"], ["astros", "astros"], ["royals", "royals"],
    ["angels", "angels"], ["dodgers", "dodgers"], ["marlins", "marlins"],
    ["brewers", "brewers"], ["twins", "twins"], ["mets", "mets"],
    ["yankees", "yankees"], ["phillies", "phillies"], ["pirates", "pirates"],
    ["padres", "padres"], ["giants", "giants"], ["mariners", "mariners"],
    ["cardinals", "cardinals"], ["rays", "rays"], ["rangers", "rangers"],
    ["blue jays", "blue jays"], ["nationals", "nationals"],
  ];
  for (const [needle, key] of aliases) if (s.includes(needle)) return key;
  return s.replace(/[^a-z]/g, "");
}

function standingsRows(payload) {
  const map = new Map();
  for (const rec of payload?.records || []) {
    for (const tr of rec?.teamRecords || []) {
      const key = teamKey(tr?.team?.name || "");
      if (key) map.set(key, tr);
    }
  }
  return map;
}

function pythagorean(rs, ra) {
  const a = Number(rs);
  const b = Number(ra);
  if (!(a > 0) || !(b > 0)) return null;
  const x = Math.pow(a, 1.83);
  const y = Math.pow(b, 1.83);
  return x / (x + y);
}

function expectedPct(team) {
  const x = team?.records?.expectedRecords?.find(
    (r) => r.type === "xWinLossSeason" || r.type === "xWinLoss"
  );
  const p = Number(x?.pct);
  if (Number.isFinite(p) && p > 0 && p < 1) return p;
  const py = pythagorean(team?.runsScored, team?.runsAllowed);
  if (py !== null) return py;
  const wp = Number(team?.winningPercentage);
  return Number.isFinite(wp) ? wp : null;
}

function log5(homeP, awayP) {
  if (!(homeP > 0 && homeP < 1 && awayP > 0 && awayP < 1)) return null;
  const n = homeP - homeP * awayP;
  const d = homeP + awayP - 2 * homeP * awayP;
  return d ? n / d : null;
}

function playoffLeverage(team) {
  if (!team) return { level: "unknown", score: 0, reasons: [] };
  const reasons = [];
  const gamesLeft = Math.max(0, 162 - Number(team.gamesPlayed || 0));
  const wcgbRaw = String(team.wildCardGamesBack ?? "");
  const wcgb = wcgbRaw.startsWith("+")
    ? -Number(wcgbRaw.slice(1))
    : Number(wcgbRaw.replace("-", "0"));
  const divGB = Number(String(team.divisionGamesBack ?? "0").replace("-", "0"));
  const wcElim = String(team.wildCardEliminationNumber ?? "");
  const clinched = Boolean(team.clinched);

  let score = 0;
  if (clinched) {
    score += 0.5;
    reasons.push("postseason spot clinched");
  }
  if (!clinched && gamesLeft <= 10) {
    if (Number.isFinite(wcgb) && Math.abs(wcgb) <= 4.5) {
      score += 2.5;
      reasons.push("within 4.5 games of a Wild Card spot");
    }
    if (Number.isFinite(divGB) && Math.abs(divGB) <= 2) {
      score += 2.5;
      reasons.push("division race within 2 games");
    }
    if (/^[1-6]$/.test(wcElim)) {
      score += 1.5;
      reasons.push("small Wild Card elimination number");
    }
  }
  if (team.divisionLeader && gamesLeft <= 10 && !clinched) {
    score += 2;
    reasons.push("late-season division leader");
  }
  const level = score >= 3 ? "high" : score >= 1.5 ? "medium" : "low";
  return { level, score, reasons, gamesLeft };
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 400) }; }
  if (!r.ok) throw new Error(`${r.status} ${url}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

function selectPitcherSplit(payload) {
  const splits = payload?.stats?.[0]?.splits || [];
  if (!splits.length) return null;
  return (
    splits.find((x) => x?.numTeams && !x?.team) ||
    splits.find((x) => !x?.team) ||
    splits[0]
  );
}

function starterAdjustment(homePitcher, awayPitcher) {
  if (!homePitcher?.stat || !awayPitcher?.stat) return 0;
  const hEra = Number(homePitcher.stat.era);
  const aEra = Number(awayPitcher.stat.era);
  const hWhip = Number(homePitcher.stat.whip);
  const aWhip = Number(awayPitcher.stat.whip);
  if (![hEra, aEra, hWhip, aWhip].every(Number.isFinite)) return 0;

  // Positive means an advantage for the home team.
  const raw = (aEra - hEra) * 0.012 + (aWhip - hWhip) * 0.05;
  return clamp(raw, -0.07, 0.07);
}

function dataQuality({ homeSt, awaySt, homePitcher, awayPitcher, bookCount, statusOk }) {
  let q = 0;
  if (homeSt && awaySt) q += 0.25;
  if (homePitcher?.stat && awayPitcher?.stat) q += 0.25;
  if (bookCount >= 4) q += 0.2;
  else if (bookCount >= 3) q += 0.15;
  if (statusOk) q += 0.1;
  // Weather and confirmed lineups are not automated yet, so cap below 1.0.
  q += 0.1; // movement/market data
  return Math.min(0.9, Number(q.toFixed(2)));
}

function classify(edge, ev, q, warnings) {
  if (warnings.some((w) => w.type === "status")) return "PASS";
  if (q >= 0.7 && edge >= 0.025 && ev >= 0.03) return "PLAY";
  if ((edge >= 0.012 && ev >= 0.01) || warnings.length) return "WATCH";
  return "PASS";
}

function finalDecision(modelDecision, context = {}) {
  if (modelDecision !== "PLAY") return modelDecision;
  // The endpoint itself cannot yet confirm direct sharp-book pricing,
  // weather, or the final posted lineup. A raw model PLAY is therefore
  // a candidate that must pass those external checks before promotion.
  if (
    !context.pitchersConfirmed ||
    !context.sharpConfirmed ||
    !context.weatherChecked ||
    !context.lineupChecked ||
    context.hasSevereMarketFlag
  ) {
    return "WATCH";
  }
  return "PLAY";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  try {
    const now = new Date();
    const date = String(req.query.date || now.toISOString().slice(0, 10));
    const startsAfter = req.query.startsAfter ? String(req.query.startsAfter) : "";
    const startsBefore = req.query.startsBefore ? String(req.query.startsBefore) : "";
    const boardParams = new URLSearchParams({
      leagues: "MLB",
      books: BOOKS.join(","),
    });
    if (startsAfter) boardParams.set("startsAfter", startsAfter);
    if (startsBefore) boardParams.set("startsBefore", startsBefore);

    const [board, alerts, standings, schedule] = await Promise.all([
      fetchJson(`${BOARD_URL}?${boardParams.toString()}`),
      fetchJson(`${ALERT_URL}?league=MLB&hours=36&minBooks=3`),
      fetchJson(
        "https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026&standingsTypes=regularSeason"
      ),
      fetchJson(
        `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${encodeURIComponent(date)}&hydrate=probablePitcher`
      ),
    ]);

    const stMap = standingsRows(standings);
    const games = schedule?.dates?.flatMap((d) => d.games || []) || [];
    const gameByPair = new Map();
    for (const g of games) {
      const a = teamKey(g?.teams?.away?.team?.name);
      const h = teamKey(g?.teams?.home?.team?.name);
      gameByPair.set(`${a}|${h}`, g);
    }

    const pitcherIds = new Set();
    for (const g of games) {
      if (g?.status?.abstractGameState !== "Preview") continue;
      const a = g?.teams?.away?.probablePitcher?.id;
      const h = g?.teams?.home?.probablePitcher?.id;
      if (a) pitcherIds.add(a);
      if (h) pitcherIds.add(h);
    }

    const pitcherMap = new Map();
    await Promise.all(
      [...pitcherIds].map(async (id) => {
        try {
          const p = await fetchJson(
            `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=pitching&season=2026`
          );
          pitcherMap.set(id, selectPitcherSplit(p));
        } catch {
          pitcherMap.set(id, null);
        }
      })
    );

    const alertByEvent = new Map();
    for (const a of alerts?.alerts || []) {
      if (!alertByEvent.has(a.eventID)) alertByEvent.set(a.eventID, []);
      alertByEvent.get(a.eventID).push(a);
    }

    const decisions = [];
    for (const e of board?.events || []) {
      const awayKey = teamKey(e?.matchup?.away?.name);
      const homeKey = teamKey(e?.matchup?.home?.name);
      const g = gameByPair.get(`${awayKey}|${homeKey}`);
      if (!g) continue;

      const eventMs = Date.parse(e?.startsAt || "");
      const gameMs = Date.parse(g?.gameDate || "");
      const exactOccurrence =
        Number.isFinite(eventMs) &&
        Number.isFinite(gameMs) &&
        Math.abs(eventMs - gameMs) <= 3 * 60 * 60 * 1000;
      if (!exactOccurrence) continue;

      const statusOk =
        g?.status?.abstractGameState === "Preview" &&
        e?.status?.display !== "PP";
      if (!statusOk) continue;

      const homeSt = stMap.get(homeKey);
      const awaySt = stMap.get(awayKey);
      const homeStrength = expectedPct(homeSt);
      const awayStrength = expectedPct(awaySt);

      let independentHome = log5(homeStrength, awayStrength);
      if (independentHome === null) independentHome = 0.5;
      independentHome = logistic(logit(clamp(independentHome, 0.05, 0.95)) + 0.12);

      const homePitcherId = g?.teams?.home?.probablePitcher?.id;
      const awayPitcherId = g?.teams?.away?.probablePitcher?.id;
      const homePitcher = homePitcherId ? pitcherMap.get(homePitcherId) : null;
      const awayPitcher = awayPitcherId ? pitcherMap.get(awayPitcherId) : null;
      independentHome = clamp(
        independentHome + starterAdjustment(homePitcher, awayPitcher),
        0.08,
        0.92
      );

      const homeML = e?.markets?.moneyline?.home;
      const awayML = e?.markets?.moneyline?.away;
      if (!homeML || !awayML) continue;

      const marketHome = noVig(homeML?.consensus?.odds, awayML?.consensus?.odds);
      const marketAway = marketHome === null ? null : 1 - marketHome;

      const homeLev = playoffLeverage(homeSt);
      const awayLev = playoffLeverage(awaySt);

      // Playoff leverage is intentionally modest: max +/- 0.75 percentage points.
      const levAdjHome = clamp((homeLev.score - awayLev.score) * 0.0025, -0.0075, 0.0075);
      independentHome = clamp(independentHome + levAdjHome, 0.08, 0.92);

      // Hybrid projection: preserve an independent baseball view but shrink toward market.
      const modelHome =
        marketHome === null
          ? independentHome
          : 0.7 * independentHome + 0.3 * marketHome;
      const modelAway = 1 - modelHome;

      const homeBest = bestOdds(homeML.books);
      const awayBest = bestOdds(awayML.books);
      const bookCountHome = Object.values(homeML.books || {}).filter(
        (x) => x && x.available !== false && num(x.odds) !== null
      ).length;
      const bookCountAway = Object.values(awayML.books || {}).filter(
        (x) => x && x.available !== false && num(x.odds) !== null
      ).length;

      const eventAlerts = alertByEvent.get(e.eventID) || [];
      const warnings = [];
      if (e?.status?.display === "PP" || g?.status?.detailedState === "Postponed") {
        warnings.push({ type: "status", message: "postponed or stale market" });
      }
      for (const a of eventAlerts) {
        if (["line_outlier", "price_outlier", "split_market", "steam", "reversal"].includes(a.type)) {
          warnings.push({ type: a.type, message: a.summary });
        }
      }
      warnings.push({
        type: "data",
        message: "weather and confirmed starting lineups are not yet automated in v1",
      });

      const homeQ = dataQuality({
        homeSt, awaySt, homePitcher, awayPitcher,
        bookCount: bookCountHome, statusOk
      });
      const awayQ = dataQuality({
        homeSt, awaySt, homePitcher, awayPitcher,
        bookCount: bookCountAway, statusOk
      });

      const homeEdge = marketHome === null ? 0 : modelHome - marketHome;
      const awayEdge = marketAway === null ? 0 : modelAway - marketAway;
      const homeEv = homeBest.odds === null ? null : expectedValue(modelHome, homeBest.odds);
      const awayEv = awayBest.odds === null ? null : expectedValue(modelAway, awayBest.odds);

      decisions.push({
        eventID: e.eventID,
        mlbGamePk: g?.gamePk ?? null,
        startsAt: e.startsAt,
        matchup: {
          away: e.matchup?.away?.name,
          home: e.matchup?.home?.name,
        },
        marketSource: {
          provider:
            e.provider ??
            board.source ??
            null,
          providerEventID:
            e.providerEventID ?? null,
          providersUsed:
            board.providersUsed ?? [],
          providerChain:
            board.providerChain ?? [],
        },
        probablePitchers: {
          away: {
            id: g?.teams?.away?.probablePitcher?.id ?? null,
            name: g?.teams?.away?.probablePitcher?.fullName || null,
            era: awayPitcher?.stat?.era ?? null,
            whip: awayPitcher?.stat?.whip ?? null,
          },
          home: {
            id: g?.teams?.home?.probablePitcher?.id ?? null,
            name: g?.teams?.home?.probablePitcher?.fullName || null,
            era: homePitcher?.stat?.era ?? null,
            whip: homePitcher?.stat?.whip ?? null,
          },
        },
        playoffLeverage: { away: awayLev, home: homeLev },
        projection: {
          independentHomeWinProb: Number(independentHome.toFixed(4)),
          modelHomeWinProb: Number(modelHome.toFixed(4)),
          modelAwayWinProb: Number(modelAway.toFixed(4)),
          marketHomeFairProb: marketHome === null ? null : Number(marketHome.toFixed(4)),
          marketAwayFairProb: marketAway === null ? null : Number(marketAway.toFixed(4)),
          starterAdjustmentHomeProbPoints: Number(
            (starterAdjustment(homePitcher, awayPitcher) * 100).toFixed(2)
          ),
          playoffLeverageAdjustmentHomeProbPoints: Number((levAdjHome * 100).toFixed(2)),
          modelType: "hybrid-v1",
        },
        moneyline: {
          away: {
            modelDecision: classify(
              awayEdge,
              awayEv ?? -1,
              awayQ,
              warnings.filter((w) => w.type !== "data")
            ),
            decision: finalDecision(
              classify(
                awayEdge,
                awayEv ?? -1,
                awayQ,
                warnings.filter((w) => w.type !== "data")
              ),
              {
                pitchersConfirmed: Boolean(
                  g?.teams?.away?.probablePitcher?.id &&
                  g?.teams?.home?.probablePitcher?.id
                ),
                sharpConfirmed: false,
                weatherChecked: false,
                lineupChecked: false,
                hasSevereMarketFlag: eventAlerts.some(
                  (a) => a.severity === "high"
                ),
              }
            ),
            bestBook: awayBest.book,
            bestOdds: awayBest.odds,
            provider:
              e.provider ??
              board.source ??
              null,
            modelProbability: Number(modelAway.toFixed(4)),
            edgePctPoints: Number((awayEdge * 100).toFixed(2)),
            evPct: awayEv === null ? null : Number((awayEv * 100).toFixed(2)),
            minAcceptableOddsFor2PctEV: minAcceptableOdds(modelAway, 0.02),
            dataQuality: awayQ,
          },
          home: {
            modelDecision: classify(
              homeEdge,
              homeEv ?? -1,
              homeQ,
              warnings.filter((w) => w.type !== "data")
            ),
            decision: finalDecision(
              classify(
                homeEdge,
                homeEv ?? -1,
                homeQ,
                warnings.filter((w) => w.type !== "data")
              ),
              {
                pitchersConfirmed: Boolean(
                  g?.teams?.away?.probablePitcher?.id &&
                  g?.teams?.home?.probablePitcher?.id
                ),
                sharpConfirmed: false,
                weatherChecked: false,
                lineupChecked: false,
                hasSevereMarketFlag: eventAlerts.some(
                  (a) => a.severity === "high"
                ),
              }
            ),
            bestBook: homeBest.book,
            bestOdds: homeBest.odds,
            provider:
              e.provider ??
              board.source ??
              null,
            modelProbability: Number(modelHome.toFixed(4)),
            edgePctPoints: Number((homeEdge * 100).toFixed(2)),
            evPct: homeEv === null ? null : Number((homeEv * 100).toFixed(2)),
            minAcceptableOddsFor2PctEV: minAcceptableOdds(modelHome, 0.02),
            dataQuality: homeQ,
          },
        },
        marketFlags: eventAlerts,
        warnings,
      });
    }

    const rankScore = (x) => {
      const sides = [x.moneyline.away, x.moneyline.home];
      return Math.max(
        ...sides.map((s) =>
          (s.modelDecision === "PLAY" ? 100 : s.modelDecision === "WATCH" ? 50 : 0) +
          Math.max(0, s.evPct || 0) +
          Math.max(0, s.edgePctPoints || 0)
        )
      );
    };
    decisions.sort((a, b) => rankScore(b) - rankScore(a));

    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      model: "MLB Decision Engine v1",
      marketSource: {
        source: board.source ?? null,
        providersUsed: board.providersUsed ?? [],
        providerChain: board.providerChain ?? [],
        providerFailures: board.providerFailures ?? []
      },
      method: {
        independentBaseball:
          "expected-record/log5 team strength + home field + probable starter ERA/WHIP",
        marketBlend: "70% baseball projection / 30% no-vig market baseline",
        playoffLeverage:
          "modest adjustment capped at +/-0.75 probability points",
        modelCandidateRule:
          "Raw model PLAY requires >=2.5 percentage-point model edge, >=3% EV, and >=0.70 data quality",
        finalGate:
          "Raw PLAY stays WATCH until direct sharp-book price, weather, confirmed lineup, and game-status checks pass",
        limitations:
          "v1 does not yet automate weather, confirmed lineups, bullpen availability, or direct Pinnacle/Circa pricing",
      },
      decisionCount: decisions.length,
      decisions,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Decision engine failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
