import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_BOOKS = new Set(["pinnacle", "circa", "bookmaker"]);

function normTeam(s: unknown) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

function odds(v: unknown): number | null {
  const n = num(v);
  if (n === null || n === 0 || Math.abs(n) > 10000) return null;
  return Math.trunc(n);
}

function eventKey(date: string | null, away: string, home: string) {
  return [date ?? "", normTeam(away), normTeam(home)].join("|");
}

function pairRows(base: any, marketType: string, sideA: string, sideB: string,
  lineA: number | null, lineB: number | null, oddsA: number | null, oddsB: number | null) {
  const rows: any[] = [];
  if (lineA !== null || oddsA !== null || oddsB !== null) {
    rows.push({
      ...base,
      market_type: marketType,
      market_side: sideA,
      line: lineA,
      odds: oddsA,
      opponent_odds: oddsB,
    });
  }
  if (lineB !== null || oddsB !== null || oddsA !== null) {
    rows.push({
      ...base,
      market_type: marketType,
      market_side: sideB,
      line: lineB,
      odds: oddsB,
      opponent_odds: oddsA,
    });
  }
  return rows;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const body = await req.json();
    const boards = Array.isArray(body?.boards) ? body.boards : [body];
    const rows: any[] = [];
    const accepted: any[] = [];

    for (const b of boards) {
      const sourceBook = String(b?.sourceBook || "").toLowerCase();
      if (!ALLOWED_BOOKS.has(sourceBook)) {
        throw new Error("sourceBook must be pinnacle, circa, or bookmaker");
      }

      const away = String(b?.awayTeam || "").trim();
      const home = String(b?.homeTeam || "").trim();
      if (!away || !home) throw new Error("awayTeam and homeTeam are required");

      const observedAt = b?.observedAt
        ? new Date(String(b.observedAt)).toISOString()
        : new Date().toISOString();
      const startsAt = b?.startsAt ? new Date(String(b.startsAt)).toISOString() : null;
      const eventDate =
        String(b?.eventDate || (startsAt ? startsAt.slice(0, 10) : "")).trim() || null;
      if (!eventDate) throw new Error("eventDate or startsAt is required");

      const provider = String(b?.provider || "manual_screenshot_verified");
      const sourceKind = String(b?.sourceKind || "manual");
      const base = {
        observed_at: observedAt,
        sport: String(b?.sport || "MLB").toUpperCase(),
        source_book: sourceBook,
        provider,
        source_kind: sourceKind,
        source_event_key: eventKey(eventDate, away, home),
        event_date: eventDate,
        starts_at: startsAt,
        away_team: away,
        home_team: home,
        source_updated_at: observedAt,
        freshness_basis: "manual_verified",
        source_url: b?.sourceUrl ?? null,
        raw: {
          evidenceNote: b?.evidenceNote ?? null,
          capturedBy: b?.capturedBy ?? "manual",
          original: b?.raw ?? null,
        },
      };

      const mlAway = odds(b?.moneyline?.awayOdds);
      const mlHome = odds(b?.moneyline?.homeOdds);
      if (mlAway !== null || mlHome !== null) {
        if (mlAway === null || mlHome === null) {
          throw new Error("moneyline requires both awayOdds and homeOdds");
        }
        rows.push(...pairRows(base, "moneyline", "away", "home", null, null, mlAway, mlHome));
      }

      const spAwayLine = num(b?.spread?.awayLine);
      const spHomeLine = num(b?.spread?.homeLine);
      const spAwayOdds = odds(b?.spread?.awayOdds);
      const spHomeOdds = odds(b?.spread?.homeOdds);
      if (
        spAwayLine !== null || spHomeLine !== null ||
        spAwayOdds !== null || spHomeOdds !== null
      ) {
        if (spAwayLine === null || spHomeLine === null) {
          throw new Error("spread requires awayLine and homeLine");
        }
        if ((spAwayOdds === null) !== (spHomeOdds === null)) {
          throw new Error("spread prices must be supplied as a two-sided pair");
        }
        rows.push(...pairRows(
          base, "spread", "away", "home",
          spAwayLine, spHomeLine, spAwayOdds, spHomeOdds
        ));
      }

      const totalLine = num(b?.total?.line);
      const overOdds = odds(b?.total?.overOdds);
      const underOdds = odds(b?.total?.underOdds);
      if (totalLine !== null || overOdds !== null || underOdds !== null) {
        if (totalLine === null) throw new Error("total requires line");
        if ((overOdds === null) !== (underOdds === null)) {
          throw new Error("total prices must be supplied as a two-sided pair");
        }
        rows.push(...pairRows(
          base, "total", "over", "under",
          totalLine, totalLine, overOdds, underOdds
        ));
      }

      accepted.push({
        sourceBook,
        eventDate,
        awayTeam: away,
        homeTeam: home,
        provider,
      });
    }

    if (!rows.length) {
      throw new Error("No usable markets were supplied");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await supabase
      .from("sharp_source_quotes")
      .insert(rows);
    if (error) throw error;

    const refresh = await supabase.functions.invoke(
      "refresh-sharp-sources",
      { body: {} },
    );

    return new Response(
      JSON.stringify({
        ok: true,
        insertedRows: rows.length,
        boards: accepted,
        refreshTriggered: !refresh.error,
        refreshError: refresh.error?.message ?? null,
        evaluations: refresh.data?.evaluations ?? [],
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
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }
});