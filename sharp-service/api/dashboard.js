const BASE =
  "https://yeoxroijaptomomshdii.supabase.co/functions/v1";

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 500) };
    }
    if (!r.ok) {
      throw new Error(
        `${r.status} ${url}: ${JSON.stringify(data).slice(0, 300)}`
      );
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function settled(result) {
  if (result.status === "fulfilled") {
    return { ok: true, data: result.value, error: null };
  }
  return {
    ok: false,
    data: null,
    error:
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const sport = String(req.query.sport || "MLB").toUpperCase();
  const hours = Math.max(
    6,
    Math.min(72, Number(req.query.hours || 36))
  );

  const urls = {
    audit: `${BASE}/latest-model-audit?sport=${encodeURIComponent(
      sport
    )}&hours=12`,
    calibration: `${BASE}/model-calibration?sport=${encodeURIComponent(
      sport
    )}`,
    marketCalibration: `${BASE}/market-calibration?sport=${encodeURIComponent(
      sport
    )}&days=90`,
    results: `${BASE}/dashboard-results?sport=${encodeURIComponent(
      sport
    )}&limit=50`,
    movement: `${BASE}/market-movement?league=${encodeURIComponent(
      sport
    )}&hours=${hours}`,
    alerts: `${BASE}/market-alerts?league=${encodeURIComponent(
      sport
    )}&hours=${hours}&minBooks=3`,
    sharpGate: `${BASE}/sharp-gate-history?sport=${encodeURIComponent(
      sport
    )}&limit=50`,
    sharpDisagreementCalibration: `${BASE}/sharp-disagreement-calibration?days=90`,
    decisionFusionCalibration: `${BASE}/decision-fusion-calibration?days=90`,
    playerPropFusionCalibration: `${BASE}/player-prop-fusion-calibration?days=90`,
    playerPropClvCalibration: `${BASE}/player-prop-clv-calibration?days=90`,
    sharpSourceHealth: `${BASE}/sharp-source-health`,
    marketCard: `${BASE}/market-card?sport=${encodeURIComponent(
      sport
    )}&hours=12`,
    playerProps: `${BASE}/player-prop-card?hours=12`,
    decisionResults: `${BASE}/decision-results?days=7`,
  };

  const [audit, calibration, marketCalibration, results, movement, alerts, sharpGate, sharpDisagreementCalibration, decisionFusionCalibration, playerPropFusionCalibration, playerPropClvCalibration, sharpSourceHealth, marketCard, playerProps, decisionResults] =
    await Promise.allSettled([
      fetchJson(urls.audit),
      fetchJson(urls.calibration),
      fetchJson(urls.marketCalibration),
      fetchJson(urls.results),
      fetchJson(urls.movement),
      fetchJson(urls.alerts),
      fetchJson(urls.sharpGate),
      fetchJson(urls.sharpDisagreementCalibration),
      fetchJson(urls.decisionFusionCalibration),
      fetchJson(urls.playerPropFusionCalibration),
      fetchJson(urls.playerPropClvCalibration),
      fetchJson(urls.sharpSourceHealth),
      fetchJson(urls.marketCard),
      fetchJson(urls.playerProps),
      fetchJson(urls.decisionResults),
    ]);

  const sources = {
    audit: settled(audit),
    calibration: settled(calibration),
    marketCalibration: settled(marketCalibration),
    results: settled(results),
    movement: settled(movement),
    alerts: settled(alerts),
    sharpGate: settled(sharpGate),
    sharpDisagreementCalibration: settled(sharpDisagreementCalibration),
    decisionFusionCalibration: settled(decisionFusionCalibration),
    playerPropFusionCalibration: settled(playerPropFusionCalibration),
    playerPropClvCalibration: settled(playerPropClvCalibration),
    sharpSourceHealth: settled(sharpSourceHealth),
    marketCard: settled(marketCard),
    playerProps: settled(playerProps),
    decisionResults: settled(decisionResults),
  };

  const sourceHealth = Object.fromEntries(
    Object.entries(sources).map(([name, value]) => [
      name,
      { ok: value.ok, error: value.error },
    ])
  );

  const candidates = sources.audit.data?.candidates || [];
  const now = Date.now();
  const activeCandidates = candidates.filter((c) => {
    const t = Date.parse(c.starts_at || "");
    return !Number.isFinite(t) || t > now - 4 * 60 * 60 * 1000;
  });

  const readyForSharp = activeCandidates.filter(
    (c) => c.verification_status === "READY_FOR_SHARP_CHECK"
  ).length;
  const watch = activeCandidates.filter(
    (c) => c.verification_status === "WATCH"
  ).length;
  const playCandidates = activeCandidates.filter(
    (c) => c.model_decision === "PLAY"
  ).length;

  const alertList =
    sources.alerts.data?.alerts ||
    sources.alerts.data?.flags ||
    [];
  const movementList = sources.movement.data?.movements || [];

  return res.status(200).json({
    fetchedAt: new Date().toISOString(),
    sport,
    summary: {
      activeCandidates: activeCandidates.length,
      readyForSharp,
      watch,
      rawPlayCandidates: playCandidates,
      auditRows:
        sources.results.data?.summary?.auditRows ?? candidates.length,
      grades: sources.results.data?.summary?.grades ?? 0,
      gameResults:
        sources.results.data?.summary?.gameResults ?? 0,
      marketSnapshots:
        sources.results.data?.summary?.marketSnapshots ?? 0,
      alerts: alertList.length,
      movements: movementList.length,
      finalPlays:
        sources.marketCard.data?.summary?.play ??
        sources.sharpGate.data?.summary?.finalPlayCount ??
        0,
      pending:
        sources.marketCard.data?.summary?.pending ?? 0,
      pass:
        sources.marketCard.data?.summary?.pass ?? 0,
      gradedMarkets:
        sources.marketCard.data?.summary?.markets ?? 0,
      sharpGateChecks:
        sources.sharpGate.data?.summary?.historyCount ?? 0,
    },
    candidates: activeCandidates,
    calibration: sources.calibration.data || null,
    marketCalibration: sources.marketCalibration.data || null,
    sharpDisagreementCalibration: sources.sharpDisagreementCalibration.data || null,
    decisionFusionCalibration: sources.decisionFusionCalibration.data || null,
    playerPropFusionCalibration: sources.playerPropFusionCalibration.data || null,
    playerPropClvCalibration: sources.playerPropClvCalibration.data || null,
    grades: sources.results.data?.grades || [],
    results: sources.results.data?.results || [],
    movements: movementList,
    alerts: alertList,
    sharpSourceHealth: sources.sharpSourceHealth.data || {
      refreshCadenceMinutes: 5,
      sources: {}
    },
    sharpGate: sources.sharpGate.data || {
      latest: [],
      history: [],
      finalPlays: [],
      summary: { latestCount: 0, historyCount: 0, finalPlayCount: 0 },
    },
    marketCard: sources.marketCard.data || {
      summary: { markets: 0, play: 0, pending: 0, pass: 0 },
      markets: [],
      plays: [],
      pending: [],
      passes: [],
    },
    playerProps: sources.playerProps.data || {
      summary: { gradedProps: 0, play: 0, pending: 0, pass: 0 },
      plays: [],
      pending: [],
      passes: [],
      props: [],
      recentResults: [],
    },
    decisionResults: sources.decisionResults.data || {
      summary: {
        team: { total: 0, plays: 0, passes: 0, playRecord: { wins: 0, losses: 0, pushes: 0 }, passRecord: { goodPasses: 0, missedWins: 0, pushedPasses: 0 } },
        props: { total: 0, plays: 0, passes: 0, playRecord: { wins: 0, losses: 0, pushes: 0 }, passRecord: { goodPasses: 0, missedWins: 0, pushedPasses: 0 } }
      },
      team: [],
      props: [],
    },
    system: {
      sourceHealth,
      latestAuditAt:
        sources.results.data?.summary?.latestAuditAt || null,
      latestSnapshotAt:
        sources.results.data?.summary?.latestSnapshotAt || null,
      modelVersion:
        sources.calibration.data?.modelVersion || "MLB-v7-audit",
      frozenWeights:
        sources.calibration.data?.frozenWeights ?? true,
    },
  });
}