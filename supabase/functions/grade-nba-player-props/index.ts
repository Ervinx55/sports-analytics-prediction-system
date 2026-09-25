import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  findScheduleGame,
  settleObservation
} from "./nba-player-results.js";

const SCHEDULE_URL =
  "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";

function nbaHeaders() {
  return {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "origin": "https://www.nba.com",
    "referer": "https://www.nba.com/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: nbaHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000)
  });
  const raw = await response.text();
  let body: any;
  try { body = JSON.parse(raw); }
  catch { body = { error: raw.slice(0, 500) }; }
  if (!response.ok) {
    throw new Error(
      `NBA request failed (${response.status}): ${JSON.stringify(body).slice(0, 500)}`
    );
  }
  return body;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" }
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const floor = new Date(Date.now() - 7 * 86400_000).toISOString();
    const cutoff = new Date().toISOString();

    const { data: observations, error: obsError } = await supabase
      .from("player_prop_observations")
      .select("*")
      .eq("sport", "NBA")
      .gte("starts_at", floor)
      .lte("starts_at", cutoff)
      .order("starts_at", { ascending: false })
      .limit(10000);

    if (obsError) throw obsError;

    const ids = (observations ?? []).map((row: any) => Number(row.id));
    const graded = new Set<number>();

    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      if (!batch.length) continue;
      const { data, error } = await supabase
        .from("player_prop_results")
        .select("observation_id")
        .in("observation_id", batch);
      if (error) throw error;
      for (const row of data ?? []) {
        graded.add(Number(row.observation_id));
      }
    }

    const ungraded = (observations ?? []).filter(
      (row: any) => !graded.has(Number(row.id))
    );

    if (!ungraded.length) {
      return new Response(JSON.stringify({
        ok: true,
        version: "nba-player-prop-settlement-v1",
        checkedRows: 0,
        gamesResolved: 0,
        rowsGraded: 0,
        rowsVoided: 0
      }), {
        headers: { "content-type": "application/json" }
      });
    }

    const schedule = await fetchJson(SCHEDULE_URL);
    const byGameId = new Map<string, any[]>();
    let unresolvedSchedule = 0;

    for (const observation of ungraded) {
      const game = findScheduleGame(schedule, observation);
      const gameId = String(game?.gameId || "");
      if (!gameId) {
        unresolvedSchedule += 1;
        continue;
      }
      if (!byGameId.has(gameId)) byGameId.set(gameId, []);
      byGameId.get(gameId)!.push(observation);
    }

    let gamesResolved = 0;
    let rowsGraded = 0;
    let rowsVoided = 0;
    let rowsUnresolved = 0;

    for (const [gameId, rows] of byGameId.entries()) {
      let boxscore: any;
      try {
        boxscore = await fetchJson(
          `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`
        );
      } catch {
        rowsUnresolved += rows.length;
        continue;
      }

      if (Number(boxscore?.game?.gameStatus) !== 3) {
        continue;
      }

      const inserts: any[] = [];

      for (const row of rows) {
        const settlement = settleObservation(row, boxscore);
        if (!settlement.ready) {
          rowsUnresolved += 1;
          continue;
        }

        inserts.push({
          observation_id: row.id,
          sport: "NBA",
          event_id: row.event_id,
          game_pk: null,
          player_id: row.player_id,
          mlb_player_id: null,
          stat_id: row.stat_id,
          line: row.line,
          side: row.side,
          actual_value: settlement.actualValue,
          outcome: settlement.outcome,
          won: settlement.won,
          pushed: settlement.pushed,
          graded_at: new Date().toISOString(),
          raw: {
            evaluatorVersion: "nba-player-prop-settlement-v1",
            nbaGameId: gameId,
            officialGameStatus: boxscore?.game?.gameStatusText ?? "Final",
            personId: settlement.player?.personId ?? null,
            playerName: settlement.player?.name ?? null,
            played: settlement.player?.played ?? null,
            reason: settlement.reason
          }
        });
      }

      if (inserts.length) {
        const { error } = await supabase
          .from("player_prop_results")
          .upsert(inserts, { onConflict: "observation_id" });
        if (error) throw error;
        rowsGraded += inserts.length;
        rowsVoided += inserts.filter((row) => row.outcome === "VOID").length;
      }

      gamesResolved += 1;
    }

    return new Response(JSON.stringify({
      ok: true,
      version: "nba-player-prop-settlement-v1",
      checkedRows: ungraded.length,
      gamesResolved,
      rowsGraded,
      rowsVoided,
      rowsUnresolved,
      unresolvedSchedule,
      resultSource: "NBA Official live-data boxscore"
    }), {
      headers: { "content-type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
});
