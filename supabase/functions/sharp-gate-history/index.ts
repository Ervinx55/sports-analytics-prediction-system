import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function avg(xs: number[]) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
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
    const limit = Math.max(10, Math.min(500, Number(u.searchParams.get("limit") || 100)));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [latest, history, finalPlays, disagreement] = await Promise.all([
      supabase
        .from("sharp_gate_latest")
        .select("*")
        .eq("sport", sport)
        .order("checked_at", { ascending: false })
        .limit(limit),
      supabase
        .from("sharp_gate_history")
        .select("*")
        .eq("sport", sport)
        .order("checked_at", { ascending: false })
        .limit(limit),
      supabase
        .from("sharp_gate_history")
        .select("*")
        .eq("sport", sport)
        .eq("final_status", "FINAL_PLAY")
        .order("checked_at", { ascending: false })
        .limit(limit),
      supabase
        .from("sharp_disagreement_shadow")
        .select("*")
        .eq("sport", sport)
        .order("evaluated_at", { ascending: false })
        .limit(Math.max(limit * 3, 100)),
    ]);

    for (const x of [latest, history, finalPlays, disagreement]) {
      if (x.error) throw x.error;
    }

    const diagnosisMap = new Map<number, any>(
      (disagreement.data ?? []).map((x: any) => [Number(x.sharp_gate_id), x]),
    );
    const enrich = (rows: any[]) => rows.map((r: any) => ({
      ...r,
      disagreementDiagnosis: diagnosisMap.get(Number(r.id)) ?? null,
    }));

    const latestRows = enrich(latest.data ?? []);
    const historyRows = enrich(history.data ?? []);
    const finalPlayRows = enrich(finalPlays.data ?? []);
    const qualities = latestRows
      .map((r: any) => Number(r.sharp_data_quality))
      .filter(Number.isFinite);
    const sourceCounts = latestRows
      .map((r: any) => Number(r.valid_sharp_source_count))
      .filter(Number.isFinite);

    const byMode: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byDisagreementClass: Record<string, number> = {};
    const diagnosisConfidence: number[] = [];
    for (const row of latestRows as any[]) {
      const mode = row.gate_mode || "UNKNOWN";
      const status = row.final_status || "UNKNOWN";
      byMode[mode] = (byMode[mode] || 0) + 1;
      byStatus[status] = (byStatus[status] || 0) + 1;
      const diagnosis = row.disagreementDiagnosis;
      if (diagnosis) {
        const cls = diagnosis.classification || "UNKNOWN";
        byDisagreementClass[cls] = (byDisagreementClass[cls] || 0) + 1;
        const conf = Number(diagnosis.confidence);
        if (Number.isFinite(conf)) diagnosisConfidence.push(conf);
      }
    }

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        evaluatorVersion: "sharp-gate-v2",
        sport,
        latest: latestRows,
        history: historyRows,
        finalPlays: finalPlayRows,
        summary: {
          latestCount: latestRows.length,
          historyCount: historyRows.length,
          finalPlayCount: finalPlayRows.length,
          averageDataQuality: qualities.length
            ? Number(avg(qualities)!.toFixed(3))
            : null,
          averageValidSourceCount: sourceCounts.length
            ? Number(avg(sourceCounts)!.toFixed(2))
            : null,
          multiSourceChecks: latestRows.filter(
            (r: any) => Number(r.valid_sharp_source_count) >= 2,
          ).length,
          singleSourceChecks: latestRows.filter(
            (r: any) => Number(r.valid_sharp_source_count) === 1,
          ).length,
          noSourceChecks: latestRows.filter(
            (r: any) => Number(r.valid_sharp_source_count) === 0,
          ).length,
          byMode,
          byStatus,
          byDisagreementClass,
          averageDisagreementConfidence: diagnosisConfidence.length
            ? Number(avg(diagnosisConfidence)!.toFixed(3))
            : null,
          disagreementShadowOnly: true,
          disagreementAffectsDecision: false,
        },
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