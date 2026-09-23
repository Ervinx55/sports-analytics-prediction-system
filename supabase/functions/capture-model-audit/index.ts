import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_URL =
  "https://sports-analytics-prediction-system-tau.vercel.app/api/verify";

function chicagoDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function decimalToAmerican(d: number | null): number | null {
  if (d === null || !Number.isFinite(d) || d <= 1) return null;
  return d >= 2
    ? Math.round((d - 1) * 100)
    : Math.round(-100 / (d - 1));
}

function minOddsForTargetEv(
  winProb: number | null,
  targetEv = 0.02,
  pushProb = 0,
): number | null {
  if (
    winProb === null ||
    !Number.isFinite(winProb) ||
    winProb <= 0 ||
    winProb >= 1
  ) return null;
  const push = Math.max(0, Math.min(0.95, Number(pushProb) || 0));
  const loss = Math.max(0, 1 - winProb - push);
  const requiredDecimal = 1 + (targetEv + loss) / winProb;
  return decimalToAmerican(requiredDecimal);
}

function finalWindow(startsAt: string | null, minutes = 20) {
  const t = Date.parse(startsAt || "");
  if (!Number.isFinite(t)) return false;
  return t - Date.now() <= minutes * 60_000;
}

function pendingOrPass(startsAt: string | null) {
  return finalWindow(startsAt) ? "PASS" : "PENDING";
}

function contextReady(c: any) {
  return Boolean(
    c?.checks?.status?.passed &&
    c?.checks?.starters?.passed &&
    c?.checks?.lineups?.passed &&
    c?.checks?.weather?.passed &&
    c?.runEnvironmentAdjustment?.environment &&
    c?.bullpenAdjustment?.candidateBullpenQuality?.available &&
    c?.bullpenAdjustment?.opponentBullpenQuality?.available
  );
}

function compactRaw(c: any) {
  return {
    currentModelPrice: c.currentModelPrice ?? null,
    lineupAdjustment: c.lineupAdjustment ?? null,
    pitchMixAdjustment: c.pitchMixAdjustment ?? null,
    bullpenAdjustment: c.bullpenAdjustment ?? null,
    runEnvironmentAdjustment: c.runEnvironmentAdjustment ?? null,
  };
}

function explanationStats(c: any) {
  const lineup = c?.lineupAdjustment || {};
  const bullpen = c?.bullpenAdjustment || {};
  const pitchMix = c?.pitchMixAdjustment || {};
  const runEnv = c?.runEnvironmentAdjustment || {};

  return {
    lineup: {
      candidateWeightedOps: lineup?.candidate?.weightedLineupOps ?? null,
      candidateSeasonOps: lineup?.candidate?.teamSeasonOps ?? null,
      opponentWeightedOps: lineup?.opponent?.weightedLineupOps ?? null,
      opponentSeasonOps: lineup?.opponent?.teamSeasonOps ?? null,
      candidatePlatoonOps: lineup?.candidatePlatoon?.weightedPlatoonOps ?? null,
      opponentPlatoonOps: lineup?.opponentPlatoon?.weightedPlatoonOps ?? null,
      netAdjustmentPctPoints:
        lineup?.totalNetProbabilityAdjustmentPctPoints ?? null,
    },
    bullpen: {
      candidateQualityIndex:
        bullpen?.candidateBullpenQuality?.weightedQualityIndex ?? null,
      opponentQualityIndex:
        bullpen?.opponentBullpenQuality?.weightedQualityIndex ?? null,
      candidateHandMix:
        bullpen?.candidateBullpenQuality?.handMix ?? null,
      opponentHandMix:
        bullpen?.opponentBullpenQuality?.handMix ?? null,
      netAdjustmentPctPoints:
        bullpen?.totalBullpenProbabilityAdjustmentPctPoints ?? null,
    },
    pitchMix: {
      netAdjustmentPctPoints:
        pitchMix?.netProbabilityAdjustmentPctPoints ?? null,
      candidateArsenalCoverage:
        pitchMix?.candidateOffenseVsOpponentStarter?.arsenalCoverage ?? null,
      opponentArsenalCoverage:
        pitchMix?.opponentOffenseVsCandidateStarter?.arsenalCoverage ?? null,
      candidateWeightedXwobaDelta:
        pitchMix?.candidateOffenseVsOpponentStarter?.weightedXwobaDelta ?? null,
      opponentWeightedXwobaDelta:
        pitchMix?.opponentOffenseVsCandidateStarter?.weightedXwobaDelta ?? null,
    },
    runEnvironment: {
      parkFactor: runEnv?.environment?.parkFactor ?? null,
      venue: runEnv?.environment?.venue ?? null,
      tempF: runEnv?.environment?.weather?.tempF ?? null,
      wind: runEnv?.environment?.weather?.wind ?? null,
      roofType: runEnv?.environment?.roofType ?? null,
      projectedTotal: runEnv?.totalProjection?.projectedTotal ?? null,
      projectedAwayRuns:
        runEnv?.spreadProjection?.projectedAwayRuns ?? null,
      projectedHomeRuns:
        runEnv?.spreadProjection?.projectedHomeRuns ?? null,
      adjustmentPctPoints:
        runEnv?.probabilityAdjustmentPctPoints ?? null,
    },
    warnings: c?.warnings ?? [],
    blockers: c?.blockingReasons ?? [],
  };
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
    const date = body.date ? String(body.date) : chicagoDate();
    const startsAfter = new Date().toISOString();
    const startsBefore = new Date(Date.now() + 100 * 60_000).toISOString();
    const verifyParams = new URLSearchParams({
      date,
      includeWatch: "true",
      startsAfter,
      startsBefore,
    });

    const vr = await fetch(
      `${VERIFY_URL}?${verifyParams.toString()}`,
      { headers: { accept: "application/json" } },
    );
    const verify = await vr.json();
    if (!vr.ok) {
      throw new Error(
        `verify fetch failed: ${vr.status} ${JSON.stringify(verify).slice(0, 500)}`,
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const capturedAt = new Date().toISOString();
    const auditRows: Record<string, unknown>[] = [];
    const marketRows: Record<string, unknown>[] = [];
    const gameRepresentatives = new Map<string, any>();

    for (const c of verify.candidates ?? []) {
      const finalProbability =
        num(c?.runEnvironmentAdjustment?.finalContextProbability) ??
        num(c?.pitchMixAdjustment?.finalContextProbability) ??
        num(c?.bullpenAdjustment?.finalAdjustedModelProbability) ??
        num(c?.lineupAdjustment?.adjustedModelProbability) ??
        num(c?.currentModelPrice?.modelProbability);

      const edge =
        num(c?.runEnvironmentAdjustment?.finalContextEdgePctPoints) ??
        num(c?.pitchMixAdjustment?.finalContextEdgePctPoints) ??
        num(c?.bullpenAdjustment?.finalAdjustedEdgePctPoints) ??
        num(c?.lineupAdjustment?.adjustedEdgePctPoints) ??
        num(c?.currentModelPrice?.edgePctPoints);

      const ev =
        num(c?.runEnvironmentAdjustment?.finalContextEvPct) ??
        num(c?.pitchMixAdjustment?.finalContextEvPct) ??
        num(c?.bullpenAdjustment?.finalAdjustedEvPct) ??
        num(c?.lineupAdjustment?.adjustedEvPct) ??
        num(c?.currentModelPrice?.evPct);

      auditRows.push({
        captured_at: capturedAt,
        sport: "MLB",
        model_version: "MLB-v7.1-audit",
        verification_version: verify.version ?? "Final Verification v7.1",
        event_id: c.eventID,
        game_pk: c.mlbGamePk ?? null,
        starts_at: c.startsAt ?? null,
        away_team: c.matchup?.away ?? null,
        home_team: c.matchup?.home ?? null,
        side_key: c.sideKey,
        side_name: c.side,
        model_decision: c.modelDecision ?? null,
        verification_status: c.verificationStatus ?? null,
        best_book: c.currentModelPrice?.bestBook ?? null,
        best_odds: c.currentModelPrice?.bestOdds ?? null,
        playable_threshold:
          c.currentModelPrice?.minAcceptableOddsFor2PctEV ?? null,
        base_probability: c.currentModelPrice?.modelProbability ?? null,
        final_probability: finalProbability,
        edge_pct_points: edge,
        ev_pct: ev,
        lineup_adjustment_pp:
          c?.lineupAdjustment?.overallNetProbabilityAdjustmentPctPoints ?? 0,
        platoon_adjustment_pp:
          c?.lineupAdjustment?.platoonNetProbabilityAdjustmentPctPoints ?? 0,
        pitchmix_adjustment_pp:
          c?.pitchMixAdjustment?.netProbabilityAdjustmentPctPoints ?? 0,
        bullpen_adjustment_pp:
          c?.bullpenAdjustment?.totalBullpenProbabilityAdjustmentPctPoints ?? 0,
        runenv_adjustment_pp:
          c?.runEnvironmentAdjustment?.probabilityAdjustmentPctPoints ?? 0,
        blockers: c.blockingReasons ?? [],
        warnings: c.warnings ?? [],
        raw: compactRaw(c),
      });

      const marketFair =
        finalProbability !== null && edge !== null
          ? finalProbability - edge / 100
          : null;

      marketRows.push({
        captured_at: capturedAt,
        sport: "MLB",
        model_version: "MLB-v7.1-audit",
        event_id: c.eventID,
        game_pk: c.mlbGamePk ?? null,
        starts_at: c.startsAt ?? null,
        away_team: c.matchup?.away ?? null,
        home_team: c.matchup?.home ?? null,
        market_type: "moneyline",
        market_side: c.sideKey,
        market_label: `${c.side} ML`,
        line: null,
        best_book: c.currentModelPrice?.bestBook ?? null,
        best_odds: c.currentModelPrice?.bestOdds ?? null,
        playable_threshold:
          c.currentModelPrice?.minAcceptableOddsFor2PctEV ?? null,
        model_probability: finalProbability,
        market_fair_probability: marketFair,
        edge_pct_points: edge,
        ev_pct: ev,
        non_sharp_status: c.verificationStatus ?? "PENDING",
        requires_sharp: c.verificationStatus === "READY_FOR_SHARP_CHECK",
        reason: (c.blockingReasons ?? []).length
          ? (c.blockingReasons ?? []).join(" · ")
          : c.verificationStatus === "READY_FOR_SHARP_CHECK"
          ? "All non-sharp moneyline checks passed; waiting for sharp confirmation."
          : "Waiting for required moneyline verification inputs.",
        raw: {
          source: "verify-v7.1",
          warnings: c.warnings ?? [],
          explanationStats: explanationStats(c),
        },
      });

      if (!gameRepresentatives.has(c.eventID)) {
        gameRepresentatives.set(c.eventID, c);
      } else {
        const current = gameRepresentatives.get(c.eventID);
        if (!contextReady(current) && contextReady(c)) {
          gameRepresentatives.set(c.eventID, c);
        }
      }
    }

    for (const c of gameRepresentatives.values()) {
      const tp = c?.runEnvironmentAdjustment?.totalProjection;
      const sp = c?.runEnvironmentAdjustment?.spreadProjection;
      const ready = contextReady(c);

      if (tp) {
        const totalSides = [
          ["over", tp.over, tp.decision === "OVER_CANDIDATE"],
          ["under", tp.under, tp.decision === "UNDER_CANDIDATE"],
        ];

        for (const [side, data, selected] of totalSides as any[]) {
          let status = "PASS";
          let requiresSharp = false;
          let reason = "Total did not meet the model threshold.";

          if (tp.decision === "PENDING") {
            status = pendingOrPass(c.startsAt ?? null);
            reason =
              status === "PASS"
                ? "Required total-market information was still missing in the final pregame window."
                : "Waiting for required total-market information.";
          } else if (tp.marketSplit) {
            status = "PASS";
            reason = "PASS: books are split on the exact total number.";
          } else if (selected) {
            if (ready) {
              status = "READY_FOR_SHARP_CHECK";
              requiresSharp = true;
              reason = "Total model threshold passed; waiting for exact-line sharp confirmation.";
            } else {
              status = pendingOrPass(c.startsAt ?? null);
              reason =
                status === "PASS"
                  ? "Total candidate did not receive all required context before the final pregame window."
                  : "Total candidate is waiting for lineup/weather/bullpen context.";
            }
          }

          const p = num(data?.probability);
          marketRows.push({
            captured_at: capturedAt,
            sport: "MLB",
            model_version: "MLB-v7.1-audit",
            event_id: c.eventID,
            game_pk: c.mlbGamePk ?? null,
            starts_at: c.startsAt ?? null,
            away_team: c.matchup?.away ?? null,
            home_team: c.matchup?.home ?? null,
            market_type: "total",
            market_side: side,
            market_label: `${String(side).toUpperCase()} ${tp.marketLine ?? "—"}`,
            line: tp.marketLine ?? null,
            best_book: data?.bestBook ?? null,
            best_odds: data?.bestOdds ?? null,
            playable_threshold: minOddsForTargetEv(p, 0.02),
            model_probability: p,
            market_fair_probability: data?.marketFairProbability ?? null,
            edge_pct_points: data?.edgePctPoints ?? null,
            ev_pct: data?.evPct ?? null,
            non_sharp_status: status,
            requires_sharp: requiresSharp,
            reason,
            raw: {
              projectedTotal: tp.projectedTotal ?? null,
              differenceRuns: tp.differenceRuns ?? null,
              marketSplit: tp.marketSplit ?? null,
              decision: tp.decision ?? null,
              explanationStats: explanationStats(c),
            },
          });
        }
      }

      if (sp) {
        const spreadSides = [
          ["away", sp.away, sp.decision === "AWAY_CANDIDATE"],
          ["home", sp.home, sp.decision === "HOME_CANDIDATE"],
        ];

        for (const [side, data, selected] of spreadSides as any[]) {
          let status = "PASS";
          let requiresSharp = false;
          let reason = "Run line did not meet the model threshold.";

          if (sp.decision === "PENDING") {
            status = pendingOrPass(c.startsAt ?? null);
            reason =
              status === "PASS"
                ? "Required run-line information was still missing in the final pregame window."
                : "Waiting for required run-line information.";
          } else if (sp.marketSplit) {
            status = "PASS";
            reason = "PASS: books are split on the exact run line.";
          } else if (selected) {
            if (ready) {
              status = "READY_FOR_SHARP_CHECK";
              requiresSharp = true;
              reason = "Run-line model threshold passed; waiting for exact-line sharp confirmation.";
            } else {
              status = pendingOrPass(c.startsAt ?? null);
              reason =
                status === "PASS"
                  ? "Run-line candidate did not receive all required context before the final pregame window."
                  : "Run-line candidate is waiting for lineup/weather/bullpen context.";
            }
          }

          const p = num(data?.probability);
          const push = num(data?.pushProbability) ?? 0;
          const labelTeam =
            side === "away" ? c.matchup?.away : c.matchup?.home;
          marketRows.push({
            captured_at: capturedAt,
            sport: "MLB",
            model_version: "MLB-v7.1-audit",
            event_id: c.eventID,
            game_pk: c.mlbGamePk ?? null,
            starts_at: c.startsAt ?? null,
            away_team: c.matchup?.away ?? null,
            home_team: c.matchup?.home ?? null,
            market_type: "spread",
            market_side: side,
            market_label: `${labelTeam ?? side} ${Number(data?.line) > 0 ? "+" : ""}${data?.line ?? "—"}`,
            line: data?.line ?? null,
            best_book: data?.bestBook ?? null,
            best_odds: data?.bestOdds ?? null,
            playable_threshold: minOddsForTargetEv(p, 0.02, push),
            model_probability: p,
            market_fair_probability: data?.marketFairProbability ?? null,
            edge_pct_points: data?.edgePctPoints ?? null,
            ev_pct: data?.evPct ?? null,
            non_sharp_status: status,
            requires_sharp: requiresSharp,
            reason,
            raw: {
              projectedAwayRuns: sp.projectedAwayRuns ?? null,
              projectedHomeRuns: sp.projectedHomeRuns ?? null,
              rawPoissonProbability: data?.rawPoissonProbability ?? null,
              pushProbability: push,
              marketSplit: sp.marketSplit ?? null,
              decision: sp.decision ?? null,
              explanationStats: explanationStats(c),
            },
          });
        }
      }
    }

    if (auditRows.length) {
      const { error } = await supabase
        .from("model_audit_observations")
        .insert(auditRows);
      if (error) throw error;
    }

    if (marketRows.length) {
      const { error } = await supabase
        .from("market_grade_observations")
        .insert(marketRows);
      if (error) throw error;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        date,
        verificationVersion: verify.version ?? null,
        capturedAt,
        auditRowCount: auditRows.length,
        marketGradeRowCount: marketRows.length,
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