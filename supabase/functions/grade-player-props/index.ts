import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function fetchJson(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); }
  catch { body = { error: text.slice(0, 500) }; }
  if (!r.ok) throw new Error(`${r.status} ${url}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function actualStat(feed: any, playerId: number, statId: string): number | null {
  for (const side of ["away", "home"]) {
    const p = feed?.liveData?.boxscore?.teams?.[side]?.players?.[`ID${playerId}`];
    if (!p) continue;
    if (statId === "pitching_strikeouts") {
      return num(p?.stats?.pitching?.strikeOuts);
    }
    if (statId === "batting_hits") {
      return num(p?.stats?.batting?.hits);
    }
    if (statId === "batting_totalBases") {
      return num(p?.stats?.batting?.totalBases);
    }
  }
  return null;
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
      .from("player_prop_observations")
      .select("*")
      .gte("starts_at", floor)
      .lte("starts_at", cutoff)
      .order("starts_at", { ascending: false })
      .limit(5000);

    if (obsError) throw obsError;

    const ids = (observations ?? []).map((x: any) => x.id);
    const graded = new Set<number>();

    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await supabase
        .from("player_prop_results")
        .select("observation_id")
        .in("observation_id", ids.slice(i, i + 500));
      if (error) throw error;
      for (const row of data ?? []) graded.add(Number(row.observation_id));
    }

    const ungraded = (observations ?? []).filter(
      (x: any) => !graded.has(Number(x.id)),
    );

    const byGame = new Map<number, any[]>();
    for (const row of ungraded) {
      const gamePk = Number(row.game_pk);
      if (!Number.isFinite(gamePk)) continue;
      if (!byGame.has(gamePk)) byGame.set(gamePk, []);
      byGame.get(gamePk)!.push(row);
    }

    let gamesGraded = 0;
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

      const inserts = [];
      for (const row of rows) {
        const actual = actualStat(
          feed,
          Number(row.mlb_player_id),
          row.stat_id,
        );
        if (actual === null) continue;

        const line = Number(row.line);
        let outcome = "L";
        let won = false;
        let pushed = false;

        if (Math.abs(actual - line) <= 1e-9) {
          outcome = "PUSH";
          pushed = true;
        } else if (
          (row.side === "over" && actual > line) ||
          (row.side === "under" && actual < line)
        ) {
          outcome = "W";
          won = true;
        }

        inserts.push({
          observation_id: row.id,
          event_id: row.event_id,
          game_pk: row.game_pk,
          player_id: row.player_id,
          mlb_player_id: row.mlb_player_id,
          stat_id: row.stat_id,
          line: row.line,
          side: row.side,
          actual_value: actual,
          outcome,
          won,
          pushed,
          graded_at: new Date().toISOString(),
          raw: {
            finalStatus: feed?.gameData?.status?.detailedState ?? "Final",
          },
        });
      }

      if (inserts.length) {
        const { error } = await supabase
          .from("player_prop_results")
          .upsert(inserts, { onConflict: "observation_id" });
        if (error) throw error;
        rowsGraded += inserts.length;
      }

      gamesGraded++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        checkedRows: ungraded.length,
        gamesGraded,
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