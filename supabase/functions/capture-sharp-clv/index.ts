import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOOK_WEIGHTS: Record<string, number> = {
  pinnacle: 0.45,
  circa: 0.35,
  bookmaker: 0.20,
};

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

function noVig(candidateOdds: unknown, opponentOdds: unknown): number | null {
  const a = americanToProb(candidateOdds);
  const b = americanToProb(opponentOdds);
  if (a === null || b === null) return null;
  const hold = a + b;
  if (!(hold >= 0.985 && hold <= 1.15)) return null;
  return a / hold;
}

function probToAmerican(p: number | null): number | null {
  if (p === null || !Number.isFinite(p) || p <= 0 || p >= 1) return null;
  return p >= 0.5
    ? Math.round(-100 * p / (1 - p))
    : Math.round(100 * (1 - p) / p);
}

function normTeam(v: unknown) {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function localDate(value: unknown, timeZone: string) {
  const d = new Date(String(value || ""));
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function lineMatches(a: unknown, b: unknown) {
  if (a == null || b == null) return a == null && b == null;
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 0.001;
}

function providerFactor(provider: unknown) {
  const p = String(provider || "");
  if (p.includes("official_api")) return 1.0;
  if (p === "bookmaker_direct_csv") return 1.0;
  if (p === "manual_screenshot_verified") return 0.9;
  if (p === "vsin_public_circa") return 0.75;
  return 0.7;
}

function weightedConsensus(points: any[]) {
  if (!points.length) return null;
  let weighted = 0, total = 0;
  for (const p of points) {
    const base = BOOK_WEIGHTS[p.source_book] || 0.1;
    const w = base * providerFactor(p.provider);
    weighted += p.fairProbability * w;
    total += w;
  }
  return total > 0 ? weighted / total : null;
}

function matchingQuotes(all: any[], obs: any) {
  const acceptableDates = new Set(
    [
      String(obs.starts_at || "").slice(0, 10),
      localDate(obs.starts_at, "America/Los_Angeles"),
      localDate(obs.starts_at, "America/Chicago"),
    ].filter(Boolean),
  );
  const away = normTeam(obs.away_team);
  const home = normTeam(obs.home_team);
  return all.filter((q) =>
    acceptableDates.has(q.event_date) &&
    normTeam(q.away_team) === away &&
    normTeam(q.home_team) === home &&
    q.market_type === obs.market_type &&
    q.market_side === obs.market_side &&
    lineMatches(q.line, obs.line)
  );
}

function sourcePoints(quotes: any[], startsAt: string | null) {
  const byBook = new Map<string, any[]>();
  for (const q of quotes) {
    const p = noVig(q.odds, q.opponent_odds);
    if (p === null) continue;
    if (!byBook.has(q.source_book)) byBook.set(q.source_book, []);
    byBook.get(q.source_book)!.push({ ...q, fairProbability: p });
  }

  const first: any[] = [];
  const close: any[] = [];
  const startMs = Date.parse(startsAt || "");
  for (const [book, xs] of byBook.entries()) {
    xs.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
    if (xs.length) first.push(xs[0]);

    if (Number.isFinite(startMs)) {
      const eligible = xs.filter((x) => Date.parse(x.observed_at) <= startMs);
      const latest = eligible[eligible.length - 1];
      if (latest) {
        const ageMin = (startMs - Date.parse(latest.observed_at)) / 60000;
        if (ageMin <= 90) close.push({ ...latest, closeAgeMinutes: ageMin });
      }
    }
  }
  return { first, close };
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

    const since = new Date(Date.now() - 14 * 86400_000).toISOString();
    const [obsRes, resultRes, quoteRes] = await Promise.all([
      supabase
        .from("market_grade_observations")
        .select("*")
        .gte("starts_at", since)
        .lte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: false })
        .limit(5000),
      supabase
        .from("team_market_results")
        .select("*")
        .gte("graded_at", since)
        .order("graded_at", { ascending: false })
        .limit(5000),
      supabase
        .from("sharp_source_quotes")
        .select("*")
        .gte("observed_at", since)
        .order("observed_at", { ascending: true })
        .limit(20000),
    ]);

    if (obsRes.error) throw obsRes.error;
    if (resultRes.error) throw resultRes.error;
    if (quoteRes.error) throw quoteRes.error;

    const resultByObs = new Map(
      (resultRes.data ?? []).map((r: any) => [Number(r.observation_id), r]),
    );
    const rows: any[] = [];

    for (const obs of obsRes.data ?? []) {
      const result = resultByObs.get(Number(obs.id));
      if (!result) continue;

      const matched = matchingQuotes(quoteRes.data ?? [], obs);
      const { first, close } = sourcePoints(matched, obs.starts_at);
      const firstConsensus = weightedConsensus(first);
      const closeConsensus = weightedConsensus(close);

      if (firstConsensus === null && closeConsensus === null) continue;

      const firstAt = first.length
        ? first.map((x) => Date.parse(x.observed_at)).sort((a,b)=>a-b)[0]
        : null;
      const closeAt = close.length
        ? close.map((x) => Date.parse(x.observed_at)).sort((a,b)=>b-a)[0]
        : null;

      const sourceSummary = {
        first: Object.fromEntries(first.map((x) => [
          x.source_book,
          {
            provider: x.provider,
            observedAt: x.observed_at,
            fairProbability: Number(x.fairProbability.toFixed(6)),
            odds: x.odds,
            opponentOdds: x.opponent_odds,
          },
        ])),
        close: Object.fromEntries(close.map((x) => [
          x.source_book,
          {
            provider: x.provider,
            observedAt: x.observed_at,
            fairProbability: Number(x.fairProbability.toFixed(6)),
            odds: x.odds,
            opponentOdds: x.opponent_odds,
            closeAgeMinutes: Number(x.closeAgeMinutes.toFixed(1)),
          },
        ])),
      };

      rows.push({
        observation_id: Number(obs.id),
        captured_at: new Date().toISOString(),
        sport: obs.sport,
        event_id: obs.event_id,
        game_pk: obs.game_pk,
        starts_at: obs.starts_at,
        away_team: obs.away_team,
        home_team: obs.home_team,
        market_type: obs.market_type,
        market_side: obs.market_side,
        market_label: obs.market_label,
        line: obs.line,
        decision_status: result.decision_status,
        outcome: result.outcome,
        best_book: obs.best_book,
        best_odds: obs.best_odds,
        model_probability: obs.model_probability,
        market_fair_probability: obs.market_fair_probability,
        first_tracked_at: firstAt === null ? null : new Date(firstAt).toISOString(),
        first_tracked_sharp_probability:
          firstConsensus === null ? null : Number(firstConsensus.toFixed(6)),
        first_tracked_source_count: first.length,
        closing_at: closeAt === null ? null : new Date(closeAt).toISOString(),
        closing_sharp_probability:
          closeConsensus === null ? null : Number(closeConsensus.toFixed(6)),
        closing_source_count: close.length,
        tracked_sharp_move_pp:
          firstConsensus === null || closeConsensus === null
            ? null
            : Number(((closeConsensus - firstConsensus) * 100).toFixed(4)),
        market_to_close_clv_pp:
          closeConsensus === null || num(obs.market_fair_probability) === null
            ? null
            : Number(((closeConsensus - Number(obs.market_fair_probability)) * 100).toFixed(4)),
        model_vs_close_pp:
          closeConsensus === null || num(obs.model_probability) === null
            ? null
            : Number(((Number(obs.model_probability) - closeConsensus) * 100).toFixed(4)),
        closing_fair_american_odds: probToAmerican(closeConsensus),
        source_summary: sourceSummary,
        raw: {
          evaluatorVersion: "sharp-clv-v1",
          matchedQuoteCount: matched.length,
          closeFreshnessLimitMinutes: 90,
        },
      });
    }

    if (rows.length) {
      const { error } = await supabase
        .from("sharp_market_clv")
        .upsert(rows, { onConflict: "observation_id" });
      if (error) throw error;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        version: "sharp-clv-v1",
        updatedRows: rows.length,
        sourceQuoteRows: quoteRes.data?.length ?? 0,
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