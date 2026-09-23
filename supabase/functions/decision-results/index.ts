import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function record(rows: any[]) {
  return {
    wins: rows.filter((x) => x.outcome === "W").length,
    losses: rows.filter((x) => x.outcome === "L").length,
    pushes: rows.filter((x) => x.outcome === "PUSH").length,
  };
}

function passSummary(rows: any[]) {
  return {
    goodPasses: rows.filter((x) => x.passEvaluation === "GOOD_PASS").length,
    missedWins: rows.filter((x) => x.passEvaluation === "MISSED_WIN").length,
    pushedPasses: rows.filter((x) => x.passEvaluation === "PUSHED_PASS").length,
    hardPassWouldLose: rows.filter((x) => x.passEvaluation === "HARD_PASS_LOSS").length,
    hardPassWouldWin: rows.filter((x) => x.passEvaluation === "HARD_PASS_WIN").length,
    hardPassPushes: rows.filter((x) => x.passEvaluation === "HARD_PASS_PUSH").length,
  };
}

function isTeamCandidatePass(x: any) {
  if (x.decision_status !== "PASS") return false;

  if (
    x.non_sharp_status === "READY_FOR_SHARP_CHECK" ||
    x.non_sharp_status === "PENDING"
  ) {
    return true;
  }

  const rawDecision = String(x.raw?.decision || "");
  if (rawDecision.endsWith("_CANDIDATE")) return true;

  const edge = n(x.edge_pct_points);
  const ev = n(x.ev_pct);

  if (x.market_type === "moneyline") {
    return (edge ?? -999) >= 1.2 && (ev ?? -999) >= 1.0;
  }

  if (x.market_type === "spread") {
    return (edge ?? -999) >= 1.5 && (ev ?? -999) >= 1.0;
  }

  if (x.market_type === "total") {
    const diff = Math.abs(n(x.raw?.differenceRuns) ?? 0);
    const split = Boolean(x.raw?.marketSplit);
    return !split && diff >= 0.35 && (ev ?? -999) >= 1.0;
  }

  return false;
}

function teamPassEvaluation(x: any) {
  const candidate = isTeamCandidatePass(x);
  if (candidate) {
    if (x.outcome === "W") return "MISSED_WIN";
    if (x.outcome === "L") return "GOOD_PASS";
    return "PUSHED_PASS";
  }

  if (x.outcome === "W") return "HARD_PASS_WIN";
  if (x.outcome === "L") return "HARD_PASS_LOSS";
  return "HARD_PASS_PUSH";
}

function equivalentPropKey(x: any) {
  const line = n(x.line);
  const equivalentHalfHit =
    line !== null &&
    Math.abs(line - 0.5) <= 1e-9 &&
    (x.stat_id === "batting_hits" || x.stat_id === "batting_totalBases");

  const statKey = equivalentHalfHit ? "reached_base_by_hit" : x.stat_id;

  return [
    x.event_id ?? "",
    x.player_id ?? "",
    statKey ?? "",
    x.side ?? "",
    line === null ? "" : String(line),
  ].join("|");
}

function propStatusRank(status: string) {
  return status === "PLAY" ? 0 : status === "PENDING" ? 1 : 2;
}

function betterProp(a: any, b: any) {
  const ra = propStatusRank(a.status);
  const rb = propStatusRank(b.status);
  if (ra !== rb) return ra < rb ? a : b;

  const oa = n(a.best_odds);
  const ob = n(b.best_odds);
  if (oa !== null && ob !== null && oa !== ob) return oa > ob ? a : b;

  const ea = n(a.ev_pct);
  const eb = n(b.ev_pct);
  if (ea !== null && eb !== null && ea !== eb) return ea > eb ? a : b;

  return Date.parse(a.captured_at || "") >= Date.parse(b.captured_at || "")
    ? a
    : b;
}

function dedupProps(rows: any[]) {
  const map = new Map<string, any>();
  for (const row of rows) {
    const key = equivalentPropKey(row);
    const current = map.get(key);
    map.set(key, current ? betterProp(current, row) : row);
  }
  return [...map.values()];
}

function isPropCandidatePass(x: any) {
  if (x.status !== "PASS") return false;

  const dq = n(x.data_quality);
  const exact = n(x.exact_line_book_count);
  const paired = n(x.paired_books);
  const edge = n(x.edge_pct_points);
  const ev = n(x.ev_pct);

  const verifiedMarket =
    (dq ?? 0) >= 0.75 &&
    (exact ?? 0) >= 2 &&
    (paired ?? 0) >= 1 &&
    x.market_fair_probability !== null;

  if (!verifiedMarket) return false;

  return (edge ?? -999) >= 3.0 || (ev ?? -999) >= 3.0;
}

function propPassEvaluation(x: any) {
  const candidate = isPropCandidatePass(x);
  if (candidate) {
    if (x.outcome === "W") return "MISSED_WIN";
    if (x.outcome === "L") return "GOOD_PASS";
    return "PUSHED_PASS";
  }

  if (x.outcome === "W") return "HARD_PASS_WIN";
  if (x.outcome === "L") return "HARD_PASS_LOSS";
  return "HARD_PASS_PUSH";
}

function resultLabel(decisionStatus: string, passEvaluation: string | null, outcome: string) {
  if (decisionStatus === "PLAY") return outcome;

  const labels: Record<string, string> = {
    GOOD_PASS: "GOOD PASS",
    MISSED_WIN: "MISSED WIN",
    PUSHED_PASS: "PUSHED PASS",
    HARD_PASS_WIN: "HARD PASS — WOULD WIN",
    HARD_PASS_LOSS: "HARD PASS — WOULD LOSE",
    HARD_PASS_PUSH: "HARD PASS — PUSH",
  };
  return labels[passEvaluation || ""] || "PASS";
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
    const days = Math.max(
      1,
      Math.min(30, Number(u.searchParams.get("days") || 7)),
    );
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [teamResult, propResult, attributionResult] = await Promise.all([
      supabase
        .from("team_market_latest_results")
        .select("*")
        .gte("starts_at", since)
        .order("starts_at", { ascending: false })
        .limit(1500),
      supabase
        .from("player_prop_latest_results")
        .select("*")
        .gte("starts_at", since)
        .order("starts_at", { ascending: false })
        .limit(3000),
      supabase
        .from("decision_outcome_attribution")
        .select("*")
        .gte("evaluated_at", since)
        .order("evaluated_at", { ascending: false })
        .limit(5000),
    ]);

    if (teamResult.error) throw teamResult.error;
    if (propResult.error) throw propResult.error;
    if (attributionResult.error) throw attributionResult.error;

    const attributionMap = new Map<string, any>();
    for (const a of attributionResult.data ?? []) {
      attributionMap.set(String(a.leg_type) + ":" + String(a.observation_id), a);
    }

    const team = (teamResult.data ?? []).map((x: any) => {
      const decisionStatus = x.decision_status;
      const passEvaluation =
        decisionStatus === "PASS" ? teamPassEvaluation(x) : null;

      return {
        ...x,
        decisionStatus,
        passEvaluation,
        passClass:
          decisionStatus === "PASS"
            ? isTeamCandidatePass(x)
              ? "CANDIDATE_PASS"
              : "HARD_PASS"
            : null,
        resultLabel: resultLabel(
          decisionStatus,
          passEvaluation,
          x.outcome,
        ),
        attribution: attributionMap.get("TEAM:" + String(x.observation_id)) ?? null,
      };
    });

    const dedupedPropRows = dedupProps(propResult.data ?? []);
    const props = dedupedPropRows.map((x: any) => {
      const decisionStatus = x.status === "PLAY" ? "PLAY" : "PASS";
      const passEvaluation =
        decisionStatus === "PASS" ? propPassEvaluation(x) : null;

      return {
        ...x,
        decisionStatus,
        passEvaluation,
        passClass:
          decisionStatus === "PASS"
            ? isPropCandidatePass(x)
              ? "CANDIDATE_PASS"
              : "HARD_PASS"
            : null,
        resultLabel: resultLabel(
          decisionStatus,
          passEvaluation,
          x.outcome,
        ),
        attribution: attributionMap.get("PROP:" + String(x.observation_id)) ?? null,
      };
    });

    const teamPlays = team.filter((x: any) => x.decisionStatus === "PLAY");
    const teamPasses = team.filter((x: any) => x.decisionStatus === "PASS");
    const propPlays = props.filter((x: any) => x.decisionStatus === "PLAY");
    const propPasses = props.filter((x: any) => x.decisionStatus === "PASS");

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        days,
        summary: {
          team: {
            total: team.length,
            plays: teamPlays.length,
            passes: teamPasses.length,
            playRecord: record(teamPlays),
            passRecord: passSummary(teamPasses),
          },
          props: {
            total: props.length,
            plays: propPlays.length,
            passes: propPasses.length,
            rawBeforeEquivalentDedup: propResult.data?.length ?? 0,
            equivalentRowsSuppressed:
              (propResult.data?.length ?? 0) - props.length,
            playRecord: record(propPlays),
            passRecord: passSummary(propPasses),
          },
        },
        attributionSummary: {
          byPrimary: (attributionResult.data ?? []).reduce((acc: Record<string, number>, x: any) => {
            const key = String(x.primary_attribution || "UNKNOWN");
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {}),
          byProcessGrade: (attributionResult.data ?? []).reduce((acc: Record<string, number>, x: any) => {
            const key = String(x.process_grade || "UNKNOWN");
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {}),
        },
        team,
        props,
        note:
          "GOOD PASS/MISSED WIN are reserved for wagers that were genuine near-candidates but failed a gate. HARD PASS outcomes are still tracked, but are not counted as missed opportunities. Hits 0.5 and Total Bases 0.5 are deduplicated because they are outcome-equivalent.",
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