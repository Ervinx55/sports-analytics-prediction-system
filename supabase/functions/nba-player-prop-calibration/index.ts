import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  calibrationBuckets,
  group,
  marketIntegrityState,
  roleState,
  summarize
} from "./nba-calibration.js";

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
      Math.min(365, Number(url.searchParams.get("days") || 90))
    );
    const since = new Date(
      Date.now() - days * 86400_000
    ).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [
      { data: observations, error: observationError },
      { data: results, error: resultError },
      { data: clv, error: clvError }
    ] = await Promise.all([
      supabase
        .from("player_prop_observations")
        .select(
          "id,captured_at,model_version,event_id,starts_at,player_name,stat_id,line,side,raw_independent_probability,model_probability,market_fair_probability,data_quality,status,raw"
        )
        .eq("sport", "NBA")
        .gte("captured_at", since)
        .limit(30000),
      supabase
        .from("player_prop_results")
        .select(
          "observation_id,outcome,actual_value,graded_at,raw"
        )
        .eq("sport", "NBA")
        .gte("graded_at", since)
        .limit(30000),
      supabase
        .from("player_prop_clv")
        .select(
          "observation_id,clv_classification,line_clv_units,fair_probability_clv_pp,same_book_price_clv_pp,close_quote_age_minutes,finalized"
        )
        .eq("sport", "NBA")
        .gte("starts_at", since)
        .limit(30000)
    ]);

    if (observationError) throw observationError;
    if (resultError) throw resultError;
    if (clvError) throw clvError;

    const resultMap = new Map(
      (results ?? []).map((row: any) => [
        Number(row.observation_id),
        row
      ])
    );
    const clvMap = new Map(
      (clv ?? []).map((row: any) => [
        Number(row.observation_id),
        row
      ])
    );

    const rows = (observations ?? [])
      .map((observation: any) => {
        const result = resultMap.get(Number(observation.id));
        if (!result) return null;

        const close = clvMap.get(Number(observation.id));
        const raw = observation.raw || {};

        return {
          observationId: Number(observation.id),
          modelVersion: observation.model_version,
          eventId: observation.event_id,
          startsAt: observation.starts_at,
          playerName: observation.player_name,
          statId: observation.stat_id,
          side: observation.side,
          line: observation.line,
          outcome: result.outcome,
          actualValue: result.actual_value,
          rawProbability:
            observation.raw_independent_probability,
          contextProbability:
            observation.model_probability,
          marketProbability:
            observation.market_fair_probability,
          dataQuality: observation.data_quality,
          upstreamStatus: observation.status,
          roleState: roleState(raw),
          integrityState: marketIntegrityState(raw),
          roleChangeDetected:
            raw?.roleChangeDetected === true,
          roleStability:
            raw?.roleStability ?? null,
          contextSignal:
            raw?.contextSignal ?? null,
          contextWeight:
            raw?.contextShadowWeight ?? null,
          clvClass:
            close?.clv_classification ?? "NO_CLV",
          lineClv:
            close?.line_clv_units ?? null,
          fairClv:
            close?.fair_probability_clv_pp ?? null,
          sameBookClv:
            close?.same_book_price_clv_pp ?? null,
          closeAgeMinutes:
            close?.close_quote_age_minutes ?? null
        };
      })
      .filter(Boolean);

    const overall = summarize(rows);

    return new Response(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      version: "nba-player-prop-calibration-v1",
      days,
      sport: "NBA",
      productionEligible: false,
      automaticPromotion: false,
      overall,
      byStat: group(rows, (row: any) => row.statId),
      bySide: group(rows, (row: any) => row.side),
      byRoleState: group(rows, (row: any) => row.roleState),
      byMarketIntegrity: group(
        rows,
        (row: any) => row.integrityState
      ),
      byClvClassification: group(
        rows,
        (row: any) => row.clvClass
      ),
      byUpstreamStatus: group(
        rows,
        (row: any) => row.upstreamStatus
      ),
      calibration: {
        raw: calibrationBuckets(rows, "rawProbability"),
        context: calibrationBuckets(
          rows,
          "contextProbability"
        ),
        market: calibrationBuckets(
          rows,
          "marketProbability"
        )
      },
      interpretation: {
        brier:
          "Lower is better. Context improvement is raw Brier minus v1.1 context Brier.",
        pushesAndVoids:
          "PUSH and VOID are counted operationally but excluded from Brier and log-loss scoring.",
        clv:
          "CLV is diagnostic market feedback and is not treated as proof that any individual wager was correct."
      },
      promotionPolicy: {
        automaticPromotion: false,
        minimumDecisiveSampleOverall: 250,
        minimumDecisiveSamplePerStat: 100,
        requireUntouchedHoldout: true,
        requireHistoricalExactMarketValidation: true,
        note:
          "No production-weight change is permitted from this endpoint."
      }
    }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60"
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
