import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function unitProfit(odds: number | null, won: boolean): number | null {
  if (odds === null || odds === 0) return null;
  if (!won) return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function summarize(rows: any[]) {
  const usable = rows.filter(
    (r) => num(r.final_probability) !== null && typeof r.won === "boolean",
  );

  const n = usable.length;
  if (!n) {
    return {
      sampleSize: 0,
      status: "insufficient_sample",
      targetSample: 100,
    };
  }

  let wins = 0;
  let brier = 0;
  let logLoss = 0;
  let profit = 0;
  let profitCount = 0;
  const clv: number[] = [];
  const modelVsClose: number[] = [];

  const bins = new Map<string, any[]>();
  const edges = [
    [0.00, 0.45],
    [0.45, 0.50],
    [0.50, 0.55],
    [0.55, 0.60],
    [0.60, 0.65],
    [0.65, 0.70],
    [0.70, 1.01],
  ];

  for (const r of usable) {
    const p = Math.max(0.001, Math.min(0.999, Number(r.final_probability)));
    const y = r.won ? 1 : 0;
    wins += y;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));

    const odds = num(r.best_odds);
    const up = unitProfit(odds, r.won);
    if (up !== null) {
      profit += up;
      profitCount++;
    }

    const c = num(r.clv_implied_pp);
    if (c !== null) clv.push(c);

    const mvc = num(r.model_vs_close_pp);
    if (mvc !== null) modelVsClose.push(mvc);

    for (const [lo, hi] of edges) {
      if (p >= lo && p < hi) {
        const key = `${Math.round(lo * 100)}-${Math.round(Math.min(hi, 1) * 100)}%`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key)!.push({ p, y });
        break;
      }
    }
  }

  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

  const binRows = [...bins.entries()].map(([bin, xs]) => ({
    bin,
    n: xs.length,
    averageModelProbability: Number(
      (xs.reduce((s, x) => s + x.p, 0) / xs.length).toFixed(4),
    ),
    observedWinRate: Number(
      (xs.reduce((s, x) => s + x.y, 0) / xs.length).toFixed(4),
    ),
    calibrationGapPctPoints: Number(
      (
        (xs.reduce((s, x) => s + x.y, 0) / xs.length -
          xs.reduce((s, x) => s + x.p, 0) / xs.length) *
        100
      ).toFixed(2),
    ),
  }));

  const status =
    n >= 100 ? "calibration_ready" : n >= 30 ? "early_signal" : "insufficient_sample";

  return {
    sampleSize: n,
    status,
    targetSample: 100,
    wins,
    losses: n - wins,
    winRate: Number((wins / n).toFixed(4)),
    averageModelProbability: Number(
      (usable.reduce((s, r) => s + Number(r.final_probability), 0) / n).toFixed(4),
    ),
    calibrationGapPctPoints: Number(
      (
        (wins / n -
          usable.reduce((s, r) => s + Number(r.final_probability), 0) / n) *
        100
      ).toFixed(2),
    ),
    brierScore: Number((brier / n).toFixed(4)),
    logLoss: Number((logLoss / n).toFixed(4)),
    roiPct:
      profitCount > 0 ? Number(((profit / profitCount) * 100).toFixed(2)) : null,
    units: Number(profit.toFixed(3)),
    averageClvImpliedPctPoints:
      clv.length ? Number((avg(clv)! ).toFixed(2)) : null,
    positiveClvRate:
      clv.length
        ? Number((clv.filter((x) => x > 0).length / clv.length).toFixed(4))
        : null,
    averageModelVsClosePctPoints:
      modelVsClose.length ? Number((avg(modelVsClose)! ).toFixed(2)) : null,
    calibrationBins: binRows,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "GET only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const u = new URL(req.url);
    const sport = u.searchParams.get("sport") || "MLB";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("model_calibration_latest")
      .select("*")
      .eq("sport", sport)
      .order("starts_at", { ascending: false })
      .limit(5000);

    if (error) throw error;

    const rows = data ?? [];
    const all = summarize(rows);
    const playCandidates = summarize(
      rows.filter((r: any) => r.model_decision === "PLAY"),
    );
    const fullyVerified = summarize(
      rows.filter(
        (r: any) =>
          r.model_decision === "PLAY" &&
          r.verification_status === "READY_FOR_SHARP_CHECK",
      ),
    );

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        sport,
        modelVersion: "MLB-v7-audit",
        frozenWeights: true,
        policy:
          "Do not retune from short-term wins/losses. Fix data bugs immediately; consider weight changes only after a meaningful graded sample, with 100 completed decisions as the primary target.",
        allCandidates: all,
        rawPlayCandidates: playCandidates,
        nonSharpVerifiedPlayCandidates: fullyVerified,
      }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=60",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});