import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function summarize(rows: any[]) {
  const graded = rows.filter((r) => ["W","L","PUSH"].includes(String(r.outcome)));
  const wins = graded.filter((r) => r.outcome === "W").length;
  const losses = graded.filter((r) => r.outcome === "L").length;
  const pushes = graded.filter((r) => r.outcome === "PUSH").length;
  const blocked = graded.filter((r) => ["PASS","REMODEL","PENDING"].includes(String(r.state)));
  return {
    graded: graded.length,
    wins,
    losses,
    pushes,
    winRate: wins + losses ? Number((wins / (wins + losses)).toFixed(4)) : null,
    goodBlocks: blocked.filter((r) => r.outcome === "L").length,
    missedWins: blocked.filter((r) => r.outcome === "W").length,
  };
}

function groupByState(rows: any[]) {
  const states = ["READY","WATCH","PENDING","REMODEL","PASS"];
  return Object.fromEntries(states.map((state) => [
    state,
    summarize(rows.filter((r) => r.state === state)),
  ]));
}

function reasonCounts(rows: any[]) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r.reason_code || "UNKNOWN");
    out[k] = (out[k] || 0) + 1;
  }
  return out;
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
    const days = Math.max(1, Math.min(365, Number(u.searchParams.get("days") || 90)));
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [
      { data: teamGates, error: teamGateError },
      { data: teamResults, error: teamResultError },
      { data: propGates, error: propGateError },
      { data: propResults, error: propResultError },
    ] = await Promise.all([
      supabase.from("team_market_verification_shadow").select("*")
        .gte("evaluated_at", since).limit(5000),
      supabase.from("team_market_results").select("observation_id,outcome,graded_at")
        .gte("graded_at", since).limit(5000),
      supabase.from("player_prop_verification_shadow").select("*")
        .gte("evaluated_at", since).limit(10000),
      supabase.from("player_prop_results").select("observation_id,outcome,graded_at")
        .gte("graded_at", since).limit(10000),
    ]);

    if (teamGateError) throw teamGateError;
    if (teamResultError) throw teamResultError;
    if (propGateError) throw propGateError;
    if (propResultError) throw propResultError;

    const teamResultMap = new Map((teamResults ?? []).map((r:any)=>[Number(r.observation_id),r]));
    const propResultMap = new Map((propResults ?? []).map((r:any)=>[Number(r.observation_id),r]));

    const team = (teamGates ?? []).map((g:any)=>({
      ...g,
      outcome: teamResultMap.get(Number(g.observation_id))?.outcome ?? null,
    }));
    const props = (propGates ?? []).map((g:any)=>({
      ...g,
      outcome: propResultMap.get(Number(g.observation_id))?.outcome ?? null,
    }));

    const pitchers = props.filter((r:any)=>r.player_role === "PITCHER");
    const hitters = props.filter((r:any)=>r.player_role === "HITTER");

    return new Response(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      version: "mlb-verification-gate-v1",
      days,
      shadowOnly: true,
      affectsDecision: false,
      teamMarkets: {
        overall: summarize(team),
        byState: groupByState(team),
        reasonCounts: reasonCounts(team),
        starterChangeAfterModel: team.filter((r:any)=>r.starter_change_after_model).length,
        handednessChangeAfterModel: team.filter((r:any)=>r.handedness_change_after_model).length,
        lineupChangeAfterModel: team.filter((r:any)=>r.lineup_change_after_model).length,
        catcherChangeAfterModel: team.filter((r:any)=>r.catcher_change_after_model).length,
      },
      playerProps: {
        overall: summarize(props),
        byState: groupByState(props),
        reasonCounts: reasonCounts(props),
        pitchers: {
          overall: summarize(pitchers),
          byState: groupByState(pitchers),
          catcherChangesAfterModel: pitchers.filter((r:any)=>r.catcher_change_after_model).length,
        },
        hitters: {
          overall: summarize(hitters),
          byState: groupByState(hitters),
          opposingStarterChangesAfterModel: hitters.filter((r:any)=>r.opposing_starter_change_after_model).length,
          opposingHandednessChangesAfterModel: hitters.filter((r:any)=>r.opposing_handedness_change_after_model).length,
        },
      },
    }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : JSON.stringify(error),
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});