import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Row = {
  captured_at: string;
  snapshot_label: string | null;
  league: string;
  event_id: string;
  starts_at: string | null;
  away_team: string | null;
  home_team: string | null;
  book: string;
  market: string;
  side: string;
  line: number | null;
  odds: number | null;
  available: boolean | null;
};

function americanToProb(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : (-odds) / ((-odds) + 100);
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function materialProbMove(v: number | null) {
  return v !== null && Math.abs(v) >= 1.25;
}

function direction(v: number | null, threshold = 0.6) {
  if (v === null || Math.abs(v) < threshold) return 0;
  return v > 0 ? 1 : -1;
}

function lineKey(v: number | null) {
  return v === null ? "null" : String(Number(v));
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
    const league = u.searchParams.get("league") || "MLB";
    const hours = Math.max(2, Math.min(168, Number(u.searchParams.get("hours") || 36)));
    const minBooks = Math.max(2, Math.min(4, Number(u.searchParams.get("minBooks") || 3)));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("market_snapshots")
      .select("captured_at,snapshot_label,league,event_id,starts_at,away_team,home_team,book,market,side,line,odds,available")
      .eq("league", league)
      .gte("captured_at", since)
      .order("captured_at", { ascending: true })
      .limit(12000);

    if (error) throw error;
    const rows = (data ?? []) as Row[];

    const perBook = new Map<string, Row[]>();
    for (const r of rows) {
      const k = [r.event_id, r.market, r.side, r.book].join("|");
      if (!perBook.has(k)) perBook.set(k, []);
      perBook.get(k)!.push(r);
    }

    const bookMoves: any[] = [];
    for (const rs of perBook.values()) {
      const usable = rs.filter((r) => r.available !== false);
      const x = usable.length ? usable : rs;
      if (!x.length) continue;

      const first = x[0];
      const latest = x[x.length - 1];
      const mid = x[Math.floor((x.length - 1) / 2)];

      const fp = americanToProb(first.odds);
      const mp = americanToProb(mid.odds);
      const lp = americanToProb(latest.odds);

      bookMoves.push({
        eventID: latest.event_id,
        startsAt: latest.starts_at,
        awayTeam: latest.away_team,
        homeTeam: latest.home_team,
        market: latest.market,
        side: latest.side,
        book: latest.book,
        snapshots: x.length,
        first: { line: first.line, odds: first.odds, prob: fp, at: first.captured_at, label: first.snapshot_label },
        latest: { line: latest.line, odds: latest.odds, prob: lp, at: latest.captured_at, label: latest.snapshot_label },
        lineDelta: first.line !== null && latest.line !== null ? Number(latest.line) - Number(first.line) : null,
        probDelta: fp !== null && lp !== null ? (lp - fp) * 100 : null,
        firstHalf: fp !== null && mp !== null ? (mp - fp) * 100 : null,
        secondHalf: mp !== null && lp !== null ? (lp - mp) * 100 : null,
      });
    }

    const group = new Map<string, any[]>();
    for (const m of bookMoves) {
      const k = [m.eventID, m.market, m.side].join("|");
      if (!group.has(k)) group.set(k, []);
      group.get(k)!.push(m);
    }

    const alerts: any[] = [];

    for (const ms of group.values()) {
      const sample = ms[0];

      // 1) Confirmed multi-book movement.
      const movedUp = ms.filter((m) => materialProbMove(m.probDelta) && m.probDelta > 0);
      const movedDown = ms.filter((m) => materialProbMove(m.probDelta) && m.probDelta < 0);
      const strongest = movedUp.length >= movedDown.length ? movedUp : movedDown;

      if (strongest.length >= minBooks) {
        const toward = strongest === movedUp;
        const avg = strongest.reduce((s, m) => s + Math.abs(m.probDelta), 0) / strongest.length;
        alerts.push({
          type: "steam",
          severity: strongest.length === 4 && avg >= 2 ? "high" : "medium",
          eventID: sample.eventID,
          startsAt: sample.startsAt,
          matchup: { away: sample.awayTeam, home: sample.homeTeam },
          market: sample.market,
          side: sample.side,
          direction: toward ? "toward_side" : "away_from_side",
          booksConfirmed: strongest.map((m) => m.book),
          bookCount: strongest.length,
          avgImpliedProbabilityMovePctPoints: Number(((toward ? 1 : -1) * avg).toFixed(2)),
          summary: `${strongest.length}/${ms.length} books moved ${toward ? "toward" : "away from"} ${sample.side} in ${sample.market}`,
        });
      }

      // 2) Reversal after at least 3 snapshots.
      const reversals = ms.filter((m) => {
        if (m.snapshots < 3) return false;
        const a = direction(m.firstHalf);
        const b = direction(m.secondHalf);
        return a !== 0 && b !== 0 && a !== b;
      });
      if (reversals.length >= 2) {
        alerts.push({
          type: "reversal",
          severity: reversals.length >= 3 ? "medium" : "watch",
          eventID: sample.eventID,
          startsAt: sample.startsAt,
          matchup: { away: sample.awayTeam, home: sample.homeTeam },
          market: sample.market,
          side: sample.side,
          booksConfirmed: reversals.map((m) => m.book),
          bookCount: reversals.length,
          summary: `${reversals.length} books reversed direction for ${sample.side} in ${sample.market}`,
        });
      }

      const current = ms.filter((m) => m.latest.prob !== null);

      // 3) Line consensus / split-market logic for spread and totals.
      if (["spread", "total"].includes(sample.market)) {
        const counts = new Map<string, any[]>();
        for (const m of current) {
          const k = lineKey(m.latest.line);
          if (!counts.has(k)) counts.set(k, []);
          counts.get(k)!.push(m);
        }

        const clusters = [...counts.entries()]
          .filter(([k]) => k !== "null")
          .sort((a, b) => b[1].length - a[1].length);

        const leader = clusters[0];
        const second = clusters[1];

        if (leader && leader[1].length >= 3) {
          const consensusLine = Number(leader[0]);
          for (const m of current) {
            if (m.latest.line === null) continue;
            const gap = Number(m.latest.line) - consensusLine;
            if (Math.abs(gap) >= 0.5) {
              alerts.push({
                type: "line_outlier",
                severity: Math.abs(gap) >= 1 ? "high" : "medium",
                eventID: sample.eventID,
                startsAt: sample.startsAt,
                matchup: { away: sample.awayTeam, home: sample.homeTeam },
                market: sample.market,
                side: sample.side,
                book: m.book,
                latestLine: m.latest.line,
                latestOdds: m.latest.odds,
                consensusLine,
                lineGap: gap,
                consensusBooks: leader[1].map((x) => x.book),
                summary: `${m.book} is off the ${leader[1].length}-book consensus line by ${Math.abs(gap)}`,
              });
            }
          }
        } else if (leader && second && leader[1].length === 2 && second[1].length === 2 && leader[0] !== second[0]) {
          alerts.push({
            type: "split_market",
            severity: "watch",
            eventID: sample.eventID,
            startsAt: sample.startsAt,
            matchup: { away: sample.awayTeam, home: sample.homeTeam },
            market: sample.market,
            side: sample.side,
            lines: [
              { line: Number(leader[0]), books: leader[1].map((x) => x.book) },
              { line: Number(second[0]), books: second[1].map((x) => x.book) },
            ],
            summary: `Market is split 2-2 on ${sample.side} ${sample.market}; verify the exact playable number`,
          });
        }
      }

      // 4) Same-line price outliers only. Never compare juice across different lines.
      const byLine = new Map<string, any[]>();
      for (const m of current) {
        const k = lineKey(m.latest.line);
        if (!byLine.has(k)) byLine.set(k, []);
        byLine.get(k)!.push(m);
      }

      for (const [k, cluster] of byLine.entries()) {
        if (cluster.length < 3) continue;
        const medProb = median(cluster.map((m) => m.latest.prob * 100));
        if (medProb === null) continue;

        for (const m of cluster) {
          const p = m.latest.prob * 100;
          const gap = p - medProb;
          if (Math.abs(gap) >= 2.5) {
            alerts.push({
              type: "price_outlier",
              severity: Math.abs(gap) >= 4 ? "high" : "medium",
              eventID: sample.eventID,
              startsAt: sample.startsAt,
              matchup: { away: sample.awayTeam, home: sample.homeTeam },
              market: sample.market,
              side: sample.side,
              book: m.book,
              line: k === "null" ? null : Number(k),
              latestOdds: m.latest.odds,
              medianImpliedProbabilityPct: Number(medProb.toFixed(2)),
              impliedProbabilityGapPctPoints: Number(gap.toFixed(2)),
              comparisonBooks: cluster.map((x) => x.book),
              summary: `${m.book} has a same-line price outlier on ${sample.side} ${sample.market}`,
            });
          }
        }
      }
    }

    const weight = { high: 4, medium: 3, watch: 1 } as Record<string, number>;
    const typeWeight = { steam: 4, line_outlier: 3, price_outlier: 3, reversal: 2, split_market: 1 } as Record<string, number>;

    alerts.sort((a, b) =>
      ((weight[b.severity] ?? 0) * 10 + (typeWeight[b.type] ?? 0)) -
      ((weight[a.severity] ?? 0) * 10 + (typeWeight[a.type] ?? 0))
    );

    return new Response(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      league,
      hours,
      minBooks,
      alertCount: alerts.length,
      alerts,
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