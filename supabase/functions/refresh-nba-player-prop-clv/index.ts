import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  clvClass,
  implied,
  latestAt,
  marketMetrics,
  num,
  openingRefs,
  quoteMatchesObservation
} from "./nba-clv.js";

const NBA_PROPS_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/nbaprops";
const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

function iso(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : null;
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000)
  });
  const raw = await response.text();
  let body: any;
  try { body = JSON.parse(raw); }
  catch { body = { error: raw.slice(0, 500) }; }
  if (!response.ok) {
    throw new Error(
      `${response.status} ${url}: ${JSON.stringify(body).slice(0, 700)}`
    );
  }
  return body;
}

function quoteRowsFromBoard(board: any, observedAt: string) {
  const rows: any[] = [];

  for (const event of board?.events ?? []) {
    for (const player of event?.players ?? []) {
      const prop = player?.prop;
      if (!prop) continue;

      for (const side of ["over", "under"]) {
        const sideObj = prop?.[side];
        if (!sideObj) continue;

        for (const [book, value] of Object.entries(sideObj?.books ?? {})) {
          const normalizedBook = String(book).toLowerCase();
          if (!BOOKS.includes(normalizedBook)) continue;
          const quote: any = value || {};

          rows.push({
            observed_at: observedAt,
            sport: "NBA",
            source: board?.oddsProvider || "NBA prop provider",
            event_id: event.eventID,
            starts_at: event.startsAt ?? null,
            away_team: event?.matchup?.away?.name ?? null,
            home_team: event?.matchup?.home?.name ?? null,
            player_id: prop?.playerID ?? null,
            player_name: prop?.playerName,
            stat_id: prop?.statID,
            market_name: prop?.marketName ?? null,
            odd_id: sideObj?.oddID ?? null,
            book: normalizedBook,
            side,
            line: num(quote?.line) ?? num(sideObj?.consensus?.line),
            odds: num(quote?.odds),
            provider_open_line: num(quote?.openLine),
            provider_open_odds: num(quote?.openOdds),
            available: quote?.available ?? true,
            source_updated_at: iso(quote?.updatedAt),
            raw: {
              consensus: sideObj?.consensus ?? null,
              provider: board?.oddsProvider ?? null
            }
          });
        }
      }
    }
  }

  return rows.filter(
    (row) =>
      row.event_id &&
      row.player_name &&
      row.stat_id &&
      row.book &&
      row.side &&
      row.line !== null
  );
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" }
      });
    }

    const body = await req.json().catch(() => ({}));
    const windowMinutes = Math.max(
      60,
      Math.min(720, Number(body?.windowMinutes || 360))
    );
    const now = new Date();
    const startsAfter = now.toISOString();
    const startsBefore = new Date(
      now.getTime() + windowMinutes * 60_000
    ).toISOString();

    const params = new URLSearchParams({
      books: BOOKS.join(","),
      limit: "100",
      startsAfter,
      startsBefore
    });

    const board = await fetchJson(
      `${NBA_PROPS_URL}?${params.toString()}`
    );
    const observedAt = new Date().toISOString();
    const quoteRows = quoteRowsFromBoard(board, observedAt);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (quoteRows.length) {
      const { error } = await supabase
        .from("player_prop_market_quotes")
        .insert(quoteRows);
      if (error) throw error;
    }

    const obsSince = new Date(
      now.getTime() - 12 * 3600_000
    ).toISOString();
    const obsUntil = new Date(
      now.getTime() + 12 * 3600_000
    ).toISOString();

    const { data: observations, error: obsError } = await supabase
      .from("player_prop_latest")
      .select("*")
      .eq("sport", "NBA")
      .gte("starts_at", obsSince)
      .lte("starts_at", obsUntil)
      .order("starts_at", { ascending: true })
      .limit(10000);

    if (obsError) throw obsError;

    const observationStarts = (observations ?? [])
      .map((row: any) => Date.parse(row?.starts_at || ""))
      .filter(Number.isFinite);

    const quoteHistory: any[] = [];
    if (observationStarts.length) {
      const historySince = new Date(
        now.getTime() - 24 * 3600_000
      ).toISOString();
      const marketStartsAfter = new Date(
        Math.min(...observationStarts) - 4 * 3600_000
      ).toISOString();
      const marketStartsBefore = new Date(
        Math.max(...observationStarts) + 4 * 3600_000
      ).toISOString();

      for (let offset = 0; offset < 50000; offset += 1000) {
        const { data: page, error } = await supabase
          .from("player_prop_market_quotes")
          .select("*")
          .eq("sport", "NBA")
          .gte("starts_at", marketStartsAfter)
          .lte("starts_at", marketStartsBefore)
          .gte("observed_at", historySince)
          .order("observed_at", { ascending: true })
          .range(offset, offset + 999);

        if (error) throw error;
        quoteHistory.push(...(page ?? []));
        if ((page ?? []).length < 1000) break;
      }
    }

    const upserts: any[] = [];

    for (const observation of observations ?? []) {
      const decisionLine = num(observation.line);
      const startsMs = Date.parse(observation.starts_at || "");
      if (
        decisionLine === null ||
        !Number.isFinite(startsMs) ||
        !observation.player_name ||
        !observation.stat_id ||
        !observation.side
      ) {
        continue;
      }

      const marketQuotes = quoteHistory.filter((quote) =>
        quoteMatchesObservation(quote, observation)
      );

      if (now.getTime() >= startsMs && marketQuotes.length === 0) {
        continue;
      }

      const openRows = openingRefs(marketQuotes);
      const open = marketMetrics(
        openRows,
        decisionLine,
        observation.side,
        observation.best_book ?? null
      );

      const cutoffMs = Math.min(now.getTime(), startsMs);
      const currentRows = latestAt(marketQuotes, cutoffMs);
      const current = marketMetrics(
        currentRows,
        decisionLine,
        observation.side,
        observation.best_book ?? null
      );

      const finalized = now.getTime() >= startsMs;
      const close = finalized ? current : null;
      const closeAt = close?.quoteAt
        ? Date.parse(close.quoteAt)
        : NaN;
      const closeAge =
        finalized && Number.isFinite(closeAt)
          ? Math.max(0, (startsMs - closeAt) / 60000)
          : null;

      const decisionImp = implied(observation.best_odds);

      const lineMoveOpenCurrent =
        open.consensusLine !== null &&
        current.consensusLine !== null
          ? Number(
              (
                current.consensusLine -
                open.consensusLine
              ).toFixed(3)
            )
          : null;

      const lineMoveOpenClose =
        finalized &&
        open.consensusLine !== null &&
        close?.consensusLine !== null
          ? Number(
              (
                close.consensusLine -
                open.consensusLine
              ).toFixed(3)
            )
          : null;

      let lineClv: number | null = null;
      if (
        finalized &&
        close?.consensusLine !== null
      ) {
        lineClv =
          observation.side === "over"
            ? close.consensusLine - decisionLine
            : decisionLine - close.consensusLine;
        lineClv = Number(lineClv.toFixed(3));
      }

      const fairClv =
        finalized &&
        close?.marketFair !== null &&
        num(observation.market_fair_probability) !== null
          ? Number(
              (
                (close.marketFair -
                  Number(observation.market_fair_probability)) *
                100
              ).toFixed(3)
            )
          : null;

      const sameCloseImp = finalized
        ? implied(close?.sameBookOdds)
        : null;
      const sameBookClv =
        decisionImp !== null && sameCloseImp !== null
          ? Number(
              (
                (sameCloseImp - decisionImp) *
                100
              ).toFixed(3)
            )
          : null;

      const bestCloseImp = finalized
        ? implied(close?.bestOdds)
        : null;
      const bestClv =
        decisionImp !== null && bestCloseImp !== null
          ? Number(
              (
                (bestCloseImp - decisionImp) *
                100
              ).toFixed(3)
            )
          : null;

      upserts.push({
        observation_id: Number(observation.id),
        sport: "NBA",
        refreshed_at: new Date().toISOString(),
        finalized_at: finalized ? new Date().toISOString() : null,
        finalized,
        event_id: observation.event_id,
        game_pk: null,
        starts_at: observation.starts_at,
        player_id: observation.player_id ?? null,
        player_name: observation.player_name,
        stat_id: observation.stat_id,
        label: observation.label ?? null,
        side: observation.side,
        decision_line: decisionLine,
        decision_book: observation.best_book ?? null,
        decision_odds: observation.best_odds ?? null,
        decision_implied_probability: decisionImp,
        decision_market_fair_probability:
          num(observation.market_fair_probability),

        opening_consensus_line: open.consensusLine,
        opening_best_odds_at_decision_line: open.bestOdds,
        opening_market_fair_probability: open.marketFair,

        current_consensus_line: current.consensusLine,
        current_best_odds_at_decision_line: current.bestOdds,
        current_same_book_odds: current.sameBookOdds,
        current_market_fair_probability: current.marketFair,
        current_quote_at: current.quoteAt,

        closing_consensus_line:
          finalized ? close?.consensusLine : null,
        closing_best_odds_at_decision_line:
          finalized ? close?.bestOdds : null,
        closing_same_book_odds:
          finalized ? close?.sameBookOdds : null,
        closing_market_fair_probability:
          finalized ? close?.marketFair : null,
        close_quote_at:
          finalized ? close?.quoteAt : null,
        close_quote_age_minutes: closeAge,
        close_book_count:
          finalized ? close?.bookCount ?? 0 : 0,
        close_paired_books:
          finalized ? close?.pairedBooks ?? 0 : 0,

        line_move_open_to_current: lineMoveOpenCurrent,
        line_move_open_to_close: lineMoveOpenClose,
        line_clv_units: lineClv,
        fair_probability_clv_pp: fairClv,
        same_book_price_clv_pp: sameBookClv,
        best_market_price_clv_pp: bestClv,

        clv_classification: clvClass(
          finalized,
          close,
          lineClv,
          fairClv,
          sameBookClv,
          closeAge
        ),
        raw: {
          evaluatorVersion: "nba-player-prop-clv-v1",
          source: "own pregame NBA prop snapshots only",
          books: BOOKS,
          openingBookCount: open.bookCount,
          openingPairedBooks: open.pairedBooks,
          currentBookCount: current.bookCount,
          currentPairedBooks: current.pairedBooks,
          oddsProvider: board?.oddsProvider ?? null
        }
      });
    }

    if (upserts.length) {
      for (let i = 0; i < upserts.length; i += 500) {
        const { error } = await supabase
          .from("player_prop_clv")
          .upsert(upserts.slice(i, i + 500), {
            onConflict: "observation_id"
          });
        if (error) throw error;
      }
    }

    const classifications = upserts.reduce(
      (out: Record<string, number>, row: any) => {
        const key = row.clv_classification || "UNKNOWN";
        out[key] = (out[key] || 0) + 1;
        return out;
      },
      {}
    );

    return new Response(JSON.stringify({
      ok: true,
      version: "nba-player-prop-clv-v1",
      observedAt,
      windowMinutes,
      capturedQuotes: quoteRows.length,
      trackedObservations: upserts.length,
      finalized: upserts.filter((row) => row.finalized).length,
      classifications
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
