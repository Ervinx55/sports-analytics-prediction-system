import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

function countBy(rows: any[], field: string) {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row?.[field] ?? "UNKNOWN");
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function avg(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "GET only" }), {
        status: 405,
        headers: { "content-type": "application/json" }
      });
    }

    const url = new URL(req.url);
    const days = Math.max(
      1,
      Math.min(90, Number(url.searchParams.get("days") || 14))
    );
    const since = new Date(
      Date.now() - days * 86400_000
    ).toISOString();
    const quoteSince = new Date(
      Date.now() - 30 * 60_000
    ).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [
      { data: observations, error: observationError },
      { data: results, error: resultError },
      { data: clv, error: clvError },
      { data: quotes, error: quoteError }
    ] = await Promise.all([
      supabase
        .from("player_prop_observations")
        .select("id,starts_at,stat_id,side,status,model_version")
        .eq("sport", "NBA")
        .gte("captured_at", since)
        .limit(20000),
      supabase
        .from("player_prop_results")
        .select("observation_id,outcome,graded_at")
        .eq("sport", "NBA")
        .gte("graded_at", since)
        .limit(20000),
      supabase
        .from("player_prop_clv")
        .select(
          "observation_id,starts_at,finalized,clv_classification,line_clv_units,fair_probability_clv_pp,same_book_price_clv_pp,close_quote_age_minutes"
        )
        .eq("sport", "NBA")
        .gte("starts_at", since)
        .limit(20000),
      supabase
        .from("player_prop_market_quotes")
        .select(
          "observed_at,book,event_id,player_name,stat_id,side,line,odds"
        )
        .eq("sport", "NBA")
        .gte("observed_at", quoteSince)
        .order("observed_at", { ascending: false })
        .limit(20000)
    ]);

    if (observationError) throw observationError;
    if (resultError) throw resultError;
    if (clvError) throw clvError;
    if (quoteError) throw quoteError;

    const resultIds = new Set(
      (results ?? []).map((row: any) => Number(row.observation_id))
    );
    const unresolved = (observations ?? []).filter(
      (row: any) =>
        Date.parse(row.starts_at || "") <= Date.now() &&
        !resultIds.has(Number(row.id))
    );

    const finalizedClv = (clv ?? []).filter(
      (row: any) => row.finalized
    );
    const trackingClv = (clv ?? []).filter(
      (row: any) => !row.finalized
    );

    const lineClv = finalizedClv
      .map((row: any) => Number(row.line_clv_units))
      .filter(Number.isFinite);
    const fairClv = finalizedClv
      .map((row: any) => Number(row.fair_probability_clv_pp))
      .filter(Number.isFinite);
    const closeAge = finalizedClv
      .map((row: any) => Number(row.close_quote_age_minutes))
      .filter(Number.isFinite);

    const bookHealth: Record<string, any> = {};
    for (const book of ["draftkings", "fanduel", "betmgm", "caesars"]) {
      const bookQuotes = (quotes ?? []).filter(
        (quote: any) =>
          String(quote.book).toLowerCase() === book
      );
      bookHealth[book] = {
        quotesLast30m: bookQuotes.length,
        latestObservedAt: bookQuotes[0]?.observed_at ?? null,
        status:
          bookQuotes.length > 0
            ? "ACTIVE"
            : "NO_RECENT_QUOTES"
      };
    }

    return new Response(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      version: "nba-player-prop-feedback-v1",
      sport: "NBA",
      days,
      productionEligible: false,
      summary: {
        observations: observations?.length ?? 0,
        results: results?.length ?? 0,
        unresolvedAfterStart: unresolved.length,
        outcomes: countBy(results ?? [], "outcome"),
        byStat: countBy(observations ?? [], "stat_id"),
        byUpstreamStatus: countBy(
          observations ?? [],
          "status"
        ),
        clvTracked: clv?.length ?? 0,
        clvTracking: trackingClv.length,
        clvFinalized: finalizedClv.length,
        clvByClassification: countBy(
          finalizedClv,
          "clv_classification"
        ),
        averageLineClvUnits:
          lineClv.length
            ? Number(avg(lineClv)!.toFixed(3))
            : null,
        averageFairProbabilityClvPp:
          fairClv.length
            ? Number(avg(fairClv)!.toFixed(3))
            : null,
        averageCloseAgeMinutes:
          closeAge.length
            ? Number(avg(closeAge)!.toFixed(1))
            : null
      },
      bookHealth,
      unresolved: unresolved.slice(0, 100),
      recentResults: (results ?? []).slice(0, 100),
      recentFinalizedClv: finalizedClv.slice(0, 100),
      policy: {
        resultSource: "NBA Official live-data boxscore",
        dnp: "VOID",
        closeFreshnessMinutes: 15,
        automaticPromotion: false
      }
    }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=30"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
});
