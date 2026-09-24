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

function freshnessTargets(startsAt: string | null) {
  const t = Date.parse(startsAt || "");
  const minutesToStart = Number.isFinite(t)
    ? (t - Date.now()) / 60000
    : null;

  if (minutesToStart !== null && minutesToStart <= 20) {
    return { minutesToStart, market: 2, sharp: 3, verification: 5, weather: 10, fusion: 5 };
  }
  if (minutesToStart !== null && minutesToStart <= 90) {
    return { minutesToStart, market: 5, sharp: 5, verification: 10, weather: 15, fusion: 10 };
  }
  if (minutesToStart !== null && minutesToStart <= 360) {
    return { minutesToStart, market: 15, sharp: 15, verification: 30, weather: 45, fusion: 30 };
  }
  return { minutesToStart, market: 30, sharp: 30, verification: 60, weather: 90, fusion: 60 };
}

function timestampAgeMinutes(value: unknown) {
  const t = Date.parse(String(value || ""));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 60000);
}

function componentFreshness(
  name: string,
  timestamp: unknown,
  targetMinutes: number,
  weight: number,
  required: boolean,
  hardRequired: boolean,
) {
  const ageMinutes = timestampAgeMinutes(timestamp);
  let score = 100;

  if (ageMinutes === null) {
    score = required ? 0 : 100;
  } else if (ageMinutes <= targetMinutes * 0.5) {
    score = 100;
  } else if (ageMinutes <= targetMinutes) {
    score = 100 - ((ageMinutes / targetMinutes - 0.5) * 60);
  } else if (ageMinutes <= targetMinutes * 2) {
    score = 70 - ((ageMinutes / targetMinutes - 1) * 40);
  } else {
    score = 0;
  }

  return {
    name,
    timestamp: timestamp || null,
    ageMinutes:
      ageMinutes === null ? null : Number(ageMinutes.toFixed(1)),
    targetMinutes,
    score: Number(Math.max(0, Math.min(100, score)).toFixed(1)),
    weight,
    required,
    hardStale:
      hardRequired &&
      (ageMinutes === null || ageMinutes > targetMinutes * 2),
  };
}

function gradeForScore(score: number) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

function buildFreshness(
  startsAt: string | null,
  components: any[],
) {
  const included = components.filter(
    (x) => x.required || x.timestamp,
  );
  const weight = included.reduce(
    (sum, x) => sum + Number(x.weight || 0),
    0,
  );
  const score = weight > 0
    ? included.reduce(
        (sum, x) => sum + Number(x.score || 0) * Number(x.weight || 0),
        0,
      ) / weight
    : 0;
  const hardStale = included.filter((x) => x.hardStale);
  const staleComponents = included
    .filter(
      (x) =>
        x.ageMinutes === null ||
        Number(x.ageMinutes) > Number(x.targetMinutes),
    )
    .map((x) => x.name);

  return {
    score: Number(score.toFixed(1)),
    grade: gradeForScore(score),
    hardStale: hardStale.length > 0,
    hardStaleComponents: hardStale.map((x) => x.name),
    staleComponents,
    components,
    startsAt,
  };
}

function applyFreshnessGate(
  status: string,
  reason: string,
  freshness: any,
  startsAt: string | null,
) {
  const originalStatus = status;
  const finalWindow = inFinalWindow(startsAt);
  let next = status;
  let action = "KEEP";

  if (status === "PLAY") {
    if (freshness.hardStale || freshness.score < 50) {
      next = "PASS";
      action = "PASS_STALE";
    } else if (freshness.score < 80) {
      next = finalWindow ? "PASS" : "PENDING";
      action = finalWindow ? "PASS_STALE" : "DOWNGRADE_PENDING";
    }
  } else if (
    status === "PENDING" &&
    finalWindow &&
    (freshness.hardStale || freshness.score < 80)
  ) {
    next = "PASS";
    action = "PASS_STALE";
  }

  const staleText = freshness.staleComponents.length
    ? " Stale/aging: " + freshness.staleComponents.join(", ") + "."
    : "";
  const gateText =
    action === "KEEP"
      ? ""
      : " Freshness gate changed " +
        originalStatus +
        " to " +
        next +
        " (grade " +
        freshness.grade +
        ", " +
        freshness.score +
        "/100)." +
        staleText;

  return {
    status: next,
    reason: (String(reason || "") + gateText).trim(),
    action,
    originalStatus,
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

      const verification = verificationMap.get(Number(g.id)) ?? null;
      const weather = weatherMap.get(Number(g.id)) ?? null;
      const fusion = fusionMap.get(Number(g.id)) ?? null;
      const timing = timingMap.get(Number(g.id)) ?? null;
      const targets = freshnessTargets(g.starts_at);
      const nearGame =
        targets.minutesToStart !== null &&
        targets.minutesToStart <= 90;
      const sharpRequired =
        status === "PLAY" ||
        g.non_sharp_status === "READY_FOR_SHARP_CHECK";
      const freshness = buildFreshness(
        g.starts_at,
        [
          componentFreshness(
            "market",
            g.captured_at,
            targets.market,
            35,
            true,
            true,
          ),
          componentFreshness(
            "sharp",
            sharp?.checked_at,
            targets.sharp,
            25,
            sharpRequired,
            sharpRequired,
          ),
          componentFreshness(
            "lineup",
            verification?.evaluated_at,
            targets.verification,
            20,
            true,
            nearGame,
          ),
          componentFreshness(
            "weather",
            weather?.evaluated_at,
            targets.weather,
            15,
            true,
            nearGame,
          ),
          componentFreshness(
            "fusion",
            fusion?.evaluated_at || fusion?.source_captured_at,
            targets.fusion,
            5,
            false,
            false,
          ),
        ],
      );
      const freshnessDecision = applyFreshnessGate(
        status,
        reason,
        freshness,
        g.starts_at,
      );
      status = freshnessDecision.status;
      reason = freshnessDecision.reason;
      if (freshnessDecision.action !== "KEEP") {
        resolutionSource = "freshness_gate";
      }

      return {
        ...g,
        status,
        reason,
        resolutionSource,
        freshness: {
          ...freshness,
          action: freshnessDecision.action,
          originalStatus: freshnessDecision.originalStatus,
        },
        sharpGate: sharp,
        sharpDisagreement: sharp ? disagreementMap.get(Number(sharp.id)) ?? null : null,
        uncertainty: uncertaintyMap.get(Number(g.id)) ?? null,
        priceSensitivity: priceMap.get(Number(g.id)) ?? null,
        verificationGate: verification,
        weatherParkImpact: weather,
        decisionFusion: fusion,
        decisionTiming: timing,
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