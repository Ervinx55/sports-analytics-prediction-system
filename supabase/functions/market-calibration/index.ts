import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function unitProfit(odds: number | null, outcome: string | null) {
  if (outcome === "PUSH") return 0;
  if (odds === null || odds === 0 || !outcome) return null;
  if (outcome === "L") return -1;
  if (outcome !== "W") return null;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function summarize(rows: any[]) {
  const graded = rows.filter((r) => ["W", "L", "PUSH"].includes(String(r.outcome)));
  const decisive = graded.filter((r) => r.outcome === "W" || r.outcome === "L");
  const wins = decisive.filter((r) => r.outcome === "W").length;
  const losses = decisive.filter((r) => r.outcome === "L").length;
  const pushes = graded.filter((r) => r.outcome === "PUSH").length;

  let units = 0;
  let betCount = 0;
  let brier = 0;
  let brierN = 0;
  const edges: number[] = [];
  const evs: number[] = [];

  for (const r of graded) {
    const edge = num(r.edge_pct_points);
    if (edge !== null) edges.push(edge);
    const ev = num(r.ev_pct);
    if (ev !== null) evs.push(ev);

    const p = num(r.model_probability);
    if (p !== null && (r.outcome === "W" || r.outcome === "L")) {
      const y = r.outcome === "W" ? 1 : 0;
      brier += (p - y) ** 2;
      brierN++;
    }

    if (r.decision_status === "PLAY") {
      const profit = unitProfit(num(r.best_odds), r.outcome);
      if (profit !== null) {
        units += profit;
        betCount++;
      }
    }
  }

  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

  return {
    graded: graded.length,
    wins,
    losses,
    pushes,
    winRate: wins + losses ? Number((wins / (wins + losses)).toFixed(4)) : null,
    plays: graded.filter((r) => r.decision_status === "PLAY").length,
    passes: graded.filter((r) => r.decision_status === "PASS").length,
    units: Number(units.toFixed(3)),
    roiPct: betCount ? Number(((units / betCount) * 100).toFixed(2)) : null,
    averageEdgePctPoints: edges.length ? Number(avg(edges)!.toFixed(2)) : null,
    averageEvPct: evs.length ? Number(avg(evs)!.toFixed(2)) : null,
    brierScore: brierN ? Number((brier / brierN).toFixed(4)) : null,
  };
}

function edgeBucket(edge: number | null) {
  if (edge === null) return "unknown";
  if (edge < 0) return "<0 pp";
  if (edge < 2.5) return "0-2.49 pp";
  if (edge < 4) return "2.5-3.99 pp";
  if (edge < 6) return "4-5.99 pp";
  return "6+ pp";
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
    const sport = (u.searchParams.get("sport") || "MLB").toUpperCase();
    const days = Math.max(1, Math.min(365, Number(u.searchParams.get("days") || 90)));
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [
      { data: observations, error: obsError },
      { data: results, error: resError },
      { data: clvRows, error: clvError },
      { data: uncertaintyRows, error: uncertaintyError },
    ] = await Promise.all([
        supabase
          .from("market_grade_observations")
          .select("*")
          .eq("sport", sport)
          .gte("captured_at", since)
          .order("captured_at", { ascending: false })
          .limit(5000),
        supabase
          .from("team_market_results")
          .select("*")
          .gte("graded_at", since)
          .order("graded_at", { ascending: false })
          .limit(5000),
        supabase
          .from("sharp_market_clv")
          .select("*")
          .eq("sport", sport)
          .gte("starts_at", since)
          .order("starts_at", { ascending: false })
          .limit(5000),
        supabase
          .from("market_uncertainty_shadow")
          .select("*")
          .eq("sport", sport)
          .gte("source_captured_at", since)
          .order("source_captured_at", { ascending: false })
          .limit(5000),
      ]);

    if (obsError) throw obsError;
    if (resError) throw resError;
    if (clvError) throw clvError;
    if (uncertaintyError) throw uncertaintyError;

    const resultByObservation = new Map(
      (results ?? []).map((r: any) => [Number(r.observation_id), r]),
    );
    const uncertaintyByObservation = new Map(
      (uncertaintyRows ?? []).map((r: any) => [Number(r.observation_id), r]),
    );

    const latest = new Map<string, any>();
    for (const o of observations ?? []) {
      const key = [
        o.event_id,
        o.market_type,
        o.market_side,
        o.line == null ? "" : Number(o.line),
      ].join("|");
      if (!latest.has(key)) latest.set(key, o);
    }

    const rows = [...latest.values()]
      .map((o: any) => {
        const r = resultByObservation.get(Number(o.id));
        if (!r) return null;
        const uncertainty = uncertaintyByObservation.get(Number(o.id)) ?? null;
        return {
          ...o,
          decision_status: r.decision_status,
          outcome: r.outcome,
          pass_evaluation: r.pass_evaluation,
          uncertainty,
          uncertainty_classification: uncertainty?.classification ?? null,
          uncertainty_pp: uncertainty?.uncertainty_pp ?? null,
          robust_market_edge_pp: uncertainty?.robust_market_edge_pp ?? null,
          robust_sharp_edge_pp: uncertainty?.robust_sharp_edge_pp ?? null,
        };
      })
      .filter(Boolean);

    const byMarketType: Record<string, any> = {};
    for (const type of ["moneyline", "spread", "total"]) {
      byMarketType[type] = summarize(rows.filter((r: any) => r.market_type === type));
    }

    const byDecision: Record<string, any> = {
      PLAY: summarize(rows.filter((r: any) => r.decision_status === "PLAY")),
      PASS: summarize(rows.filter((r: any) => r.decision_status === "PASS")),
    };

    const bucketMap = new Map<string, any[]>();
    for (const r of rows as any[]) {
      const key = edgeBucket(num(r.edge_pct_points));
      if (!bucketMap.has(key)) bucketMap.set(key, []);
      bucketMap.get(key)!.push(r);
    }

    const byEdgeBucket = Object.fromEntries(
      [...bucketMap.entries()].map(([bucket, xs]) => [bucket, summarize(xs)]),
    );

    const passReview = {
      goodPasses: rows.filter((r: any) => r.pass_evaluation === "GOOD_PASS").length,
      missedWins: rows.filter((r: any) => r.pass_evaluation === "MISSED_WIN").length,
      hardPasses: rows.filter((r: any) =>
        String(r.pass_evaluation || "").startsWith("HARD_PASS_")
      ).length,
    };

    const avg = (xs: number[]) =>
      xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

    const summarizeClv = (xs: any[]) => {
      const usable = xs.filter((r) => num(r.closing_sharp_probability) !== null);
      const clv = usable.map((r) => num(r.market_to_close_clv_pp)).filter((x): x is number => x !== null);
      const modelClose = usable.map((r) => num(r.model_vs_close_pp)).filter((x): x is number => x !== null);
      const sharpMove = usable.map((r) => num(r.tracked_sharp_move_pp)).filter((x): x is number => x !== null);
      return {
        records: usable.length,
        averageMarketToCloseClvPctPoints:
          clv.length ? Number(avg(clv)!.toFixed(3)) : null,
        positiveClvRate:
          clv.length ? Number((clv.filter((x) => x > 0).length / clv.length).toFixed(4)) : null,
        averageModelVsClosePctPoints:
          modelClose.length ? Number(avg(modelClose)!.toFixed(3)) : null,
        averageTrackedSharpMovePctPoints:
          sharpMove.length ? Number(avg(sharpMove)!.toFixed(3)) : null,
      };
    };

    const sharpClv = {
      overall: summarizeClv(clvRows ?? []),
      byMarketType: {
        moneyline: summarizeClv((clvRows ?? []).filter((r:any) => r.market_type === "moneyline")),
        spread: summarizeClv((clvRows ?? []).filter((r:any) => r.market_type === "spread")),
        total: summarizeClv((clvRows ?? []).filter((r:any) => r.market_type === "total")),
      },
      byDecision: {
        PLAY: summarizeClv((clvRows ?? []).filter((r:any) => r.decision_status === "PLAY")),
        PASS: summarizeClv((clvRows ?? []).filter((r:any) => r.decision_status === "PASS")),
      },
    };

    const summarizeUncertainty = (xs: any[]) => {
      const withShadow = xs.filter((r) => r.uncertainty);
      const uncertaintyVals = withShadow
        .map((r) => num(r.uncertainty_pp))
        .filter((x): x is number => x !== null);
      const robustMarket = withShadow
        .map((r) => num(r.robust_market_edge_pp))
        .filter((x): x is number => x !== null);
      const robustSharp = withShadow
        .map((r) => num(r.robust_sharp_edge_pp))
        .filter((x): x is number => x !== null);
      return {
        ...summarize(xs),
        shadowRecords: withShadow.length,
        averageUncertaintyPctPoints:
          uncertaintyVals.length ? Number(avg(uncertaintyVals)!.toFixed(3)) : null,
        averageRobustMarketEdgePctPoints:
          robustMarket.length ? Number(avg(robustMarket)!.toFixed(3)) : null,
        averageRobustSharpEdgePctPoints:
          robustSharp.length ? Number(avg(robustSharp)!.toFixed(3)) : null,
      };
    };

    const classes = ["ROBUST", "MARGINAL", "FRAGILE", "INCOMPLETE"];
    const byUncertaintyClass = Object.fromEntries(
      classes.map((classification) => [
        classification,
        summarizeUncertainty(
          rows.filter((r: any) => r.uncertainty_classification === classification),
        ),
      ]),
    );

    const uncertaintyShadow = {
      evaluatorVersion: "uncertainty-v1",
      shadowOnly: true,
      affectsDecision: false,
      records: rows.filter((r: any) => r.uncertainty).length,
      byClassification: byUncertaintyClass,
      byMarketType: {
        moneyline: summarizeUncertainty(rows.filter((r: any) => r.market_type === "moneyline")),
        spread: summarizeUncertainty(rows.filter((r: any) => r.market_type === "spread")),
        total: summarizeUncertainty(rows.filter((r: any) => r.market_type === "total")),
      },
      positiveHeadlineButNonPositiveRobust: rows.filter((r: any) =>
        num(r.edge_pct_points) !== null &&
        Number(r.edge_pct_points) > 0 &&
        num(r.robust_market_edge_pp) !== null &&
        Number(r.robust_market_edge_pp) <= 0
      ).length,
    };

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        sport,
        days,
        policy:
          "Calibration is descriptive only. Do not retune thresholds from a small sample; compare market types, edge buckets, CLV and Brier score after enough independent graded decisions accumulate.",
        overall: summarize(rows),
        byMarketType,
        byDecision,
        byEdgeBucket,
        passReview,
        sharpClv,
        uncertaintyShadow,
        sampleSize: rows.length,
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
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});