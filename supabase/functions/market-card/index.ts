import {serviceAuthorized,reconcilePublications} from '../_shared/performance-mlb-adapter.mjs';
import {evaluateTeamCard} from '../_shared/performance-mlb-qualification.mjs';
import { sharpQuoteTimestamp } from "../_shared/sharp-quote-age.mjs";
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

Deno.serve(async (req) => {
  try {
    if (!["GET","POST"].includes(req.method)) {
      return new Response(JSON.stringify({ error: "GET or authenticated POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const publishing=req.method === 'POST';
    const publicationEnabled=Deno.env.get('PERFORMANCE_MLB_PUBLICATION_ENABLED') === 'true';
    if(publishing && !serviceAuthorized(req.headers.get('authorization'),Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))) return new Response(JSON.stringify({error:'Service authentication required'}),{status:401,headers:{'content-type':'application/json'}});
    if(publishing && !publicationEnabled) return new Response(JSON.stringify({error:'MLB publication disabled'}),{status:503,headers:{'content-type':'application/json'}});
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
      return evaluateTeamCard(g, {
        sharp: sharpMap.get(keyOf(g)) ?? null,
        verification: verificationMap.get(Number(g.id)) ?? null,
        weather: weatherMap.get(Number(g.id)) ?? null,
        fusion: fusionMap.get(Number(g.id)) ?? null,
        timing: timingMap.get(Number(g.id)) ?? null,
        sharpDisagreement: disagreementMap.get(Number(sharpMap.get(keyOf(g))?.id)) ?? null,
        uncertainty: uncertaintyMap.get(Number(g.id)) ?? null,
        priceSensitivity: priceMap.get(Number(g.id)) ?? null,
      });
    });

    let active = markets.filter((m: any) => {
      const t = Date.parse(m.starts_at || "");
      return !Number.isFinite(t) || t > Date.now() - 4 * 3600_000;
    });

    let publicationFaults:any[]=[];
    if(publicationEnabled && sport === 'MLB') {
      const result=await reconcilePublications(supabase,active,'market_grade_observations',{publish:publishing});
      active=result.rows;publicationFaults=result.faults;
    }
    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        sport,
        publication:{enabled:publicationEnabled,faults:publicationFaults},
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
          freshness: {
            gradeA: active.filter((x: any) => x.freshness?.grade === "A").length,
            gradeB: active.filter((x: any) => x.freshness?.grade === "B").length,
            gradeC: active.filter((x: any) => x.freshness?.grade === "C").length,
            gradeD: active.filter((x: any) => x.freshness?.grade === "D").length,
            gradeF: active.filter((x: any) => x.freshness?.grade === "F").length,
            downgraded: active.filter((x: any) => x.freshness?.action !== "KEEP").length,
            affectsDecision: true,
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
          "cache-control": publishing || publicationEnabled ? "no-store" : "public, max-age=20",
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