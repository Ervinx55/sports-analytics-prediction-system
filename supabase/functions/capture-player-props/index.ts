import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODEL_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/propmodel";

function chicagoDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const date = body.date ? String(body.date) : chicagoDate();
    const startsAfter = new Date().toISOString();
    const startsBefore = new Date(Date.now() + 100 * 60_000).toISOString();

    const params = new URLSearchParams({
      date,
      startsAfter,
      startsBefore,
    });

    const r = await fetch(`${MODEL_URL}?${params.toString()}`, {
      headers: { accept: "application/json" },
    });
    const model = await r.json();
    if (!r.ok) {
      throw new Error(
        `prop model failed: ${r.status} ${JSON.stringify(model).slice(0, 500)}`,
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const capturedAt = new Date().toISOString();
    const rows = (model.props ?? []).map((p: any) => ({
      captured_at: capturedAt,
      sport: "MLB",
      model_version: model.version ?? "MLB Player Props Model v1.2",
      event_id: p.eventID,
      game_pk: p.gamePk ?? null,
      starts_at: p.startsAt ?? null,
      away_team: p.matchup?.away?.name ?? null,
      home_team: p.matchup?.home?.name ?? null,
      player_id: p.playerID ?? null,
      mlb_player_id: p.mlbPlayerId ?? null,
      player_name: p.playerName,
      stat_id: p.statID,
      market_name: p.market ?? null,
      line: p.line,
      side: p.side,
      label: p.label,
      model_mean: p.modelMean ?? null,
      raw_independent_probability: p.rawIndependentProbability ?? null,
      model_probability: p.modelProbability ?? null,
      push_probability: p.pushProbability ?? null,
      market_fair_probability: p.marketFairProbability ?? null,
      edge_pct_points: p.edgePctPoints ?? null,
      best_book: p.bestBook ?? null,
      best_odds: p.bestOdds ?? null,
      exact_line_book_count: p.exactLineBookCount ?? null,
      paired_books: p.pairedBooks ?? null,
      ev_pct: p.evPct ?? null,
      data_quality: p.dataQuality ?? null,
      status: p.status,
      reason: p.reason ?? null,
      tf_shadow_model_version:
        p.tensorflowShadow?.modelVersion ?? null,
      tf_shadow_probability:
        p.tensorflowShadow?.probability ?? null,
      tf_shadow_ensemble_probability:
        p.tensorflowShadow?.ensembleProbability ?? null,
      tf_shadow_production_weight:
        p.tensorflowShadow?.productionWeight ?? null,
      tf_shadow_selected_validation_weight:
        p.tensorflowShadow?.selectedValidationWeight ?? null,
      tf_shadow_eligible_for_production:
        p.tensorflowShadow?.eligibleForProduction ?? null,
      tf_shadow_affects_decision:
        Boolean(p.tensorflowShadow?.affectsDecision),
      raw: {
        projection: p.projection ?? null,
        tensorflowShadow: p.tensorflowShadow ?? null,
      },
    }));

    if (rows.length) {
      const { error } = await supabase
        .from("player_prop_observations")
        .insert(rows);
      if (error) throw error;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        capturedAt,
        date,
        version: model.version ?? null,
        rowCount: rows.length,
        summary: model.summary ?? null,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});