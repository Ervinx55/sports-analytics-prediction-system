import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const NBA_PROPS_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/nbaprops";

const SUPPORTED_STATS = new Set([
  "points",
  "rebounds",
  "assists",
  "threes_made",
  "blocks",
  "steals",
  "turnovers",
  "blocks_steals",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists",
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

function defaultWindow(hours = 48) {
  const now = Date.now();
  return {
    startsAfter: new Date(now - 30 * 60_000).toISOString(),
    startsBefore: new Date(now + hours * 60 * 60_000).toISOString(),
  };
}

function quoteRows(model: any, capturedAt: string) {
  const provider =
    text(model?.oddsProvider) ||
    text(model?.sourceHealth?.odds?.source) ||
    "unknown";
  const rows: any[] = [];

  for (const event of model?.events || []) {
    for (const player of event?.players || []) {
      const prop = player?.prop;
      if (!prop || !SUPPORTED_STATS.has(String(prop?.statID || ""))) continue;

      for (const side of ["over", "under"]) {
        const sideRow = prop?.[side];
        if (!sideRow) continue;

        for (const [book, price] of Object.entries(sideRow?.books || {})) {
          const quote: any = price || {};
          rows.push({
            observed_at: capturedAt,
            sport: "NBA",
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
              modelVersion: model?.version ?? null,
              injury: player?.injury ?? null,
              projection: player?.projection ?? null,
              providerFailures: model?.providerFailures ?? [],
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
      row.side &&
      row.line !== null,
  );
}

function observationRows(model: any, capturedAt: string) {
  const candidates = Array.isArray(model?.candidates) ? model.candidates : [];

  return candidates
    .filter((candidate: any) =>
      SUPPORTED_STATS.has(String(candidate?.statID || ""))
    )
    .map((candidate: any) => {
      const label = [
        candidate?.playerName,
        candidate?.statID,
        candidate?.side,
        candidate?.line,
        candidate?.book ? `@${candidate.book}` : null,
      ].filter((value) => value !== null && value !== undefined).join(" ");

      return {
        captured_at: capturedAt,
        sport: "NBA",
        model_version: model?.version ?? "NBA Player Props v1.1-shadow",
        event_id: candidate?.eventID,
        game_pk: null,
        starts_at: candidate?.startsAt ?? null,
        away_team: candidate?.away ?? null,
        home_team: candidate?.home ?? null,
        player_id: candidate?.playerID ?? null,
        mlb_player_id: null,
        player_name: candidate?.playerName,
        stat_id: candidate?.statID,
        market_name: candidate?.marketName ?? candidate?.statID ?? null,
        line: num(candidate?.line),
        side: candidate?.side ?? null,
        label,
        model_mean: num(candidate?.projectionMean),
        raw_independent_probability:
          num(candidate?.rawIndependentProbability),
        model_probability:
          num(candidate?.shadowModelProbability),
        push_probability: null,
        market_fair_probability:
          num(candidate?.marketFairProbability),
        edge_pct_points: num(candidate?.edgePct),
        best_book: candidate?.book ?? null,
        best_odds: num(candidate?.odds),
        exact_line_book_count:
          Number(candidate?.exactLineBookCount || 0),
        paired_books:
          Number(candidate?.exactLineBookCount || 0),
        ev_pct: num(candidate?.evPct),
        data_quality: num(candidate?.dataQuality),
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
          oddsProvider: model?.oddsProvider ?? null,
          productionStatus: candidate?.status ?? "PASS",
          shadowStatus: candidate?.shadowStatus ?? null,
          productionEligible:
            candidate?.productionEligible ?? model?.productionEligible ?? false,
          productionWeight:
            candidate?.productionWeight ?? model?.productionWeight ?? 0,
          rawProjectionMean:
            candidate?.rawProjectionMean ?? null,
          contextChallengerMean:
            candidate?.contextChallengerMean ?? null,
          contextSignal:
            candidate?.contextSignal ?? null,
          contextShadowWeight:
            candidate?.contextShadowWeight ?? 0,
          gameContext:
            candidate?.gameContext ?? null,
          projectionSd: candidate?.projectionSd ?? null,
          projectedMinutes: candidate?.projectedMinutes ?? null,
          historyGames: candidate?.historyGames ?? null,
          injury: candidate?.injury ?? null,
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
      Math.max(1, Math.min(168, Number(body?.hours || 48) || 48)),
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
      `${NBA_PROPS_URL}?${params.toString()}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const model = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `NBA props model failed: ${response.status} ${JSON.stringify(model).slice(0, 700)}`,
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
