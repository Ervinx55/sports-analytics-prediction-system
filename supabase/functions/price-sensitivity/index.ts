import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((s,x)=>s+x,0)/xs.length : null;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "GET only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const sport = (url.searchParams.get("sport") || "MLB").toUpperCase();
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") || 90)));
    const hours = Math.max(1, Math.min(72, Number(url.searchParams.get("hours") || 36)));
    const sinceDays = new Date(Date.now() - days * 86400_000).toISOString();
    const sinceHours = new Date(Date.now() - hours * 3600_000).toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [
      { data: policies, error: policyError },
      { data: current, error: currentError },
      { data: waits, error: waitError },
    ] = await Promise.all([
      supabase
        .from("market_policy_registry")
        .select("policy_id,policy_family,display_name,market_type,config,shadow_only,affects_decision")
        .eq("active", true)
        .order("market_type", { ascending: true })
        .order("policy_family", { ascending: true }),
      supabase
        .from("market_price_sensitivity_latest")
        .select("*")
        .eq("sport", sport)
        .gte("source_captured_at", sinceHours)
        .order("starts_at", { ascending: true })
        .limit(1000),
      supabase
        .from("market_price_wait_analysis")
        .select("*")
        .eq("sport", sport)
        .gte("starts_at", sinceDays)
        .order("starts_at", { ascending: false })
        .limit(5000),
    ]);

    if (policyError) throw new Error("policy query failed: " + JSON.stringify(policyError));
    if (currentError) throw new Error("current query failed: " + JSON.stringify(currentError));
    if (waitError) throw new Error("wait query failed: " + JSON.stringify(waitError));

    const policyMap = new Map((policies ?? []).map((p:any) => [p.policy_id, p]));
    const enrich = (r:any) => ({
      ...r,
      policy: policyMap.get(r.policy_id) ?? null,
    });

    const currentRows = (current ?? []).map(enrich);
    const balancedCurrent = currentRows.filter(
      (r:any) => r.policy?.policy_family === "BALANCED",
    );

    const summarizeCurrent = (xs:any[]) => ({
      markets: xs.length,
      buy: xs.filter((r:any)=>r.state === "BUY").length,
      hold: xs.filter((r:any)=>r.state === "HOLD").length,
      pass: xs.filter((r:any)=>r.state === "PASS").length,
      pending: xs.filter((r:any)=>r.state === "PENDING").length,
      strongValue: xs.filter((r:any)=>r.strength === "STRONG_VALUE").length,
      averagePriceCushionCents: (() => {
        const vals = xs.map((r:any)=>num(r.price_cushion_cents)).filter((x):x is number=>x!==null);
        return vals.length ? Number(avg(vals)!.toFixed(2)) : null;
      })(),
      averageRobustEvPct: (() => {
        const vals = xs.map((r:any)=>num(r.current_robust_ev_pct)).filter((x):x is number=>x!==null);
        return vals.length ? Number(avg(vals)!.toFixed(3)) : null;
      })(),
    });

    const waitRows = (waits ?? []).map(enrich);
    const summarizeWait = (xs:any[]) => {
      const waitChanges = xs
        .map((r:any)=>num(r.wait_change_cents))
        .filter((x):x is number=>x!==null);
      const bestChanges = xs
        .map((r:any)=>num(r.best_improvement_cents))
        .filter((x):x is number=>x!==null);
      return {
        markets: xs.length,
        improved: xs.filter((r:any)=>r.wait_result === "IMPROVED").length,
        worsened: xs.filter((r:any)=>r.wait_result === "WORSENED").length,
        unchanged: xs.filter((r:any)=>r.wait_result === "UNCHANGED").length,
        lostBuyPoint: xs.filter((r:any)=>r.buy_window_result === "LOST_BUY_POINT").length,
        becameBuy: xs.filter((r:any)=>r.buy_window_result === "BECAME_BUY").length,
        stayedBuy: xs.filter((r:any)=>r.buy_window_result === "STAYED_BUY").length,
        buyWindowClosed: xs.filter((r:any)=>r.buy_window_result === "BUY_WINDOW_CLOSED").length,
        neverBuy: xs.filter((r:any)=>r.buy_window_result === "NEVER_BUY").length,
        averageWaitChangeCents:
          waitChanges.length ? Number(avg(waitChanges)!.toFixed(2)) : null,
        averageBestImprovementCents:
          bestChanges.length ? Number(avg(bestChanges)!.toFixed(2)) : null,
      };
    };

    const byPolicy: Record<string, any> = {};
    for (const p of policies ?? []) {
      const xs = currentRows.filter((r:any)=>r.policy_id === p.policy_id);
      const ws = waitRows.filter((r:any)=>r.policy_id === p.policy_id);
      byPolicy[p.policy_id] = {
        policyId: p.policy_id,
        displayName: p.display_name,
        family: p.policy_family,
        marketType: p.market_type,
        targetEvPct: num(p.config?.minEvPct),
        shadowOnly: Boolean(p.shadow_only),
        affectsDecision: Boolean(p.affects_decision),
        current: summarizeCurrent(xs),
        waitHistory: summarizeWait(ws),
      };
    }

    return new Response(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      evaluatorVersion: "price-sensitivity-v1",
      sport,
      days,
      hours,
      shadowOnly: true,
      affectsDecision: false,
      priceStateDoesNotOverridePlayPass: true,
      policyCount: policies?.length ?? 0,
      summary: {
        balanced: summarizeCurrent(balancedCurrent),
        balancedWaitHistory: summarizeWait(
          waitRows.filter((r:any)=>r.policy?.policy_family === "BALANCED"),
        ),
      },
      balancedCurrent,
      current: currentRows,
      byPolicy,
      waitHistory: waitRows.slice(0,500),
    }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=20",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : JSON.stringify(error),
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});