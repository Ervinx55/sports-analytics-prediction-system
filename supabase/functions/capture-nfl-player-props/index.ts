import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const NFL_PROPS_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/nflprops";

const SUPPORTED_STATS = new Set([
  "passing_yards",
  "passing_touchdowns",
  "rushing_yards",
  "receiving_receptions",
  "receiving_yards",
]);

function num(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function chunk<T>(rows: T[], size = 500) {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

function defaultWindow(hours = 168) {
  const now = Date.now();
  return {
    startsAfter: new Date(now - 30 * 60_000).toISOString(),
    startsBefore: new Date(now + hours * 60 * 60_000).toISOString(),
  };
}

function exactLineBookCount(candidates: any[], candidate: any) {
  const books = new Set(
    candidates
      .filter(
        (row) =>
          row?.eventID === candidate?.eventID &&
          row?.playerID === candidate?.playerID &&
          row?.playerName === candidate?.playerName &&
          row?.statID === candidate?.statID &&
          row?.side === candidate?.side &&
          num(row?.line) === num(candidate?.line),
      )
      .map((row) => text(row?.book))
      .filter(Boolean),
  );
  return books.size;
}

function projectionIndex(events: any[]) {
  const index = new Map<string, any>();
  for (const event of events || []) {
    for (const player of event?.players || []) {
      const playerName = text(player?.prop?.playerName);
      const playerId = text(player?.prop?.playerID);
      const statId = text(player?.prop?.statID);
      if (!playerName || !statId) continue;
      const key = [
        text(event?.eventID) || "",
        playerId || playerName.toLowerCase(),
        statId,
      ].join("|");
      index.set(key, {
        projection: player?.opportunity?.projections?.[statId] ?? null,
        position: text(player?.opportunity?.player?.position),
        opportunity: player?.opportunity ?? null,
      });
    }
  }
  return index;
}

function quoteRows(model: any, capturedAt: string) {
  const provider =
    text(model?.oddsProvider) ||
    text(model?.sourceHealth?.provider?.source) ||
    "unknown";
  const rows: any[] = [];

  for (const event of model?.events || []) {
    for (const player of event?.players || []) {
      const prop = player?.prop;
      if (!prop || !SUPPORTED_STATS.has(String(prop.statID || ""))) continue;

      for (const side of ["over", "under"]) {
        const sideRow = prop?.[side];
        if (!sideRow) continue;
        for (const [book, price] of Object.entries(sideRow?.books || {})) {
          const quote: any = price || {};
          rows.push({
            observed_at: capturedAt,
            sport: "NFL",
            source: provider,
            event_id: event?.eventID,
            starts_at: event?.startsAt ?? null,
            away_team: event?.matchup?.away?.name ?? null,
            home_team: event?.matchup?.home?.name ?? null,
            player_id: prop?.playerID ?? null,
            player_name: prop?.playerName,
            stat_id: prop?.statID,
            market_name: prop?.marketName ?? null,
            odd_id: sideRow?.oddID ?? null,
            book,
            side,
            line: num(quote?.line) ?? num(sideRow?.consensus?.line),
            odds: num(quote?.odds),
            provider_open_line: num(quote?.openLine),
            provider_open_odds: num(quote?.openOdds),
            available: quote?.available ?? true,
            source_updated_at: quote?.updatedAt ?? null,
            raw: {
              provider,
              consensus: sideRow?.consensus ?? null,
              providerFailures: model?.providerFailures ?? [],
              modelVersion: model?.version ?? null,
              playerPosition: player?.opportunity?.player?.position ?? null,
            },
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
      row.side,
  );
}

function observationRows(model: any, capturedAt: string) {
  const candidates = Array.isArray(model?.candidates) ? model.candidates : [];
  const projections = projectionIndex(model?.events || []);
  const provider =
    text(model?.oddsProvider) ||
    text(model?.sourceHealth?.provider?.source) ||
    "unknown";

  return candidates
    .filter((candidate: any) =>
      SUPPORTED_STATS.has(String(candidate?.statID || ""))
    )
    .map((candidate: any) => {
      const playerKey =
        text(candidate?.playerID) ||
        String(candidate?.playerName || "").toLowerCase();
      const projectionMeta = projections.get(
        [
          text(candidate?.eventID) || "",
          playerKey,
          text(candidate?.statID) || "",
        ].join("|"),
      );
      const bookCount = exactLineBookCount(candidates, candidate);
      const line = num(candidate?.line);
      const side = text(candidate?.side);
      const label = [
        candidate?.playerName,
        candidate?.statID,
        side,
        line,
        candidate?.book ? `@${candidate.book}` : null,
      ].filter((value) => value !== null && value !== undefined).join(" ");

      return {
        captured_at: capturedAt,
        sport: "NFL",
        model_version: model?.version ?? "NFL Player Props v2-shadow",
        event_id: candidate?.eventID,
        game_pk: null,
        starts_at: candidate?.startsAt ?? null,
        away_team: candidate?.away ?? null,
        home_team: candidate?.home ?? null,
        player_id: candidate?.playerID ?? null,
        mlb_player_id: null,
        player_name: candidate?.playerName,
        stat_id: candidate?.statID,
        market_name: candidate?.statID,
        line,
        side,
        label,
        model_mean: num(projectionMeta?.projection?.mean),
        raw_independent_probability:
          num(candidate?.rawIndependentProbability),
        model_probability:
          num(candidate?.shadowModelProbability),
        push_probability: num(candidate?.pushProbability),
        market_fair_probability:
          num(candidate?.marketFairProbability),
        edge_pct_points: num(candidate?.edgePct),
        best_book: candidate?.book ?? null,
        best_odds: num(candidate?.odds),
        exact_line_book_count: bookCount,
        paired_books: bookCount,
        ev_pct: num(candidate?.evPct),
        data_quality: null,
        status: candidate?.shadowStatus ?? candidate?.status ?? "PASS",
        reason: candidate?.reason ?? null,
        tf_shadow_model_version: null,
        tf_shadow_probability: null,
        tf_shadow_ensemble_probability: null,
        tf_shadow_production_weight: null,
        tf_shadow_selected_validation_weight: null,
        tf_shadow_eligible_for_production: null,
        tf_shadow_affects_decision: false,
        raw: {
          oddsProvider: provider,
          productionStatus: candidate?.status ?? "PASS",
          shadowStatus: candidate?.shadowStatus ?? null,
          dataQualityLabel: candidate?.dataQuality ?? null,
          playerPosition: projectionMeta?.position ?? null,
          productionEligible:
            candidate?.productionEligible ?? model?.productionEligible ?? false,
          productionWeight:
            candidate?.productionWeight ?? model?.productionWeight ?? 0,
          residualWeight:
            projectionMeta?.projection?.residualWeight ?? null,
          baselineMean:
            projectionMeta?.projection?.baselineMean ?? null,
          opportunityMean:
            projectionMeta?.projection?.opportunityMean ?? null,
          providerFailures: model?.providerFailures ?? [],
        },
      };
    })
    .filter(
      (row: any) =>
        row.event_id &&
        row.player_name &&
        row.stat_id &&
        row.side &&
        row.line !== null,
    );
}

async function insertChunks(
  supabase: ReturnType<typeof createClient>,
  table: string,
  rows: any[],
) {
  let inserted = 0;
  for (const batch of chunk(rows)) {
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw error;
    inserted += batch.length;
  }
  return inserted;
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
    const window = defaultWindow(
      Math.max(1, Math.min(168, Number(body?.hours || 168) || 168)),
    );
    const startsAfter = body?.startsAfter
      ? String(body.startsAfter)
      : window.startsAfter;
    const startsBefore = body?.startsBefore
      ? String(body.startsBefore)
      : window.startsBefore;
    const season = Number(body?.season || 0);

    const params = new URLSearchParams({
      startsAfter,
      startsBefore,
    });
    if (Number.isFinite(season) && season > 0) {
      params.set("season", String(Math.floor(season)));
    }

    const response = await fetch(
      `${NFL_PROPS_URL}?${params.toString()}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
      },
    );
    const model = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `NFL props model failed: ${response.status} ${JSON.stringify(model).slice(0, 700)}`,
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const capturedAt = new Date().toISOString();
    const quotes = quoteRows(model, capturedAt);
    const observations = observationRows(model, capturedAt);

    const quoteCount = await insertChunks(
      supabase,
      "player_prop_market_quotes",
      quotes,
    );
    const observationCount = await insertChunks(
      supabase,
      "player_prop_observations",
      observations,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        capturedAt,
        modelVersion: model?.version ?? null,
        oddsProvider: model?.oddsProvider ?? null,
        providerFailures: model?.providerFailures ?? [],
        startsAfter,
        startsBefore,
        eventCount: model?.eventCount ?? model?.events?.length ?? 0,
        quoteCount,
        observationCount,
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
