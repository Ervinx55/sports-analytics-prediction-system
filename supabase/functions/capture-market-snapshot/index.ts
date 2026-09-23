import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOARD_URL = "https://sports-analytics-prediction-system-tau.vercel.app/api/board";
const DEFAULT_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const leagues = Array.isArray(body.leagues) && body.leagues.length
      ? body.leagues.map(String)
      : ["MLB"];
    const books = Array.isArray(body.books) && body.books.length
      ? body.books.map(String)
      : DEFAULT_BOOKS;
    const label = body.label ? String(body.label) : "scheduled";
    const startsAfter = body.startsAfter ? String(body.startsAfter) : "";
    const startsBefore = body.startsBefore ? String(body.startsBefore) : "";

    const params = new URLSearchParams({
      leagues: leagues.join(","),
      books: books.join(","),
      limit: "100",
    });
    if (startsAfter) params.set("startsAfter", startsAfter);
    if (startsBefore) params.set("startsBefore", startsBefore);

    const boardResponse = await fetch(`${BOARD_URL}?${params.toString()}`, {
      headers: { accept: "application/json" },
    });
    const board = await boardResponse.json();

    if (!boardResponse.ok) {
      throw new Error(`Board fetch failed: ${boardResponse.status} ${JSON.stringify(board).slice(0, 500)}`);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    const { data: run, error: runError } = await supabase
      .from("market_snapshot_runs")
      .insert({
        snapshot_label: label,
        requested_leagues: leagues,
        event_count: board.eventCount ?? board.events?.length ?? 0,
        row_count: 0,
        status: "running",
      })
      .select("id,captured_at")
      .single();

    if (runError) throw runError;

    const rows: Record<string, unknown>[] = [];
    const marketDefs = [
      ["moneyline", "away"],
      ["moneyline", "home"],
      ["spread", "away"],
      ["spread", "home"],
      ["total", "over"],
      ["total", "under"],
      ["threeWay", "away"],
      ["threeWay", "draw"],
      ["threeWay", "home"],
    ];

    for (const event of board.events ?? []) {
      for (const [market, side] of marketDefs) {
        const marketObj = event?.markets?.[market]?.[side];
        if (!marketObj) continue;

        for (const [book, bookData] of Object.entries(marketObj.books ?? {})) {
          const b = bookData as Record<string, unknown>;
          rows.push({
            run_id: run.id,
            captured_at: run.captured_at,
            snapshot_label: label,
            league: event.league,
            event_id: event.eventID,
            starts_at: event.startsAt,
            away_team: event.matchup?.away?.name ?? null,
            home_team: event.matchup?.home?.name ?? null,
            book,
            market,
            side,
            line: toNum(b.line),
            odds: toInt(b.odds),
            available: b.available ?? null,
            source: "mainstream",
            raw: {
              updatedAt: b.updatedAt ?? null,
              openOdds: b.openOdds ?? null,
              openLine: b.openLine ?? null,
              closeOdds: b.closeOdds ?? null,
              closeLine: b.closeLine ?? null,
            },
          });
        }
      }
    }

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from("market_snapshots")
        .insert(rows.slice(i, i + 500));
      if (error) throw error;
    }

    const { error: finishError } = await supabase
      .from("market_snapshot_runs")
      .update({
        row_count: rows.length,
        status: "ok",
        note: board.unavailableLeagues?.length
          ? JSON.stringify(board.unavailableLeagues)
          : null,
      })
      .eq("id", run.id);

    if (finishError) throw finishError;

    return new Response(JSON.stringify({
      ok: true,
      runId: run.id,
      label,
      leagues,
      eventCount: board.eventCount ?? board.events?.length ?? 0,
      rowCount: rows.length,
      capturedAt: run.captured_at,
    }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});