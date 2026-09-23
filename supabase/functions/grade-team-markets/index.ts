import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function fetchJson(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 500) }; }
  if (!r.ok) throw new Error(`${r.status} ${url}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

function sameLine(a: unknown, b: unknown) {
  if (a === null || a === undefined || b === null || b === undefined) {
    return a == null && b == null;
  }
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-9;
}

function resolveDecision(obs: any, sharpRows: any[]) {
  if (obs.non_sharp_status === "PLAY") return { status: "PLAY", sharp: null };
  if (obs.non_sharp_status !== "READY_FOR_SHARP_CHECK") {
    return { status: "PASS", sharp: null };
  }

  const startMs = Date.parse(obs.starts_at || "");
  const matching = sharpRows
    .filter((s) => {
      const marketType = s.market_type || "moneyline";
      const marketSide = s.market_side || s.side_key;
      const checkedMs = Date.parse(s.checked_at || "");
      return (
        s.event_id === obs.event_id &&
        marketType === obs.market_type &&
        marketSide === obs.market_side &&
        sameLine(s.market_line, obs.line) &&
        (!Number.isFinite(startMs) || !Number.isFinite(checkedMs) || checkedMs <= startMs)
      );
    })
    .sort((a, b) => Date.parse(b.checked_at || "") - Date.parse(a.checked_at || ""));

  const sharp = matching[0] || null;
  return {
    status: sharp?.final_status === "FINAL_PLAY" ? "PLAY" : "PASS",
    sharp,
  };
}

function gradeMarket(obs: any, awayScore: number, homeScore: number) {
  let actualValue: number | null = null;
  let comparison = 0;

  if (obs.market_type === "moneyline") {
    actualValue = obs.market_side === "away" ? awayScore : homeScore;
    const opponent = obs.market_side === "away" ? homeScore : awayScore;
    comparison = actualValue - opponent;
  } else if (obs.market_type === "spread") {
    const line = Number(obs.line);
    if (!Number.isFinite(line)) return null;
    if (obs.market_side === "away") {
      actualValue = awayScore + line;
      comparison = actualValue - homeScore;
    } else {
      actualValue = homeScore + line;
      comparison = actualValue - awayScore;
    }
  } else if (obs.market_type === "total") {
    const line = Number(obs.line);
    if (!Number.isFinite(line)) return null;
    actualValue = awayScore + homeScore;
    comparison =
      obs.market_side === "over"
        ? actualValue - line
        : line - actualValue;
  } else {
    return null;
  }

  if (Math.abs(comparison) <= 1e-9) {
    return { actualValue, outcome: "PUSH", won: false, pushed: true };
  }
  if (comparison > 0) {
    return { actualValue, outcome: "W", won: true, pushed: false };
  }
  return { actualValue, outcome: "L", won: false, pushed: false };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const floor = new Date(Date.now() - 7 * 86400_000).toISOString();
    const cutoff = new Date().toISOString();

    const { data: observations, error: obsError } = await supabase
      .from("market_grade_observations")
      .select("*")
      .gte("starts_at", floor)
      .lte("starts_at", cutoff)
      .order("starts_at", { ascending: false })
      .limit(10000);
    if (obsError) throw obsError;

    const ids = (observations ?? []).map((x: any) => x.id);
    const already = new Set<number>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await supabase
        .from("team_market_results")
        .select("observation_id")
        .in("observation_id", ids.slice(i, i + 500));
      if (error) throw error;
      for (const row of data ?? []) already.add(Number(row.observation_id));
    }

    const ungraded = (observations ?? []).filter(
      (x: any) => !already.has(Number(x.id)),
    );

    const eventIds = [...new Set(ungraded.map((x: any) => x.event_id).filter(Boolean))];
    let sharpRows: any[] = [];
    for (let i = 0; i < eventIds.length; i += 100) {
      const { data, error } = await supabase
        .from("sharp_gate_history")
        .select("*")
        .in("event_id", eventIds.slice(i, i + 100))
        .order("checked_at", { ascending: false });
      if (error) throw error;
      sharpRows.push(...(data ?? []));
    }

    const byGame = new Map<number, any[]>();
    for (const row of ungraded) {
      const gamePk = Number(row.game_pk);
      if (!Number.isFinite(gamePk)) continue;
      if (!byGame.has(gamePk)) byGame.set(gamePk, []);
      byGame.get(gamePk)!.push(row);
    }

    let gamesFinal = 0;
    let rowsGraded = 0;

    for (const [gamePk, rows] of byGame.entries()) {
      let feed: any;
      try {
        feed = await fetchJson(
          `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
        );
      } catch {
        continue;
      }

      if (feed?.gameData?.status?.abstractGameState !== "Final") continue;

      const awayScore = Number(feed?.liveData?.linescore?.teams?.away?.runs);
      const homeScore = Number(feed?.liveData?.linescore?.teams?.home?.runs);
      if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) continue;

      const inserts: any[] = [];

      for (const obs of rows) {
        const grade = gradeMarket(obs, awayScore, homeScore);
        if (!grade) continue;

        const decision = resolveDecision(obs, sharpRows);
        let passEvaluation: string | null = null;
        if (decision.status === "PASS") {
          passEvaluation =
            grade.outcome === "W"
              ? "MISSED_WIN"
              : grade.outcome === "L"
              ? "GOOD_PASS"
              : "PUSHED_PASS";
        }

        inserts.push({
          observation_id: obs.id,
          event_id: obs.event_id,
          game_pk: obs.game_pk,
          market_type: obs.market_type,
          market_side: obs.market_side,
          market_label: obs.market_label,
          line: obs.line,
          decision_status: decision.status,
          actual_value: grade.actualValue,
          away_score: awayScore,
          home_score: homeScore,
          outcome: grade.outcome,
          won: grade.won,
          pushed: grade.pushed,
          pass_evaluation: passEvaluation,
          graded_at: new Date().toISOString(),
          raw: {
            nonSharpStatus: obs.non_sharp_status,
            sharpGateStatus: decision.sharp?.final_status ?? null,
            sharpCheckedAt: decision.sharp?.checked_at ?? null,
            finalDetailedState: feed?.gameData?.status?.detailedState ?? "Final",
          },
        });
      }

      if (inserts.length) {
        const { error } = await supabase
          .from("team_market_results")
          .upsert(inserts, { onConflict: "observation_id" });
        if (error) throw error;
        rowsGraded += inserts.length;
      }

      gamesFinal++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        checkedRows: ungraded.length,
        gamesFinal,
        rowsGraded,
        monitorMode: "from scheduled start until MLB marks Final",
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