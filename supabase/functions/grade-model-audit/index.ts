import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function americanToProb(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : (-odds) / ((-odds) + 100);
}

function noVig(a: number | null, b: number | null): number | null {
  const pa = americanToProb(a);
  const pb = americanToProb(b);
  if (pa === null || pb === null || pa + pb <= 0) return null;
  return pa / (pa + pb);
}

async function fetchJson(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 500) }; }
  if (!r.ok) throw new Error(`${r.status} ${url}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
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

    const cutoff = new Date(Date.now() - 3 * 3600_000).toISOString();
    const floor = new Date(Date.now() - 4 * 86400_000).toISOString();

    const { data: audits, error: auditError } = await supabase
      .from("model_audit_observations")
      .select("*")
      .eq("sport", "MLB")
      .gte("starts_at", floor)
      .lt("starts_at", cutoff)
      .order("starts_at", { ascending: false })
      .limit(5000);

    if (auditError) throw auditError;

    const auditIds = (audits ?? []).map((x: any) => x.id);
    const gradedIds = new Set<number>();

    if (auditIds.length) {
      for (let i = 0; i < auditIds.length; i += 500) {
        const { data: grades, error } = await supabase
          .from("candidate_grades")
          .select("audit_id")
          .in("audit_id", auditIds.slice(i, i + 500));
        if (error) throw error;
        for (const g of grades ?? []) gradedIds.add(Number(g.audit_id));
      }
    }

    const ungraded = (audits ?? []).filter((a: any) => !gradedIds.has(Number(a.id)));
    const byGame = new Map<string, any[]>();
    for (const a of ungraded) {
      const key = String(a.game_pk || a.event_id);
      if (!byGame.has(key)) byGame.set(key, []);
      byGame.get(key)!.push(a);
    }

    let gamesGraded = 0;
    let rowsGraded = 0;

    for (const rows of byGame.values()) {
      const sample = rows[0];
      if (!sample.game_pk) continue;

      let feed: any;
      try {
        feed = await fetchJson(
          `https://statsapi.mlb.com/api/v1.1/game/${sample.game_pk}/feed/live`
        );
      } catch {
        continue;
      }

      const status = feed?.gameData?.status || {};
      if (status.abstractGameState !== "Final") continue;

      const awayScore = Number(feed?.liveData?.linescore?.teams?.away?.runs ?? NaN);
      const homeScore = Number(feed?.liveData?.linescore?.teams?.home?.runs ?? NaN);
      if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) continue;

      const winnerSide = homeScore > awayScore ? "home" : "away";
      const totalRuns = homeScore + awayScore;

      const { error: resultError } = await supabase
        .from("game_results")
        .upsert({
          event_id: sample.event_id,
          sport: "MLB",
          game_pk: sample.game_pk,
          starts_at: sample.starts_at,
          away_team: sample.away_team,
          home_team: sample.home_team,
          away_score: awayScore,
          home_score: homeScore,
          total_runs: totalRuns,
          winner_side: winnerSide,
          final_status: status.detailedState ?? "Final",
          graded_at: new Date().toISOString(),
          raw: { status },
        }, { onConflict: "event_id" });

      if (resultError) throw resultError;

      const { data: closingRows, error: closingError } = await supabase
        .from("market_snapshots")
        .select("captured_at,book,side,odds,available,snapshot_label")
        .eq("event_id", sample.event_id)
        .eq("market", "moneyline")
        .lt("captured_at", sample.starts_at)
        .order("captured_at", { ascending: false })
        .limit(500);

      if (closingError) throw closingError;

      const usable = (closingRows ?? []).filter((r: any) => r.available !== false);
      const preferred = usable.filter((r: any) => r.snapshot_label === "closing-window");
      const sourceRows = preferred.length ? preferred : usable;

      let closingCapturedAt: string | null = null;
      if (sourceRows.length) closingCapturedAt = sourceRows[0].captured_at;

      const latestRows = closingCapturedAt
        ? sourceRows.filter((r: any) => r.captured_at === closingCapturedAt)
        : [];

      const bookPairs = new Map<string, {home?: number; away?: number}>();
      for (const r of latestRows) {
        const odds = Number(r.odds);
        if (!Number.isFinite(odds)) continue;
        if (!bookPairs.has(r.book)) bookPairs.set(r.book, {});
        const pair = bookPairs.get(r.book)!;
        if (r.side === "home") pair.home = odds;
        if (r.side === "away") pair.away = odds;
      }

      for (const a of rows) {
        let bestOdds: number | null = null;
        let bestBook: string | null = null;
        const fairProbs: number[] = [];

        for (const [book, pair] of bookPairs.entries()) {
          const sideOdds = a.side_key === "home" ? pair.home ?? null : pair.away ?? null;
          const oppOdds = a.side_key === "home" ? pair.away ?? null : pair.home ?? null;
          if (sideOdds !== null && (bestOdds === null || sideOdds > bestOdds)) {
            bestOdds = sideOdds;
            bestBook = book;
          }
          const fair = noVig(sideOdds, oppOdds);
          if (fair !== null) fairProbs.push(fair);
        }

        const closingFair =
          fairProbs.length
            ? fairProbs.reduce((s, x) => s + x, 0) / fairProbs.length
            : null;

        const initialImplied = americanToProb(a.best_odds ?? null);
        const closingImplied = americanToProb(bestOdds);
        const clv =
          initialImplied !== null && closingImplied !== null
            ? (closingImplied - initialImplied) * 100
            : null;
        const modelVsClose =
          a.final_probability !== null && closingFair !== null
            ? (Number(a.final_probability) - closingFair) * 100
            : null;

        const won = a.side_key === winnerSide;

        const { error: gradeError } = await supabase
          .from("candidate_grades")
          .upsert({
            audit_id: a.id,
            event_id: a.event_id,
            side_key: a.side_key,
            result: won ? "W" : "L",
            won,
            closing_book: bestBook,
            closing_odds: bestOdds,
            closing_fair_probability: closingFair,
            model_probability: a.final_probability,
            probability_clv_pp: clv,
            price_clv_cents:
              bestOdds !== null && a.best_odds !== null
                ? bestOdds - Number(a.best_odds)
                : null,
            closing_captured_at: closingCapturedAt,
            initial_implied_probability: initialImplied,
            closing_implied_probability: closingImplied,
            clv_implied_pp: clv,
            model_vs_close_pp: modelVsClose,
            graded_at: new Date().toISOString(),
            raw: {
              winnerSide,
              awayScore,
              homeScore,
              closingSource:
                preferred.length ? "closing-window" : "latest-pregame-snapshot",
              booksUsed: [...bookPairs.keys()],
            },
          }, { onConflict: "audit_id" });

        if (gradeError) throw gradeError;
        rowsGraded++;
      }

      gamesGraded++;
    }

    return new Response(JSON.stringify({
      ok: true,
      gamesGraded,
      rowsGraded,
      checkedAuditRows: ungraded.length,
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