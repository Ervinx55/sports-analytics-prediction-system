import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function ageMinutes(value: unknown) {
  const t = Date.parse(String(value || ""));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 60000);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "GET only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("sharp_source_quotes")
      .select("source_book,provider,source_kind,observed_at,event_date,away_team,home_team,market_type,market_side,odds,opponent_odds")
      .gte("observed_at", since)
      .order("observed_at", { ascending: false })
      .limit(5000);

    if (error) throw error;

    const rows = data ?? [];
    const summarize = (sourceBook: string) => {
      const src = rows.filter((r: any) => r.source_book === sourceBook);
      const latest = src[0]?.observed_at ?? null;
      const age = ageMinutes(latest);
      const uniqueEvents = new Set(
        src.map((r: any) =>
          [r.event_date, r.away_team, r.home_team].join("|")
        ),
      );
      const mlPairs = src.filter(
        (r: any) =>
          r.market_type === "moneyline" &&
          r.odds !== null &&
          r.opponent_odds !== null,
      ).length;

      let status = "NO_DATA";
      if (latest) status = age !== null && age <= 15 ? "ONLINE" : "STALE";
      if (sourceBook === "circa" && !latest) status = "NO_PUBLIC_UPCOMING_QUOTES";

      return {
        status,
        latestObservedAt: latest,
        ageMinutes: age === null ? null : Number(age.toFixed(1)),
        rows24h: src.length,
        eventCount24h: uniqueEvents.size,
        moneylinePriceRows24h: mlPairs,
        provider: src[0]?.provider ?? null,
        sourceKind: src[0]?.source_kind ?? null,
      };
    };

    const bookmaker = summarize("bookmaker");
    const circa = summarize("circa");
    const pinnacleObserved = summarize("pinnacle");
    const pinnacle = pinnacleObserved.latestObservedAt
      ? {
          ...pinnacleObserved,
          status:
            pinnacleObserved.provider?.includes("official_api")
              ? "ONLINE"
              : (pinnacleObserved.ageMinutes !== null && pinnacleObserved.ageMinutes <= 30
                  ? "MANUAL_FRESH"
                  : "STALE"),
        }
      : {
          status: "API_NOT_CONNECTED",
          latestObservedAt: null,
          ageMinutes: null,
          rows24h: 0,
          eventCount24h: 0,
          moneylinePriceRows24h: 0,
          provider: null,
          sourceKind: null,
        };

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        refreshCadenceMinutes: 5,
        sources: {
          bookmaker: {
            ...bookmaker,
            trust: "direct",
            note:
              "Direct BookMaker public MLB odds CSV. Two-sided moneyline prices are usable for no-vig sharp probability; run-line and total numbers are captured as line confirmation only because this feed does not publish their juice.",
          },
          circa: {
            ...circa,
            trust: "secondary",
            note:
              "Secondary Circa observation from VSiN's public Circa betting-splits page. Public coverage can be partial, so absence is not treated as evidence that Circa has no market.",
          },
          pinnacle: {
            ...pinnacle,
            trust: pinnacle.provider?.includes("official_api")
              ? "direct_api"
              : pinnacle.latestObservedAt
                ? "manual_verified"
                : "official_api_required",
            note:
              pinnacle.latestObservedAt
                ? "Pinnacle quote is from a verified manual board/screenshot unless an official API provider is shown."
                : "Pinnacle automated scraping is disabled. The adapter is reserved for authorized official API access; verified manual board screenshots can still be ingested.",
          },
        },
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