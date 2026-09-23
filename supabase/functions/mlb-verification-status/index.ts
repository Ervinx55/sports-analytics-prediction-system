import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "GET only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const u = new URL(req.url);
    const hours = Math.max(1, Math.min(72, Number(u.searchParams.get("hours") || 24)));
    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [
      { data: games, error: gamesError },
      { data: teamGates, error: teamError },
      { data: propGates, error: propError },
    ] = await Promise.all([
      supabase
        .from("mlb_verification_latest")
        .select("*")
        .gte("checked_at", since)
        .order("starts_at", { ascending: true })
        .limit(100),
      supabase
        .from("team_market_verification_latest")
        .select("*")
        .gte("evaluated_at", since)
        .order("evaluated_at", { ascending: false })
        .limit(1000),
      supabase
        .from("player_prop_verification_latest")
        .select("*")
        .gte("evaluated_at", since)
        .order("evaluated_at", { ascending: false })
        .limit(3000),
    ]);

    if (gamesError) throw gamesError;
    if (teamError) throw teamError;
    if (propError) throw propError;

    const countBy = (rows: any[], field: string) => {
      const out: Record<string, number> = {};
      for (const r of rows) {
        const k = String(r?.[field] ?? "UNKNOWN");
        out[k] = (out[k] || 0) + 1;
      }
      return out;
    };

    const latestCheckedAt = (games ?? []).reduce((best: string | null, g: any) => {
      if (!g.checked_at) return best;
      return !best || Date.parse(g.checked_at) > Date.parse(best) ? g.checked_at : best;
    }, null);

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        version: "mlb-verification-gate-v1",
        shadowOnly: true,
        affectsDecision: false,
        refreshCadenceMinutes: 5,
        pregameCaptureWindowMinutes: 180,
        finalWindowMinutes: 20,
        latestCheckedAt,
        summary: {
          games: games?.length ?? 0,
          gameStates: countBy(games ?? [], "snapshot_state"),
          starterChanges: (games ?? []).filter((x: any) => x.starter_changed).length,
          handednessChanges: (games ?? []).filter((x: any) => x.handedness_changed).length,
          lineupChanges: (games ?? []).filter((x: any) => x.lineup_changed).length,
          catcherChanges: (games ?? []).filter((x: any) => x.catcher_changed).length,
          awayLineupsConfirmed: (games ?? []).filter((x: any) => x.away_lineup_confirmed).length,
          homeLineupsConfirmed: (games ?? []).filter((x: any) => x.home_lineup_confirmed).length,
          teamMarketGate: countBy(teamGates ?? [], "state"),
          playerPropGate: countBy(propGates ?? [], "state"),
          pitcherPropGates: (propGates ?? []).filter((x: any) => x.player_role === "PITCHER").length,
          hitterPropGates: (propGates ?? []).filter((x: any) => x.player_role === "HITTER").length,
        },
        games: (games ?? []).map((g: any) => ({
          id: g.id,
          gamePk: g.game_pk,
          eventId: g.event_id,
          startsAt: g.starts_at,
          matchup: String(g.away_team ?? "Away") + " @ " + String(g.home_team ?? "Home"),
          status: g.status_detail,
          state: g.snapshot_state,
          dataQuality: g.data_quality,
          starters: {
            away: {
              id: g.away_starter_id,
              name: g.away_starter_name,
              hand: g.away_starter_hand,
              changedAt: g.away_starter_change_at,
              handednessChangedAt: g.away_starter_hand_change_at,
            },
            home: {
              id: g.home_starter_id,
              name: g.home_starter_name,
              hand: g.home_starter_hand,
              changedAt: g.home_starter_change_at,
              handednessChangedAt: g.home_starter_hand_change_at,
            },
          },
          lineups: {
            away: {
              confirmed: g.away_lineup_confirmed,
              count: g.away_lineup_count,
              catcher: g.away_catcher_name,
              changeAt: g.away_lineup_change_at,
              catcherChangeAt: g.away_catcher_change_at,
              notableAbsences: g.away_notable_absences,
            },
            home: {
              confirmed: g.home_lineup_confirmed,
              count: g.home_lineup_count,
              catcher: g.home_catcher_name,
              changeAt: g.home_lineup_change_at,
              catcherChangeAt: g.home_catcher_change_at,
              notableAbsences: g.home_notable_absences,
            },
          },
          bullpen: {
            away: g.away_bullpen?.level ?? null,
            home: g.home_bullpen?.level ?? null,
          },
          changes: {
            starter: g.starter_changed,
            handedness: g.handedness_changed,
            lineup: g.lineup_changed,
            catcher: g.catcher_changed,
          },
          reasons: g.reasons,
          warnings: g.warnings,
        })),
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
        error: error instanceof Error ? error.message : JSON.stringify(error),
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});