import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function keyOf(row: any) {
  const line =
    row.market_line ?? row.line ?? null;
  const lineKey =
    line === null || line === undefined ? "" : String(Number(line));
  return [
    row.event_id ?? "",
    row.market_type ?? "moneyline",
    row.market_side ?? row.side_key ?? "",
    lineKey,
  ].join("|");
}

function inFinalWindow(startsAt: string | null, minutes = 20) {
  const t = Date.parse(startsAt || "");
  if (!Number.isFinite(t)) return false;
  return t - Date.now() <= minutes * 60_000;
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
    const hours = Math.max(
      6,
      Math.min(48, Number(u.searchParams.get("hours") || 12)),
    );

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const [gradesResult, sharpResult, uncertaintyResult, priceResult, verificationResult, weatherResult, disagreementResult, fusionResult, timingResult] = await Promise.all([
      supabase
        .from("market_grade_latest")
        .select("*")
        .eq("sport", sport)
        .gte("captured_at", since)
        .order("starts_at", { ascending: true }),
      supabase
        .from("sharp_gate_latest")
        .select("*")
        .eq("sport", sport)
        .gte("checked_at", since)
        .order("checked_at", { ascending: false }),
      supabase
        .from("market_uncertainty_latest")
        .select("*")
        .eq("sport", sport)
        .gte("source_captured_at", since)
        .order("source_captured_at", { ascending: false }),
      supabase
        .from("market_price_sensitivity_latest")
        .select("*")
        .eq("sport", sport)
        .in("policy_id", ["ML_BALANCED","RL_BALANCED","TOT_BALANCED"])
        .gte("source_captured_at", since)
        .order("source_captured_at", { ascending: false }),
      supabase
        .from("team_market_verification_latest")
        .select("*")
        .gte("evaluated_at", since)
        .order("evaluated_at", { ascending: false }),
      supabase
        .from("team_market_weather_latest")
        .select("*")
        .gte("evaluated_at", since)
        .order("evaluated_at", { ascending: false }),
      supabase
        .from("sharp_disagreement_latest")
        .select("*")
        .gte("evaluated_at", since)
        .order("evaluated_at", { ascending: false }),
      supabase
        .from("market_decision_fusion_latest")
        .select("*")
        .eq("sport", sport)
        .gte("source_captured_at", since)
        .order("evaluated_at", { ascending: false }),
      supabase
        .from("decision_timing_latest")
        .select("*")
        .eq("sport", sport)
        .eq("leg_type", "TEAM")
        .order("captured_at", { ascending: false }),
    ]);

    if (gradesResult.error) throw gradesResult.error;
    if (sharpResult.error) throw sharpResult.error;
    if (uncertaintyResult.error) throw uncertaintyResult.error;
    if (priceResult.error) throw priceResult.error;
    if (verificationResult.error) throw verificationResult.error;
    if (weatherResult.error) throw weatherResult.error;
    if (disagreementResult.error) throw disagreementResult.error;
    if (fusionResult.error) throw fusionResult.error;
    if (timingResult.error) throw timingResult.error;

    const timingMap = new Map<number, any>();
    for (const x of timingResult.data ?? []) {
      timingMap.set(Number(x.observation_id), x);
    }

    const fusionMap = new Map<number, any>();
    for (const x of fusionResult.data ?? []) {
      fusionMap.set(Number(x.observation_id), x);
    }

    const uncertaintyMap = new Map<number, any>();
    for (const x of uncertaintyResult.data ?? []) {
      uncertaintyMap.set(Number(x.observation_id), x);
    }

    const weatherMap = new Map<number, any>();
    for (const x of weatherResult.data ?? []) {
      weatherMap.set(Number(x.observation_id), x);
    }

    const verificationMap = new Map<number, any>();
    for (const x of verificationResult.data ?? []) {
      verificationMap.set(Number(x.observation_id), x);
    }

    const priceMap = new Map<number, any>();
    for (const x of priceResult.data ?? []) {
      priceMap.set(Number(x.observation_id), x);
    }

    const disagreementMap = new Map<number, any>();
    for (const x of disagreementResult.data ?? []) {
      disagreementMap.set(Number(x.sharp_gate_id), x);
    }

    const sharpMap = new Map<string, any>();
    for (const s of sharpResult.data ?? []) {
      sharpMap.set(keyOf(s), s);
    }

    const markets = (gradesResult.data ?? []).map((g: any) => {
      const sharp = sharpMap.get(keyOf(g)) ?? null;
      let status = "PASS";
      let reason = g.reason || "";
      let resolutionSource = "non_sharp";

      if (g.non_sharp_status === "PASS") {
        status = "PASS";
      } else if (g.non_sharp_status === "PENDING") {
        status = inFinalWindow(g.starts_at) ? "PASS" : "PENDING";
        if (status === "PASS") {
          reason =
            reason ||
            "Required information was still unavailable in the final pregame window.";
        }
      } else if (g.non_sharp_status === "READY_FOR_SHARP_CHECK") {
        const sharpFresh =
          sharp &&
          Date.parse(sharp.checked_at || "") >=
            Date.parse(g.captured_at || "") - 2 * 60_000;

        if (sharpFresh && sharp.final_status === "FINAL_PLAY") {
          status = "PLAY";
          reason = sharp.reason || "Cleared the complete sharp gate.";
          resolutionSource = "sharp_gate";
        } else if (sharpFresh && sharp.final_status === "PASS") {
          status = "PASS";
          reason = sharp.reason || "Failed the final sharp gate.";
          resolutionSource = "sharp_gate";
        } else if (inFinalWindow(g.starts_at)) {
          status = "PASS";
          reason =
            sharp?.reason ||
            "Sharp confirmation was not completed before the final pregame deadline.";
          resolutionSource = "deadline";
        } else {
          status = "PENDING";
          reason =
            sharp?.reason ||
            "All model/context checks passed; waiting for final sharp confirmation.";
          resolutionSource = sharp ? "sharp_gate_pending" : "awaiting_sharp";
        }
      }

      return {
        ...g,
        status,
        reason,
        resolutionSource,
        sharpGate: sharp,
        sharpDisagreement: sharp ? disagreementMap.get(Number(sharp.id)) ?? null : null,
        uncertainty: uncertaintyMap.get(Number(g.id)) ?? null,
        priceSensitivity: priceMap.get(Number(g.id)) ?? null,
        verificationGate: verificationMap.get(Number(g.id)) ?? null,
        weatherParkImpact: weatherMap.get(Number(g.id)) ?? null,
        decisionFusion: fusionMap.get(Number(g.id)) ?? null,
        decisionTiming: timingMap.get(Number(g.id)) ?? null,
      };
    });

    const active = markets.filter((m: any) => {
      const t = Date.parse(m.starts_at || "");
      return !Number.isFinite(t) || t > Date.now() - 4 * 3600_000;
    });

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        sport,
        finalWindowMinutes: 20,
        summary: {
          markets: active.length,
          play: active.filter((x: any) => x.status === "PLAY").length,
          pending: active.filter((x: any) => x.status === "PENDING").length,
          pass: active.filter((x: any) => x.status === "PASS").length,
          moneyline: active.filter((x: any) => x.market_type === "moneyline").length,
          total: active.filter((x: any) => x.market_type === "total").length,
          spread: active.filter((x: any) => x.market_type === "spread").length,
          uncertainty: {
            robust: active.filter((x: any) => x.uncertainty?.classification === "ROBUST").length,
            marginal: active.filter((x: any) => x.uncertainty?.classification === "MARGINAL").length,
            fragile: active.filter((x: any) => x.uncertainty?.classification === "FRAGILE").length,
            incomplete: active.filter((x: any) => x.uncertainty?.classification === "INCOMPLETE").length,
            shadowOnly: true,
            affectsDecision: false,
          },
          priceSensitivity: {
            buy: active.filter((x: any) => x.priceSensitivity?.state === "BUY").length,
            hold: active.filter((x: any) => x.priceSensitivity?.state === "HOLD").length,
            pass: active.filter((x: any) => x.priceSensitivity?.state === "PASS").length,
            pending: active.filter((x: any) => x.priceSensitivity?.state === "PENDING").length,
            shadowOnly: true,
            affectsDecision: false,
          },
          verificationGate: {
            ready: active.filter((x: any) => x.verificationGate?.state === "READY").length,
            pending: active.filter((x: any) => x.verificationGate?.state === "PENDING").length,
            remodel: active.filter((x: any) => x.verificationGate?.state === "REMODEL").length,
            pass: active.filter((x: any) => x.verificationGate?.state === "PASS").length,
            shadowOnly: true,
            affectsDecision: false,
          },
          weatherParkImpact: {
            ready: active.filter((x: any) => x.weatherParkImpact?.state === "READY").length,
            weatherRisk: active.filter((x: any) => x.weatherParkImpact?.state === "WEATHER_RISK").length,
            pending: active.filter((x: any) => x.weatherParkImpact?.state === "PENDING").length,
            remodel: active.filter((x: any) => x.weatherParkImpact?.state === "REMODEL").length,
            shadowOnly: true,
            affectsDecision: false,
          },
          sharpDisagreement: {
            consensusOk: active.filter((x: any) => x.sharpDisagreement?.classification === "CONSENSUS_OK").length,
            stalePrice: active.filter((x: any) => x.sharpDisagreement?.classification === "STALE_PRICE").length,
            marketMoving: active.filter((x: any) => x.sharpDisagreement?.classification === "MARKET_MOVING").length,
            realDisagreement: active.filter((x: any) => x.sharpDisagreement?.classification === "REAL_SHARP_DISAGREEMENT").length,
            sourceQuality: active.filter((x: any) => x.sharpDisagreement?.classification === "SOURCE_QUALITY_PROBLEM").length,
            insufficientSources: active.filter((x: any) => x.sharpDisagreement?.classification === "INSUFFICIENT_SOURCES").length,
            watch: active.filter((x: any) => x.sharpDisagreement?.classification === "DISAGREEMENT_WATCH").length,
            shadowOnly: true,
            affectsDecision: false,
          },
          decisionFusion: {
            playCandidate: active.filter((x: any) => x.decisionFusion?.fusion_state === "PLAY_CANDIDATE").length,
            watch: active.filter((x: any) => x.decisionFusion?.fusion_state === "WATCH").length,
            wait: active.filter((x: any) => x.decisionFusion?.fusion_state === "WAIT").length,
            holdPrice: active.filter((x: any) => x.decisionFusion?.fusion_state === "HOLD_PRICE").length,
            remodel: active.filter((x: any) => x.decisionFusion?.fusion_state === "REMODEL").length,
            pass: active.filter((x: any) => x.decisionFusion?.fusion_state === "PASS").length,
            shadowOnly: true,
            affectsDecision: false,
          },
        },
        markets: active,
        plays: active.filter((x: any) => x.status === "PLAY"),
        pending: active.filter((x: any) => x.status === "PENDING"),
        passes: active.filter((x: any) => x.status === "PASS"),
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