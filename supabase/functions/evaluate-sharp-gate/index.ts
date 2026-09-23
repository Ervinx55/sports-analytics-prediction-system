import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SOURCE_WEIGHTS: Record<string, number> = {
  pinnacle: 0.45,
  circa: 0.35,
  bookmaker: 0.20,
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function americanToProb(odds: unknown): number | null {
  const o = num(odds);
  if (o === null || o === 0) return null;
  return o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100);
}

function noVig(candidateOdds: unknown, opponentOdds: unknown) {
  const a = americanToProb(candidateOdds);
  const b = americanToProb(opponentOdds);
  if (a === null || b === null) return null;
  const hold = a + b;
  if (!(hold > 0)) return null;
  return { fairProbability: a / hold, hold };
}

function minutesUntil(startsAt: unknown) {
  const t = Date.parse(String(startsAt || ""));
  if (!Number.isFinite(t)) return null;
  return (t - Date.now()) / 60000;
}

function freshnessMinutes(updatedAt: unknown) {
  if (!updatedAt) return null;
  const t = Date.parse(String(updatedAt));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 60000);
}

function priceIsPlayable(current: number | null, threshold: number | null) {
  if (current === null || threshold === null) return false;
  return current >= threshold;
}

function sourceLabel(name: string) {
  return name === "bookmaker" ? "BookMaker" : name === "pinnacle" ? "Pinnacle" : "Circa";
}

function evaluateSource(
  name: string,
  source: any,
  marketType: string,
  marketLine: number | null,
) {
  const result: any = {
    name,
    label: sourceLabel(name),
    valid: false,
    fresh: false,
    status: "unavailable",
    fairProbability: null,
    hold: null,
    candidateOdds: num(source?.candidateOdds),
    opponentOdds: num(source?.opponentOdds),
    line: num(source?.line),
    updatedAt: source?.updatedAt ?? null,
    provider: source?.provider ?? null,
    freshnessMinutes: freshnessMinutes(source?.updatedAt),
  };

  if (!source) return result;
  if (source?.status && /reject|invalid|unavailable|missing/i.test(String(source.status))) {
    result.status = String(source.status);
    return result;
  }

  if (result.candidateOdds === null || result.opponentOdds === null) {
    result.status = "missing two-sided price";
    return result;
  }

  if (marketType !== "moneyline") {
    if (marketLine === null || result.line === null) {
      result.status = "missing exact line";
      return result;
    }
    if (Math.abs(result.line - marketLine) > 0.001) {
      result.status = "rejected: exact line mismatch";
      return result;
    }
  }

  const nv = noVig(result.candidateOdds, result.opponentOdds);
  if (!nv) {
    result.status = "rejected: invalid two-sided quote";
    return result;
  }

  result.hold = nv.hold;
  if (nv.hold < 0.985 || nv.hold > 1.15) {
    result.status = "rejected: internally inconsistent two-sided quote";
    return result;
  }

  result.fairProbability = nv.fairProbability;

  if (result.freshnessMinutes !== null && result.freshnessMinutes > 90) {
    result.status = "rejected: stale price";
    return result;
  }

  result.valid = true;
  result.fresh =
    result.freshnessMinutes !== null && result.freshnessMinutes <= 30;
  result.status = result.fresh
    ? "valid fresh exact price"
    : result.freshnessMinutes === null
      ? "valid price; freshness unknown"
      : "valid price; older than 30 minutes";
  return result;
}

function weightedConsensus(sources: any[]) {
  const valid = sources.filter((s) => s.valid && Number.isFinite(s.fairProbability));
  if (!valid.length) return null;
  let weighted = 0;
  let totalWeight = 0;
  for (const s of valid) {
    const base = SOURCE_WEIGHTS[s.name] || 0.1;
    const freshnessFactor = s.fresh ? 1 : s.freshnessMinutes === null ? 0.75 : 0.65;
    const w = base * freshnessFactor;
    weighted += s.fairProbability * w;
    totalWeight += w;
  }
  return totalWeight ? weighted / totalWeight : null;
}

function qualityScore(sources: any[], spreadPp: number | null) {
  const valid = sources.filter((s) => s.valid);
  const fresh = valid.filter((s) => s.fresh);
  const validCount = valid.length;
  if (!validCount) return 0.05;

  const coverage = (validCount / 3) * 0.40;
  const freshness = (fresh.length / validCount) * 0.20;
  const hierarchy = valid.reduce(
    (sum, s) => sum + (SOURCE_WEIGHTS[s.name] || 0),
    0,
  ) * 0.10;

  let agreement = 0.05;
  if (validCount >= 2 && spreadPp !== null) {
    agreement = Math.max(0, 1 - spreadPp / 6) * 0.20;
  }

  const exactLineIntegrity = 0.10;
  return Math.max(
    0,
    Math.min(1, coverage + freshness + hierarchy + agreement + exactLineIntegrity),
  );
}

function legacySideOdds(
  marketType: string,
  marketSide: string,
  src: any,
) {
  if (!src?.valid && src?.candidateOdds === null && src?.opponentOdds === null) {
    return { away: null, home: null };
  }
  if (marketType === "moneyline" || marketType === "spread") {
    if (marketSide === "home") {
      return { home: src?.candidateOdds ?? null, away: src?.opponentOdds ?? null };
    }
    if (marketSide === "away") {
      return { away: src?.candidateOdds ?? null, home: src?.opponentOdds ?? null };
    }
  }
  return { away: null, home: null };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const body = await req.json();
    const candidate = body?.candidate || {};
    const marketType = String(candidate.marketType || "moneyline").toLowerCase();
    const marketSide = String(candidate.marketSide || candidate.sideKey || "");
    const marketLine = num(candidate.marketLine);
    const modelProbability = num(candidate.modelProbability);
    const mainstreamOdds = num(candidate.mainstreamOdds);
    const playableThreshold = num(candidate.playableThreshold);
    const nonSharpStatus = String(
      candidate.verificationStatus || candidate.nonSharpStatus || "READY_FOR_SHARP_CHECK",
    );

    if (!candidate.eventId || modelProbability === null || !marketSide) {
      return new Response(
        JSON.stringify({ error: "candidate.eventId, marketSide, and modelProbability are required" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    const sources = ["pinnacle", "circa", "bookmaker"].map((name) =>
      evaluateSource(name, body?.sources?.[name], marketType, marketLine)
    );
    const valid = sources.filter((s) => s.valid);
    const fresh = valid.filter((s) => s.fresh);
    const consensus = weightedConsensus(sources);
    const probabilities = valid.map((s) => Number(s.fairProbability));
    const spreadPp =
      probabilities.length >= 2
        ? (Math.max(...probabilities) - Math.min(...probabilities)) * 100
        : null;
    const quality = qualityScore(sources, spreadPp);
    const modelVsSharp =
      consensus === null ? null : (modelProbability - consensus) * 100;
    const priceOk = priceIsPlayable(mainstreamOdds, playableThreshold);
    const mins = minutesUntil(candidate.startsAt);
    const finalWindow = mins !== null && mins <= 20;
    const sourceNames = valid.map((s) => s.label);
    const rejected = sources
      .filter((s) => !s.valid)
      .map((s) => `${s.label}: ${s.status}`);

    let finalStatus = "PENDING";
    let gateMode = "NO_VALID_SHARP_DATA";
    let reason = "";

    if (nonSharpStatus !== "READY_FOR_SHARP_CHECK") {
      finalStatus = nonSharpStatus === "PASS" ? "PASS" : "PENDING";
      gateMode = "NON_SHARP_NOT_READY";
      reason = "The wager has not cleared the non-sharp model/context gate.";
    } else if (!valid.length) {
      gateMode = "NO_VALID_SHARP_DATA";
      finalStatus = finalWindow ? "PASS" : "PENDING";
      reason = finalWindow
        ? "No valid sharp price was available before the final pregame deadline."
        : "Non-sharp checks passed; waiting for a valid sharp price.";
    } else if (valid.length >= 2) {
      gateMode = valid.length === 3
        ? "FULL_SHARP_CONSENSUS"
        : "DUAL_SHARP_CONSENSUS";

      if (spreadPp !== null && spreadPp > 4.0) {
        gateMode = "SHARP_DISAGREEMENT";
        finalStatus = finalWindow ? "PASS" : "PENDING";
        reason =
          `Sharp sources disagree by ${spreadPp.toFixed(2)} pp, above the 4.00 pp agreement limit.`;
      } else if (!priceOk) {
        finalStatus = "PASS";
        gateMode = "PRICE_FAILED";
        reason =
          `Sharp confirmation is usable, but the mainstream price ${mainstreamOdds ?? "—"} is worse than the playable threshold ${playableThreshold ?? "—"}.`;
      } else if (modelVsSharp === null || modelVsSharp < 1.0) {
        finalStatus = "PASS";
        gateMode = "SHARP_EDGE_FAILED";
        reason =
          `Sharp consensus does not confirm enough model edge; model vs sharp is ${modelVsSharp === null ? "unavailable" : modelVsSharp.toFixed(2) + " pp"}, below +1.00 pp.`;
      } else if (quality < 0.65) {
        finalStatus = finalWindow ? "PASS" : "PENDING";
        gateMode = "LOW_SHARP_DATA_QUALITY";
        reason =
          `Sharp prices exist, but data quality is only ${quality.toFixed(2)}; waiting for fresher or more complete confirmation.`;
      } else {
        finalStatus = "FINAL_PLAY";
        reason =
          `${sourceNames.join(" + ")} consensus supports the wager: model ${(modelProbability * 100).toFixed(1)}% vs sharp ${(consensus! * 100).toFixed(1)}% (${modelVsSharp.toFixed(2)} pp), with data quality ${quality.toFixed(2)}.`;
      }
    } else {
      const only = valid[0];
      const topSharpFallback =
        only.fresh &&
        (only.name === "pinnacle" || only.name === "circa") &&
        priceOk &&
        modelVsSharp !== null &&
        modelVsSharp >= 3.0 &&
        quality >= 0.50;

      const bookmakerDirectFallback =
        only.fresh &&
        only.name === "bookmaker" &&
        only.provider === "bookmaker_direct_csv" &&
        priceOk &&
        modelVsSharp !== null &&
        modelVsSharp >= 5.0 &&
        quality >= 0.50;

      const fallbackEligible = topSharpFallback || bookmakerDirectFallback;

      gateMode = topSharpFallback
        ? "SINGLE_TOP_SHARP_FALLBACK"
        : bookmakerDirectFallback
          ? "SINGLE_BOOKMAKER_DIRECT_FALLBACK"
          : "SINGLE_SOURCE_PENDING";

      if (!finalWindow) {
        finalStatus = "PENDING";
        reason =
          `${only.label} supports a ${modelVsSharp === null ? "pending" : modelVsSharp.toFixed(2) + " pp"} model-vs-sharp edge, but only one valid sharp source is available. Waiting for a second source before the final window.`;
      } else if (fallbackEligible) {
        finalStatus = "FINAL_PLAY";
        reason =
          `Single-source fallback cleared at the deadline: fresh ${only.label} ${only.provider === "bookmaker_direct_csv" ? "direct official-board " : ""}price supports a strong ${modelVsSharp!.toFixed(2)} pp model edge, the playable price is intact, and sharp data quality is ${quality.toFixed(2)}.`;
      } else {
        finalStatus = "PASS";
        reason =
          `Only one valid sharp source was available by the final deadline and it did not meet the strict single-source fallback requirements.`;
      }
    }

    if (rejected.length) {
      reason += ` Other source status: ${rejected.join("; ")}.`;
    }

    const byName = Object.fromEntries(sources.map((s) => [s.name, s]));
    const bmOdds = legacySideOdds(marketType, marketSide, byName.bookmaker);
    const pinOdds = legacySideOdds(marketType, marketSide, byName.pinnacle);
    const circaOdds = legacySideOdds(marketType, marketSide, byName.circa);

    const row = {
      checked_at: new Date().toISOString(),
      sport: String(candidate.sport || "MLB").toUpperCase(),
      event_id: String(candidate.eventId),
      game_pk: num(candidate.gamePk),
      starts_at: candidate.startsAt ?? null,
      away_team: candidate.awayTeam ?? null,
      home_team: candidate.homeTeam ?? null,
      side_key: candidate.sideKey ?? marketSide,
      side_name: candidate.sideName ?? null,
      verification_status: nonSharpStatus,
      mainstream_book: candidate.mainstreamBook ?? null,
      mainstream_odds: mainstreamOdds,
      playable_threshold: playableThreshold,
      model_probability: modelProbability,

      bookmaker_away_odds: bmOdds.away,
      bookmaker_home_odds: bmOdds.home,
      bookmaker_candidate_fair_probability: byName.bookmaker?.fairProbability ?? null,
      bookmaker_freshness: byName.bookmaker?.updatedAt ?? null,

      pinnacle_away_odds: pinOdds.away,
      pinnacle_home_odds: pinOdds.home,
      pinnacle_candidate_fair_probability: byName.pinnacle?.fairProbability ?? null,
      pinnacle_status: byName.pinnacle?.status ?? "unavailable",
      pinnacle_freshness: byName.pinnacle?.updatedAt ?? null,

      circa_away_odds: circaOdds.away,
      circa_home_odds: circaOdds.home,
      circa_candidate_fair_probability: byName.circa?.fairProbability ?? null,
      circa_status: byName.circa?.status ?? "unavailable",
      circa_freshness: byName.circa?.updatedAt ?? null,

      model_vs_bookmaker_pp:
        byName.bookmaker?.fairProbability == null
          ? null
          : Number(((modelProbability - byName.bookmaker.fairProbability) * 100).toFixed(4)),
      sharp_disagreement_pp:
        spreadPp === null ? null : Number(spreadPp.toFixed(4)),
      price_ok: priceOk,
      second_source_ok: valid.length >= 2,
      final_status: finalStatus,
      reason,
      raw: {
        evaluatorVersion: "sharp-gate-v2",
        finalWindow,
        minutesUntilStart: mins,
        sourceWeights: SOURCE_WEIGHTS,
        sources: byName,
      },
      market_type: marketType,
      market_side: marketSide,
      market_line: marketLine,

      sharp_consensus_probability:
        consensus === null ? null : Number(consensus.toFixed(6)),
      valid_sharp_source_count: valid.length,
      fresh_sharp_source_count: fresh.length,
      sharp_data_quality: Number(quality.toFixed(4)),
      sharp_consensus_spread_pp:
        spreadPp === null ? null : Number(spreadPp.toFixed(4)),
      model_vs_sharp_pp:
        modelVsSharp === null ? null : Number(modelVsSharp.toFixed(4)),
      gate_mode: gateMode,
      source_summary: Object.fromEntries(
        sources.map((s) => [
          s.name,
          {
            status: s.status,
            valid: s.valid,
            fresh: s.fresh,
            fairProbability:
              s.fairProbability == null ? null : Number(s.fairProbability.toFixed(6)),
            freshnessMinutes:
              s.freshnessMinutes == null ? null : Number(s.freshnessMinutes.toFixed(1)),
          },
        ]),
      ),
    };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("sharp_gate_history")
      .insert(row)
      .select("*")
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({
        ok: true,
        evaluatorVersion: "sharp-gate-v2",
        result: data,
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
