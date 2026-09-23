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
    const hours = Math.max(1, Math.min(48, Number(u.searchParams.get("hours") || 12)));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("model_audit_observations")
      .select("*")
      .eq("sport", sport)
      .gte("captured_at", since)
      .order("captured_at", { ascending: false })
      .limit(2000);

    if (error) throw error;

    const seen = new Set<string>();
    const latest = [];
    for (const row of data ?? []) {
      const key = `${row.event_id}|${row.side_key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push(row);
    }

    return new Response(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      sport,
      hours,
      count: latest.length,
      candidates: latest,
    }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=30",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});