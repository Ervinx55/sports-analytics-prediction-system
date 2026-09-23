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
    results: `${BASE}/dashboard-results?sport=${encodeURIComponent(
      sport
    )}&limit=50`,
    movement: `${BASE}/market-movement?league=${encodeURIComponent(
      sport
    )}&hours=${hours}`,
    alerts: `${BASE}/market-alerts?league=${encodeURIComponent(
      sport
    )}&hours=${hours}&minBooks=3`,
  };

  const [audit, calibration, results, movement, alerts] =
    await Promise.allSettled([
      fetchJson(urls.audit),
      fetchJson(urls.calibration),
      fetchJson(urls.results),
      fetchJson(urls.movement),
      fetchJson(urls.alerts),
    ]);

  const sources = {
    audit: settled(audit),
    calibration: settled(calibration),
    results: settled(results),
    movement: settled(movement),
    alerts: settled(alerts),
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
    },
    candidates: activeCandidates,
    calibration: sources.calibration.data || null,
    grades: sources.results.data?.grades || [],
    results: sources.results.data?.results || [],
    movements: movementList,
    alerts: alertList,
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