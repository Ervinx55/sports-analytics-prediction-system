import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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


function displayKey(row: any) {
  const equivalentHitMarket =
    Number(row.line) === 0.5 &&
    (row.stat_id === "batting_hits" ||
      row.stat_id === "batting_totalBases");

  return [
    row.event_id,
    row.player_id,
    equivalentHitMarket ? "hit_or_tb_0.5" : row.stat_id,
    row.side,
    String(Number(row.line)),
  ].join("|");
}

function rankStatus(status: string) {
  return status === "PLAY" ? 0 : status === "PENDING" ? 1 : 2;
}

function better(a: any, b: any) {
  const ra = rankStatus(a.status);
  const rb = rankStatus(b.status);
  if (ra !== rb) return ra < rb ? a : b;

  const oa = Number(a.best_odds);
  const ob = Number(b.best_odds);
  if (Number.isFinite(oa) && Number.isFinite(ob) && oa !== ob) {
    return oa > ob ? a : b;
  }

  const ea = Number(a.ev_pct);
  const eb = Number(b.ev_pct);
  if (Number.isFinite(ea) && Number.isFinite(eb) && ea !== eb) {
    return ea > eb ? a : b;
  }

  return Date.parse(a.captured_at || "") >= Date.parse(b.captured_at || "")
    ? a
    : b;
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
    const hours = Math.max(
      4,
      Math.min(48, Number(u.searchParams.get("hours") || 12)),
    );

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const floorStart = new Date(Date.now() - 4 * 3600_000).toISOString();

    const [
      { data: latest, error: latestError },
      { data: results, error: resultsError },
      { data: verification, error: verificationError },
      { data: weather, error: weatherError },
      { data: fusion, error: fusionError },
      { data: clv, error: clvError },
      { data: timing, error: timingError },
    ] = await Promise.all([
        supabase
          .from("player_prop_latest")
          .select("*")
          .eq("sport", "MLB")
          .gte("captured_at", since)
          .gte("starts_at", floorStart)
          .order("starts_at", { ascending: true })
          .limit(3000),
        supabase
          .from("player_prop_results")
          .select("*")
          .order("graded_at", { ascending: false })
          .limit(200),
        supabase
          .from("player_prop_verification_latest")
          .select("*")
          .gte("evaluated_at", since)
          .order("evaluated_at", { ascending: false })
          .limit(3000),
        supabase
          .from("player_prop_weather_latest")
          .select("*")
          .gte("evaluated_at", since)
          .order("evaluated_at", { ascending: false })
          .limit(3000),
        supabase
          .from("player_prop_decision_fusion_latest")
          .select("*")
          .gte("evaluated_at", since)
          .order("evaluated_at", { ascending: false })
          .limit(3000),
        supabase
          .from("player_prop_clv_latest")
          .select("*")
          .order("refreshed_at", { ascending: false })
          .limit(3000),
        supabase
          .from("decision_timing_latest")
          .select("*")
          .eq("sport", "MLB")
          .eq("leg_type", "PROP")
          .order("captured_at", { ascending: false })
          .limit(3000),
      ]);

    if (latestError) throw latestError;
    if (resultsError) throw resultsError;
    if (verificationError) throw verificationError;
    if (weatherError) throw weatherError;
    if (fusionError) throw fusionError;
    if (clvError) throw clvError;
    if (timingError) throw timingError;

    const timingMap = new Map<number, any>(
      (timing ?? []).map((x: any) => [Number(x.observation_id), x]),
    );

    const clvMap = new Map<number, any>(
      (clv ?? []).map((x: any) => [Number(x.observation_id), x]),
    );

    const fusionMap = new Map<number, any>(
      (fusion ?? []).map((x: any) => [Number(x.observation_id), x]),
    );

    const weatherMap = new Map<number, any>(
      (weather ?? []).map((x: any) => [Number(x.observation_id), x]),
    );

    const verificationMap = new Map<number, any>(
      (verification ?? []).map((x: any) => [Number(x.observation_id), x]),
    );

    const dedup = new Map<string, any>();
    for (const row of latest ?? []) {
      const verificationGate =
        verificationMap.get(Number(row.id)) ?? null;
      const weatherParkImpact =
        weatherMap.get(Number(row.id)) ?? null;
      const decisionFusion =
        fusionMap.get(Number(row.id)) ?? null;
      const marketClv =
        clvMap.get(Number(row.id)) ?? null;
      const decisionTiming =
        timingMap.get(Number(row.id)) ?? null;
      const targets = freshnessTargets(row.starts_at);
      const nearGame =
        targets.minutesToStart !== null &&
        targets.minutesToStart <= 90;
      const freshness = buildFreshness(
        row.starts_at,
        [
          componentFreshness(
            "prop_market",
            row.captured_at,
            targets.market,
            40,
            true,
            true,
          ),
          componentFreshness(
            "lineup_role",
            verificationGate?.evaluated_at,
            targets.verification,
            25,
            true,
            nearGame,
          ),
          componentFreshness(
            "weather",
            weatherParkImpact?.evaluated_at,
            targets.weather,
            15,
            true,
            nearGame,
          ),
          componentFreshness(
            "fusion",
            decisionFusion?.evaluated_at ||
              decisionFusion?.source_captured_at,
            targets.fusion,
            10,
            false,
            false,
          ),
          componentFreshness(
            "decision_timing",
            decisionTiming?.captured_at,
            targets.fusion,
            10,
            false,
            false,
          ),
        ],
      );
      const freshnessDecision = applyFreshnessGate(
        row.status,
        row.reason,
        freshness,
        row.starts_at,
      );
      const enriched = {
        ...row,
        status: freshnessDecision.status,
        reason: freshnessDecision.reason,
        freshness: {
          ...freshness,
          action: freshnessDecision.action,
          originalStatus: freshnessDecision.originalStatus,
        },
        verificationGate,
        weatherParkImpact,
        decisionFusion,
        marketClv,
        decisionTiming,
      };
      const key = displayKey(enriched);
      const current = dedup.get(key);
      dedup.set(key, current ? better(current, enriched) : enriched);
    }

    const rows = [...dedup.values()].sort((a, b) => {
      const statusDiff = rankStatus(a.status) - rankStatus(b.status);
      if (statusDiff !== 0) return statusDiff;
      return Number(b.ev_pct ?? -999) - Number(a.ev_pct ?? -999);
    });

    const playRows = rows.filter((x) => x.status === "PLAY");
    const pendingRows = rows.filter((x) => x.status === "PENDING");
    const passRows = rows.filter((x) => x.status === "PASS");

    const resultIds = [...new Set((results ?? []).map((x: any) => x.observation_id))];
    let observationMap = new Map<number, any>();
    if (resultIds.length) {
      const { data: gradedObs, error } = await supabase
        .from("player_prop_observations")
        .select("id,label,player_name,stat_id,best_book,best_odds,model_probability,ev_pct,status,starts_at")
        .in("id", resultIds.slice(0, 500));
      if (error) throw error;
      observationMap = new Map(
        (gradedObs ?? []).map((x: any) => [Number(x.id), x]),
      );
    }

    const recentResults = (results ?? []).map((r: any) => ({
      ...r,
      observation: observationMap.get(Number(r.observation_id)) ?? null,
    }));

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        version: "MLB Player Props Card v2",
        summary: {
          gradedProps: rows.length,
          play: playRows.length,
          pending: pendingRows.length,
          pass: passRows.length,
          auditedRows: latest?.length ?? 0,
          duplicateEquivalentMarketsSuppressed:
            (latest?.length ?? 0) - rows.length,
          postgameResults: recentResults.length,
          verificationGate: {
            ready: rows.filter((x: any) => x.verificationGate?.state === "READY").length,
            watch: rows.filter((x: any) => x.verificationGate?.state === "WATCH").length,
            pending: rows.filter((x: any) => x.verificationGate?.state === "PENDING").length,
            remodel: rows.filter((x: any) => x.verificationGate?.state === "REMODEL").length,
            pass: rows.filter((x: any) => x.verificationGate?.state === "PASS").length,
            shadowOnly: true,
            affectsDecision: false,
          },
          weatherParkImpact: {
            favorable: rows.filter((x: any) => x.weatherParkImpact?.state === "FAVORABLE").length,
            adverse: rows.filter((x: any) => x.weatherParkImpact?.state === "ADVERSE").length,
            neutral: rows.filter((x: any) => x.weatherParkImpact?.state === "NEUTRAL").length,
            weatherRisk: rows.filter((x: any) => x.weatherParkImpact?.state === "WEATHER_RISK").length,
            pending: rows.filter((x: any) => x.weatherParkImpact?.state === "PENDING").length,
            remodel: rows.filter((x: any) => x.weatherParkImpact?.state === "REMODEL").length,
            shadowOnly: true,
            affectsDecision: false,
          },
          decisionFusion: {
            playCandidate: rows.filter((x: any) => x.decisionFusion?.fusion_state === "PLAY_CANDIDATE").length,
            watch: rows.filter((x: any) => x.decisionFusion?.fusion_state === "WATCH").length,
            wait: rows.filter((x: any) => x.decisionFusion?.fusion_state === "WAIT").length,
            remodel: rows.filter((x: any) => x.decisionFusion?.fusion_state === "REMODEL").length,
            pass: rows.filter((x: any) => x.decisionFusion?.fusion_state === "PASS").length,
            shadowOnly: true,
            affectsDecision: false,
          },
          freshness: {
            gradeA: rows.filter((x: any) => x.freshness?.grade === "A").length,
            gradeB: rows.filter((x: any) => x.freshness?.grade === "B").length,
            gradeC: rows.filter((x: any) => x.freshness?.grade === "C").length,
            gradeD: rows.filter((x: any) => x.freshness?.grade === "D").length,
            gradeF: rows.filter((x: any) => x.freshness?.grade === "F").length,
            downgraded: rows.filter((x: any) => x.freshness?.action !== "KEEP").length,
            affectsDecision: true,
          },
          marketClv: {
            tracking: rows.filter((x: any) => x.marketClv?.clv_classification === "TRACKING").length,
            positive: rows.filter((x: any) => String(x.marketClv?.clv_classification || "").startsWith("POSITIVE")).length,
            negative: rows.filter((x: any) => String(x.marketClv?.clv_classification || "").startsWith("NEGATIVE")).length,
            neutral: rows.filter((x: any) => x.marketClv?.clv_classification === "NEUTRAL_CLV").length,
          },
        },
        plays: playRows,
        pending: pendingRows,
        passes: passRows,
        props: rows,
        recentResults,
        note:
          "Hits O/U 0.5 and Total Bases O/U 0.5 are outcome-equivalent; the display keeps only the better qualified price so they are not double-counted.",
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