import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

function summarize(rows: any[], config: any) {
  const graded = rows.filter((r) => ["W", "L", "PUSH"].includes(String(r.outcome)));
  const plays = graded.filter((r) => r.final_shadow_decision === "PLAY");
  const passes = graded.filter((r) => r.final_shadow_decision === "PASS");
  const decisivePlays = plays.filter((r) => r.outcome === "W" || r.outcome === "L");
  const wins = decisivePlays.filter((r) => r.outcome === "W").length;
  const losses = decisivePlays.filter((r) => r.outcome === "L").length;
  const pushes = plays.filter((r) => r.outcome === "PUSH").length;

  const units = plays
    .map((r) => num(r.unit_profit))
    .filter((x): x is number => x !== null);
  const unitTotal = units.reduce((s, x) => s + x, 0);

  const robustMarket = rows
    .map((r) => num(r.robust_market_edge_pp))
    .filter((x): x is number => x !== null);
  const robustSharp = rows
    .map((r) => num(r.robust_sharp_edge_pp))
    .filter((x): x is number => x !== null);
  const uncertainty = rows
    .map((r) => num(r.uncertainty_pp))
    .filter((x): x is number => x !== null);

  const clvRows = plays
    .map((r) => num(r.market_to_close_clv_pp))
    .filter((x): x is number => x !== null);

  let brier = 0;
  let brierN = 0;
  for (const r of plays) {
    const p = num(r.model_probability);
    if (p !== null && (r.outcome === "W" || r.outcome === "L")) {
      const y = r.outcome === "W" ? 1 : 0;
      brier += (p - y) ** 2;
      brierN++;
    }
  }

  const playCount = plays.length;
  const stabilityStatus =
    playCount >= 100 ? "EVALUABLE" :
    playCount >= 30 ? "EARLY" :
    "INSUFFICIENT_SAMPLE";

  const reasonCounts: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r.final_reason_code || "UNKNOWN");
    reasonCounts[k] = (reasonCounts[k] || 0) + 1;
  }

  return {
    config,
    sampleStatus: stabilityStatus,
    finalCandidates: rows.length,
    graded: graded.length,
    shadowPlays: rows.filter((r) => r.final_shadow_decision === "PLAY").length,
    shadowPasses: rows.filter((r) => r.final_shadow_decision === "PASS").length,
    pendingAtDeadline: rows.filter((r) => r.final_reason_code === "PENDING_AT_DEADLINE").length,
    playResults: {
      wins,
      losses,
      pushes,
      winRate: wins + losses ? Number((wins / (wins + losses)).toFixed(4)) : null,
      units: Number(unitTotal.toFixed(3)),
      roiPct: playCount ? Number(((unitTotal / playCount) * 100).toFixed(2)) : null,
      brierScore: brierN ? Number((brier / brierN).toFixed(4)) : null,
    },
    passReview: {
      goodPasses: passes.filter((r) => r.policy_evaluation === "GOOD_PASS").length,
      missedWins: passes.filter((r) => r.policy_evaluation === "MISSED_WIN").length,
      passPushes: passes.filter((r) => r.policy_evaluation === "PASS_PUSH").length,
    },
    averages: {
      robustMarketEdgePctPoints:
        robustMarket.length ? Number(avg(robustMarket)!.toFixed(3)) : null,
      robustSharpEdgePctPoints:
        robustSharp.length ? Number(avg(robustSharp)!.toFixed(3)) : null,
      uncertaintyPctPoints:
        uncertainty.length ? Number(avg(uncertainty)!.toFixed(3)) : null,
      marketToCloseClvPctPoints:
        clvRows.length ? Number(avg(clvRows)!.toFixed(3)) : null,
      positiveClvRate:
        clvRows.length
          ? Number((clvRows.filter((x) => x > 0).length / clvRows.length).toFixed(4))
          : null,
    },
    reasonCounts,
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

    const url = new URL(req.url);
    const sport = (url.searchParams.get("sport") || "MLB").toUpperCase();
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") || 90)));
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [{ data: policies, error: policyError }, { data: rows, error: rowError }] =
      await Promise.all([
        supabase
          .from("market_policy_registry")
          .select("*")
          .eq("active", true)
          .order("market_type", { ascending: true })
          .order("policy_family", { ascending: true }),
        supabase
          .from("market_policy_grade_latest")
          .select("*")
          .eq("sport", sport)
          .gte("starts_at", since)
          .order("starts_at", { ascending: false })
          .limit(5000),
      ]);

    if (policyError) {
      throw new Error("policy query failed: " + JSON.stringify(policyError));
    }
    if (rowError) {
      throw new Error("grade query failed: " + JSON.stringify(rowError));
    }

    const byPolicy: Record<string, any> = {};
    for (const p of policies ?? []) {
      const xs = (rows ?? []).filter((r: any) => r.policy_id === p.policy_id);
      byPolicy[p.policy_id] = {
        policyId: p.policy_id,
        displayName: p.display_name,
        marketType: p.market_type,
        family: p.policy_family,
        shadowOnly: Boolean(p.shadow_only),
        affectsDecision: Boolean(p.affects_decision),
        ...summarize(xs, p.config),
      };
    }

    const byMarketType: Record<string, any> = {};
    for (const type of ["moneyline", "spread", "total"]) {
      const ids = (policies ?? [])
        .filter((p: any) => p.market_type === type)
        .map((p: any) => p.policy_id);
      byMarketType[type] = ids.map((id: string) => byPolicy[id]);
    }

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        evaluatorVersion: "market-policy-v1",
        sport,
        days,
        shadowOnly: true,
        affectsDecision: false,
        policyCount: policies?.length ?? 0,
        policyFamilies: ["EXPLORE", "BALANCED", "STRICT"],
        promotionPolicy:
          "No challenger changes production automatically. Threshold changes require a sufficiently large sample and explicit review of ROI, calibration, CLV, good passes, missed wins, and failure reasons.",
        byPolicy,
        byMarketType,
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
        error: error instanceof Error
          ? error.message
          : JSON.stringify(error),
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});