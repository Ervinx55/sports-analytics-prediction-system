import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const limit = Math.max(10, Math.min(200, Number(u.searchParams.get("limit") || 50)));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [
      calibrationRows,
      resultsRows,
      auditCount,
      gradeCount,
      snapshotCount,
      latestAudit,
      latestSnapshot,
    ] = await Promise.all([
      supabase
        .from("model_calibration_latest")
        .select("*")
        .eq("sport", sport)
        .order("starts_at", { ascending: false })
        .limit(limit),
      supabase
        .from("game_results")
        .select("*")
        .eq("sport", sport)
        .order("starts_at", { ascending: false })
        .limit(limit),
      supabase
        .from("model_audit_observations")
        .select("id", { count: "exact", head: true })
        .eq("sport", sport),
      supabase
        .from("candidate_grades")
        .select("audit_id", { count: "exact", head: true }),
      supabase
        .from("market_snapshots")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("model_audit_observations")
        .select("captured_at")
        .eq("sport", sport)
        .order("captured_at", { ascending: false })
        .limit(1),
      supabase
        .from("market_snapshots")
        .select("captured_at")
        .order("captured_at", { ascending: false })
        .limit(1),
    ]);

    for (const result of [calibrationRows, resultsRows, auditCount, gradeCount, snapshotCount, latestAudit, latestSnapshot]) {
      if (result.error) throw result.error;
    }

    const gradeRows = calibrationRows.data ?? [];
    const summary = {
      auditRows: auditCount.count ?? 0,
      gameResults: resultsRows.data?.length ?? 0,
      grades: gradeCount.count ?? 0,
      marketSnapshots: snapshotCount.count ?? 0,
      latestAuditAt: latestAudit.data?.[0]?.captured_at ?? null,
      latestSnapshotAt: latestSnapshot.data?.[0]?.captured_at ?? null,
    };

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        sport,
        summary,
        grades: gradeRows,
        results: resultsRows.data ?? [],
      }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=30",
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