const SAVANT =
  "https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats";

const CACHE_TTL_MS = 5 * 60 * 1000;
const csvCache = globalThis.__pitchMixCsvCache || new Map();
globalThis.__pitchMixCsvCache = csvCache;

async function fetchText(url) {
  const now = Date.now();
  const cached = csvCache.get(url);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.text;

  const r = await fetch(url, {
    headers: {
      accept: "text/csv,text/plain,*/*",
      "user-agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
  const text = await r.text();
  csvCache.set(url, { at: now, text });
  return text;
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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((x) => x.trim());

  return rows
    .slice(1)
    .filter((r) => r.some((x) => x !== ""))
    .map((r) => {
      const o = {};
      headers.forEach((h, i) => {
        o[h] = r[i] ?? "";
      });
      return o;
    });
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function lineupFromFeed(feed, side) {
  const teamBox = feed?.liveData?.boxscore?.teams?.[side] || {};
  const order = Array.isArray(teamBox.battingOrder)
    ? teamBox.battingOrder
    : [];
  const players = feed?.gameData?.players || {};

  return {
    confirmed: order.length >= 9,
    battingOrder: order.map((id, index) => ({
      spot: index + 1,
      id: Number(id),
      name: players[`ID${id}`]?.fullName || String(id),
    })),
  };
}

function topArsenal(rows, pitcherId) {
  const all = rows
    .filter((r) => Number(r.player_id) === Number(pitcherId))
    .map((r) => ({
      pitchType: r.pitch_type,
      pitchName: r.pitch_name,
      usage: num(r.pitch_usage) === null ? null : num(r.pitch_usage) / 100,
      pitches: num(r.pitches),
      xwobaAllowed: num(r.est_woba),
      wobaAllowed: num(r.woba),
      runValuePer100: num(r.run_value_per_100),
      whiffPct: num(r.whiff_percent),
    }))
    .filter((r) => r.pitchType && r.usage !== null && r.usage >= 0.08)
    .sort((a, b) => b.usage - a.usage);

  const selected = [];
  let coverage = 0;
  for (const p of all) {
    if (selected.length >= 4) break;
    selected.push(p);
    coverage += p.usage;
    if (coverage >= 0.85 && selected.length >= 2) break;
  }

  const norm = selected.reduce((s, p) => s + p.usage, 0);
  return {
    pitches: selected.map((p) => ({
      ...p,
      normalizedUsage: norm > 0 ? p.usage / norm : 0,
    })),
    coverage,
  };
}

function weightedLeagueBaseline(rows) {
  let nume = 0;
  let den = 0;
  for (const r of rows) {
    const xwoba = num(r.est_woba);
    const pitches = num(r.pitches);
    if (xwoba === null || pitches === null || pitches <= 0) continue;
    nume += xwoba * pitches;
    den += pitches;
  }
  return den ? nume / den : null;
}

function lineupVsPitchType(lineup, rows, leagueBaseline) {
  if (!lineup?.confirmed || leagueBaseline === null) {
    return { available: false };
  }

  const rowById = new Map(
    rows.map((r) => [Number(r.player_id), r])
  );
  const orderWeights = [1.12, 1.10, 1.08, 1.07, 1.04, 1.00, 0.96, 0.92, 0.88];

  let weighted = 0;
  let weightTotal = 0;
  let rawSamples = 0;
  const players = [];

  for (let i = 0; i < lineup.battingOrder.length; i++) {
    const hitter = lineup.battingOrder[i];
    const r = rowById.get(Number(hitter.id));
    const raw = num(r?.est_woba);
    const pitchesSeen = num(r?.pitches) || 0;
    const reliability = clamp(pitchesSeen / 150, 0, 1);
    const regressed =
      raw === null
        ? leagueBaseline
        : leagueBaseline + reliability * (raw - leagueBaseline);
    const w = orderWeights[i] || 0.85;

    weighted += regressed * w;
    weightTotal += w;
    rawSamples += pitchesSeen;

    players.push({
      spot: hitter.spot,
      id: hitter.id,
      name: hitter.name,
      rawXwoba: raw,
      pitchesSeen,
      reliability: Number(reliability.toFixed(3)),
      regressedXwoba: Number(regressed.toFixed(3)),
      weight: w,
    });
  }

  return {
    available: weightTotal > 0,
    leagueBaselineXwoba: Number(leagueBaseline.toFixed(3)),
    lineupXwoba: Number((weighted / weightTotal).toFixed(3)),
    totalPitchSamples: rawSamples,
    players,
  };
}

async function savantRows({ type, pitchType = "" }) {
  const u = new URL(SAVANT);
  u.searchParams.set("type", type);
  u.searchParams.set("year", "2026");
  u.searchParams.set("min", "1");
  u.searchParams.set("minPitches", "1");
  u.searchParams.set("pitchType", pitchType);
  u.searchParams.set("csv", "true");
  const text = await fetchText(u.toString());
  return parseCsv(text);
}

async function offenseVsStarter({
  lineup,
  starter,
  pitcherRows,
  batterRowsByPitch,
}) {
  const arsenal = topArsenal(pitcherRows, starter.id);

  if (!lineup?.confirmed) {
    return {
      available: false,
      reason: "confirmed lineup required",
      starter,
      arsenal,
    };
  }
  if (arsenal.pitches.length < 2 || arsenal.coverage < 0.55) {
    return {
      available: false,
      reason: "starter arsenal coverage is insufficient",
      starter,
      arsenal,
    };
  }

  const pitchResults = [];
  let delta = 0;
  let usableUsage = 0;

  for (const pitch of arsenal.pitches) {
    const rows = batterRowsByPitch.get(pitch.pitchType) || [];
    const leagueBaseline = weightedLeagueBaseline(rows);
    const lineupResult = lineupVsPitchType(
      lineup,
      rows,
      leagueBaseline
    );

    if (!lineupResult.available) continue;

    const pitchDelta =
      lineupResult.lineupXwoba - lineupResult.leagueBaselineXwoba;

    delta += pitch.normalizedUsage * pitchDelta;
    usableUsage += pitch.normalizedUsage;

    pitchResults.push({
      ...pitch,
      leagueBaselineXwoba: lineupResult.leagueBaselineXwoba,
      lineupXwoba: lineupResult.lineupXwoba,
      xwobaDelta: Number(pitchDelta.toFixed(3)),
      totalPitchSamples: lineupResult.totalPitchSamples,
      hitterDetails: lineupResult.players,
    });
  }

  if (usableUsage < 0.6) {
    return {
      available: false,
      reason: "not enough usable batter-vs-pitch-type data",
      starter,
      arsenal,
      pitchResults,
      usableUsage,
    };
  }

  const normalizedDelta = delta / usableUsage;

  // This is a matchup-fit layer, not a second starter-quality model.
  // A +/- .050 xwOBA mismatch maps to roughly +/-0.75 probability points.
  const probabilityAdjustment = clamp(normalizedDelta * 0.15, -0.008, 0.008);

  return {
    available: true,
    starter,
    arsenalCoverage: Number(arsenal.coverage.toFixed(3)),
    usableUsage: Number(usableUsage.toFixed(3)),
    weightedXwobaDelta: Number(normalizedDelta.toFixed(3)),
    probabilityAdjustment: Number(probabilityAdjustment.toFixed(4)),
    probabilityAdjustmentPctPoints: Number(
      (probabilityAdjustment * 100).toFixed(2)
    ),
    pitchResults,
    methodology:
      "Starter arsenal comes from Baseball Savant pitch-arsenal usage. Confirmed hitters are scored by Statcast xwOBA versus each pitch type, regressed toward the pitch-type league baseline by pitches seen, weighted by batting-order position and starter pitch usage. This layer measures matchup fit and is capped at +/-0.8 win-probability points per offense.",
  };
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

    const status = feed?.gameData?.status || {};
    if (status.abstractGameState !== "Preview") {
      return res.status(409).json({
        error: "game is not in preview state",
        status,
      });
    }

    const awayLineup = lineupFromFeed(feed, "away");
    const homeLineup = lineupFromFeed(feed, "home");
    const starters = feed?.gameData?.probablePitchers || {};

    const awayStarter = starters.away
      ? { id: Number(starters.away.id), name: starters.away.fullName }
      : null;
    const homeStarter = starters.home
      ? { id: Number(starters.home.id), name: starters.home.fullName }
      : null;

    if (!awayStarter || !homeStarter) {
      return res.status(409).json({
        error: "both official probable starters are required",
      });
    }

    const pitcherRows = await savantRows({ type: "pitcher" });
    const awayArsenal = topArsenal(pitcherRows, awayStarter.id);
    const homeArsenal = topArsenal(pitcherRows, homeStarter.id);

    const pitchTypes = [
      ...new Set([
        ...awayArsenal.pitches.map((p) => p.pitchType),
        ...homeArsenal.pitches.map((p) => p.pitchType),
      ]),
    ];

    const batterRowsByPitch = new Map();
    await Promise.all(
      pitchTypes.map(async (pitchType) => {
        const rows = await savantRows({
          type: "batter",
          pitchType,
        });
        batterRowsByPitch.set(pitchType, rows);
      })
    );

    const [awayOffenseVsHomeStarter, homeOffenseVsAwayStarter] =
      await Promise.all([
        offenseVsStarter({
          lineup: awayLineup,
          starter: homeStarter,
          pitcherRows,
          batterRowsByPitch,
        }),
        offenseVsStarter({
          lineup: homeLineup,
          starter: awayStarter,
          pitcherRows,
          batterRowsByPitch,
        }),
      ]);

    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      version: "Pitch Mix Matchup v1",
      source: "MLB Stats + Baseball Savant Statcast Pitch Arsenal",
      gamePk,
      matchup: {
        away: feed?.gameData?.teams?.away?.name || null,
        home: feed?.gameData?.teams?.home?.name || null,
      },
      status,
      lineupsConfirmed:
        awayLineup.confirmed && homeLineup.confirmed,
      pitchTypes,
      awayOffenseVsHomeStarter,
      homeOffenseVsAwayStarter,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Pitch mix matchup failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
