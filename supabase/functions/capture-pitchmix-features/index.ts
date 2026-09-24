import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PITCHMIX_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/pitchmix";

function adminKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return String(parsed.default);
    } catch {
      // Fall through to legacy service-role key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const key = adminKey();
    if (!key) throw new Error("Supabase server secret is unavailable");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      key,
    );

    const body = await req.json().catch(() => ({}));
    const requestedGamePk = Number(body?.gamePk || 0);
    const limit = Math.max(
      1,
      Math.min(8, Number(body?.limit || 6)),
    );

    let query = supabase
      .from("player_prop_latest")
      .select("game_pk, starts_at, away_team, home_team")
      .not("game_pk", "is", null)
      .gte("starts_at", new Date().toISOString())
      .lte(
        "starts_at",
        new Date(Date.now() + 130 * 60 * 1000).toISOString(),
      )
      .order("starts_at", { ascending: true })
      .limit(250);

    if (requestedGamePk > 0) {
      query = query.eq("game_pk", requestedGamePk);
    }

    const { data, error } = await query;
    if (error) throw error;

    const games = [];
    const seen = new Set<number>();
    for (const row of data || []) {
      const gamePk = Number(row.game_pk);
      if (!gamePk || seen.has(gamePk)) continue;
      seen.add(gamePk);
      games.push({
        gamePk,
        startsAt: row.starts_at ?? null,
        awayTeam: row.away_team ?? null,
        homeTeam: row.home_team ?? null,
      });
      if (games.length >= limit) break;
    }

    const captured = [];
    const skipped = [];

    for (const game of games) {
      const r = await fetch(
        `${PITCHMIX_URL}?gamePk=${encodeURIComponent(game.gamePk)}`,
        { headers: { accept: "application/json" } },
      );
      const payload = await r.json().catch(() => ({}));

      if (!r.ok) {
        skipped.push({
          gamePk: game.gamePk,
          status: r.status,
          error: payload?.error || "pitch-mix request failed",
        });
        continue;
      }

      const away = payload?.awayOffenseVsHomeStarter || {};
      const home = payload?.homeOffenseVsAwayStarter || {};

      const row = {
        observed_at: payload?.fetchedAt || new Date().toISOString(),
        game_pk: game.gamePk,
        starts_at: game.startsAt,
        away_team: game.awayTeam,
        home_team: game.homeTeam,
        source_version: payload?.version || "Pitch Mix Matchup v1",
        lineups_confirmed: Boolean(payload?.lineupsConfirmed),
        away_available: Boolean(away?.available),
        away_starter_id: away?.starter?.id ?? null,
        away_starter_name: away?.starter?.name ?? null,
        away_arsenal_coverage: away?.arsenalCoverage ?? null,
        away_usable_usage: away?.usableUsage ?? null,
        away_weighted_xwoba_delta: away?.weightedXwobaDelta ?? null,
        away_probability_adjustment:
          away?.probabilityAdjustment ?? null,
        home_available: Boolean(home?.available),
        home_starter_id: home?.starter?.id ?? null,
        home_starter_name: home?.starter?.name ?? null,
        home_arsenal_coverage: home?.arsenalCoverage ?? null,
        home_usable_usage: home?.usableUsage ?? null,
        home_weighted_xwoba_delta: home?.weightedXwobaDelta ?? null,
        home_probability_adjustment:
          home?.probabilityAdjustment ?? null,
        raw: payload,
      };

      const { error: insertError } = await supabase
        .from("mlb_pitchmix_feature_snapshots")
        .insert(row);
      if (insertError) throw insertError;

      captured.push({
        gamePk: game.gamePk,
        observedAt: row.observed_at,
        lineupsConfirmed: row.lineups_confirmed,
        awayAvailable: row.away_available,
        homeAvailable: row.home_available,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        attempted: games.length,
        captured: captured.length,
        skipped: skipped.length,
        rows: captured,
        skips: skipped,
      }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }
});