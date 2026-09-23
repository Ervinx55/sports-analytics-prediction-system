import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function americanToProb(v: unknown): number | null {
  const o = num(v);
  if (o === null || o === 0) return null;
  return o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100);
}

function noVig(aOdds: unknown, bOdds: unknown): number | null {
  const a = americanToProb(aOdds);
  const b = americanToProb(bOdds);
  if (a === null || b === null) return null;
  const hold = a + b;
  if (hold < 0.985 || hold > 1.15) return null;
  return a / hold;
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
    const hours = Math.max(1, Math.min(72, Number(u.searchParams.get("hours") || 24)));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const [quotesRes, clvRes] = await Promise.all([
      supabase
        .from("sharp_source_quotes")
        .select("*")
        .eq("sport", sport)
        .gte("observed_at", since)
        .order("observed_at", { ascending: true })
        .limit(20000),
      supabase
        .from("sharp_market_clv")
        .select("*")
        .eq("sport", sport)
        .gte("starts_at", new Date(Date.now() - 14 * 86400_000).toISOString())
        .order("starts_at", { ascending: false })
        .limit(2000),
    ]);

    if (quotesRes.error) throw quotesRes.error;
    if (clvRes.error) throw clvRes.error;

    const groups = new Map<string, any[]>();
    for (const q of quotesRes.data ?? []) {
      const fair = noVig(q.odds, q.opponent_odds);
      if (fair === null) continue;
      const key = [
        q.source_book,
        q.source_event_key || "",
        q.market_type,
        q.market_side,
        q.line == null ? "" : Number(q.line),
      ].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ ...q, fairProbability: fair });
    }

    const movements = [...groups.values()].map((xs) => {
      xs.sort((a,b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
      const first = xs[0];
      const latest = xs[xs.length - 1];
      return {
        sourceBook: latest.source_book,
        provider: latest.provider,
        eventDate: latest.event_date,
        awayTeam: latest.away_team,
        homeTeam: latest.home_team,
        marketType: latest.market_type,
        marketSide: latest.market_side,
        line: latest.line,
        firstTrackedAt: first.observed_at,
        firstTrackedOdds: first.odds,
        firstTrackedFairProbability: Number(first.fairProbability.toFixed(6)),
        currentAt: latest.observed_at,
        currentOdds: latest.odds,
        currentFairProbability: Number(latest.fairProbability.toFixed(6)),
        movementPctPoints: Number(
          ((latest.fairProbability - first.fairProbability) * 100).toFixed(4),
        ),
        updateCount: xs.length,
      };
    }).sort((a,b) => Math.abs(b.movementPctPoints) - Math.abs(a.movementPctPoints));

    const clv = clvRes.data ?? [];
    const usableClv = clv.filter((x:any) => num(x.closing_sharp_probability) !== null);
    const avg = (xs:number[]) => xs.length
      ? xs.reduce((s,x)=>s+x,0)/xs.length
      : null;

    const clvVals = usableClv
      .map((x:any)=>num(x.market_to_close_clv_pp))
      .filter((x:any): x is number => x !== null);
    const modelClose = usableClv
      .map((x:any)=>num(x.model_vs_close_pp))
      .filter((x:any): x is number => x !== null);

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        sport,
        hours,
        summary: {
          trackedMarkets: movements.length,
          sources: [...new Set(movements.map((x)=>x.sourceBook))],
          clvRecords: usableClv.length,
          averageMarketToCloseClvPctPoints:
            clvVals.length ? Number(avg(clvVals)!.toFixed(3)) : null,
          positiveClvRate:
            clvVals.length
              ? Number((clvVals.filter((x)=>x > 0).length / clvVals.length).toFixed(4))
              : null,
          averageModelVsClosePctPoints:
            modelClose.length ? Number(avg(modelClose)!.toFixed(3)) : null,
        },
        movements,
        closingRecords: clv.slice(0,100),
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
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});