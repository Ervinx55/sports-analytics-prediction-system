import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function keyOf(r: any) {
  return [
    r.event_id ?? "",
    r.market_type ?? "",
    r.market_side ?? "",
    r.line == null ? "" : Number(r.line),
  ].join("|");
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
    const hours = Math.max(1, Math.min(72, Number(u.searchParams.get("hours") || 24)));
    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("market_uncertainty_latest")
      .select("*")
      .eq("sport", sport)
      .gte("source_captured_at", since)
      .order("starts_at", { ascending: true })
      .limit(500);

    if (error) throw error;

    const rows = data ?? [];
    const average = (xs: number[]) =>
      xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

    const uncertaintyVals = rows
      .map((r: any) => num(r.uncertainty_pp))
      .filter((x): x is number => x !== null);

    const robustMarketVals = rows
      .map((r: any) => num(r.robust_market_edge_pp))
      .filter((x): x is number => x !== null);

    const robustSharpVals = rows
      .map((r: any) => num(r.robust_sharp_edge_pp))
      .filter((x): x is number => x !== null);

    const byClassification: Record<string, number> = {};
    for (const r of rows as any[]) {
      const k = String(r.classification || "UNKNOWN");
      byClassification[k] = (byClassification[k] || 0) + 1;
    }

    const byMarketType: Record<string, any> = {};
    for (const type of ["moneyline", "spread", "total"]) {
      const xs = rows.filter((r: any) => r.market_type === type);
      const uvals = xs
        .map((r: any) => num(r.uncertainty_pp))
        .filter((x): x is number => x !== null);
      const redges = xs
        .map((r: any) => num(r.robust_market_edge_pp))
        .filter((x): x is number => x !== null);

      byMarketType[type] = {
        markets: xs.length,
        robust: xs.filter((r: any) => r.classification === "ROBUST").length,
        marginal: xs.filter((r: any) => r.classification === "MARGINAL").length,
        fragile: xs.filter((r: any) => r.classification === "FRAGILE").length,
        incomplete: xs.filter((r: any) => r.classification === "INCOMPLETE").length,
        averageUncertaintyPctPoints:
          uvals.length ? Number(average(uvals)!.toFixed(3)) : null,
        averageRobustMarketEdgePctPoints:
          redges.length ? Number(average(redges)!.toFixed(3)) : null,
      };
    }

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        sport,
        hours,
        evaluatorVersion: "uncertainty-v1",
        shadowOnly: true,
        affectsDecision: false,
        thresholds: {
          robustMinPctPoints: 2.0,
          marginalMinPctPoints: 0.0,
        },
        summary: {
          markets: rows.length,
          byClassification,
          averageUncertaintyPctPoints:
            uncertaintyVals.length ? Number(average(uncertaintyVals)!.toFixed(3)) : null,
          averageRobustMarketEdgePctPoints:
            robustMarketVals.length ? Number(average(robustMarketVals)!.toFixed(3)) : null,
          sharpReferencedMarkets: rows.filter((r: any) => r.reference_type === "sharp").length,
          averageRobustSharpEdgePctPoints:
            robustSharpVals.length ? Number(average(robustSharpVals)!.toFixed(3)) : null,
        },
        byMarketType,
        markets: rows.map((r: any) => ({
          ...r,
          key: keyOf(r),
        })),
      }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=20",
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