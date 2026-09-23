import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function americanToProb(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : (-odds) / ((-odds) + 100);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "GET only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const league = url.searchParams.get("league") || "MLB";
    const hours = Math.max(1, Math.min(168, Number(url.searchParams.get("hours") || 36)));
    const eventID = url.searchParams.get("eventID");
    const bookFilter = url.searchParams.get("book");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    let query = supabase
      .from("market_snapshots")
      .select("captured_at,snapshot_label,league,event_id,starts_at,away_team,home_team,book,market,side,line,odds,available")
      .eq("league", league)
      .gte("captured_at", since)
      .order("captured_at", { ascending: true })
      .limit(10000);

    if (eventID) query = query.eq("event_id", eventID);
    if (bookFilter) query = query.eq("book", bookFilter);

    const { data, error } = await query;
    if (error) throw error;

    const groups = new Map<string, any[]>();
    for (const row of data ?? []) {
      const key = [row.event_id, row.book, row.market, row.side].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const movements = [];
    for (const rows of groups.values()) {
      const availableRows = rows.filter((r) => r.available !== false);
      const usable = availableRows.length ? availableRows : rows;
      if (!usable.length) continue;

      const first = usable[0];
      const latest = usable[usable.length - 1];
      const firstProb = americanToProb(first.odds);
      const latestProb = americanToProb(latest.odds);

      movements.push({
        eventID: latest.event_id,
        startsAt: latest.starts_at,
        matchup: {
          away: latest.away_team,
          home: latest.home_team,
        },
        book: latest.book,
        market: latest.market,
        side: latest.side,
        first: {
          capturedAt: first.captured_at,
          label: first.snapshot_label,
          line: first.line,
          odds: first.odds,
          impliedProbability: firstProb,
        },
        latest: {
          capturedAt: latest.captured_at,
          label: latest.snapshot_label,
          line: latest.line,
          odds: latest.odds,
          impliedProbability: latestProb,
        },
        movement: {
          line: (first.line !== null && latest.line !== null)
            ? Number(latest.line) - Number(first.line)
            : null,
          odds: (first.odds !== null && latest.odds !== null)
            ? Number(latest.odds) - Number(first.odds)
            : null,
          impliedProbabilityPctPoints:
            (firstProb !== null && latestProb !== null)
              ? (latestProb - firstProb) * 100
              : null,
          snapshots: usable.length,
        },
      });
    }

    movements.sort((a, b) => {
      const ap = Math.abs(a.movement.impliedProbabilityPctPoints ?? 0);
      const bp = Math.abs(b.movement.impliedProbabilityPctPoints ?? 0);
      const al = Math.abs(a.movement.line ?? 0);
      const bl = Math.abs(b.movement.line ?? 0);
      return (bp + bl * 2) - (ap + al * 2);
    });

    return new Response(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      league,
      hours,
      movementCount: movements.length,
      movements,
    }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=30",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});