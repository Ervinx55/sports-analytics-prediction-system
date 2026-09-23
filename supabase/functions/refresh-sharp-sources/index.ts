import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOOKMAKER_CSV =
  "https://lines.bookmaker.eu/en/sports/baseball/mlb.csv";
const VSIN_CIRCA_BASE =
  "https://data.vsin.com/betting-splits/?display=table&source=CIRCA&sport=MLB";
const VSIN_CIRCA_URLS = [
  VSIN_CIRCA_BASE + "&view=today",
  VSIN_CIRCA_BASE + "&view=tomorrow",
  VSIN_CIRCA_BASE + "&view=soon",
];

function cleanText(s: unknown) {
  return String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

function normTeam(s: unknown) {
  return cleanText(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseOdds(v: unknown): number | null {
  const text = String(v ?? "").trim().replace(/^\+/, "");
  if (!text || text === "-") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 10000) return null;
  return Math.trunc(n);
}

function parseLine(v: unknown): number | null {
  const text = String(v ?? "")
    .trim()
    .replace("½", ".5")
    .replace("¼", ".25")
    .replace("¾", ".75")
    .replace(/^\+/, "");
  if (!text || text === "-") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || Math.abs(n) > 50) return null;
  return n;
}

function csvRow(line: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function eventDateFromBookmakerDate(dateTime: string): string | null {
  const m = String(dateTime).match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const now = new Date();
  const year = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
    }).format(now),
  );
  const month = String(Number(m[1])).padStart(2, "0");
  const day = String(Number(m[2])).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function eventDateFromGameCode(code: string): string | null {
  const m = String(code).match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function sourceEventKey(date: string | null, away: string, home: string) {
  return [date ?? "", normTeam(away), normTeam(home)].join("|");
}

function quoteRowsForGame(args: {
  observedAt: string;
  sport: string;
  sourceBook: string;
  provider: string;
  sourceKind: string;
  sourceUrl: string;
  sourceEventKey: string;
  eventDate: string | null;
  away: string;
  home: string;
  awayMl: number | null;
  homeMl: number | null;
  awaySpread: number | null;
  homeSpread: number | null;
  total: number | null;
  raw: Record<string, unknown>;
}) {
  const {
    observedAt, sport, sourceBook, provider, sourceKind, sourceUrl,
    sourceEventKey: eventKey, eventDate, away, home,
    awayMl, homeMl, awaySpread, homeSpread, total, raw,
  } = args;
  const base = {
    observed_at: observedAt,
    sport,
    source_book: sourceBook,
    provider,
    source_kind: sourceKind,
    source_event_key: eventKey,
    event_date: eventDate,
    starts_at: null,
    away_team: away,
    home_team: home,
    source_updated_at: observedAt,
    freshness_basis: "observed_snapshot",
    source_url: sourceUrl,
    raw,
  };
  const rows: Record<string, unknown>[] = [];

  if (awayMl !== null && homeMl !== null) {
    rows.push({
      ...base, market_type: "moneyline", market_side: "away",
      line: null, odds: awayMl, opponent_odds: homeMl,
    });
    rows.push({
      ...base, market_type: "moneyline", market_side: "home",
      line: null, odds: homeMl, opponent_odds: awayMl,
    });
  }

  if (awaySpread !== null) {
    rows.push({
      ...base, market_type: "spread", market_side: "away",
      line: awaySpread, odds: null, opponent_odds: null,
    });
  }
  if (homeSpread !== null) {
    rows.push({
      ...base, market_type: "spread", market_side: "home",
      line: homeSpread, odds: null, opponent_odds: null,
    });
  }
  if (total !== null) {
    rows.push({
      ...base, market_type: "total", market_side: "over",
      line: total, odds: null, opponent_odds: null,
    });
    rows.push({
      ...base, market_type: "total", market_side: "under",
      line: total, odds: null, opponent_odds: null,
    });
  }
  return rows;
}

async function captureBookmaker(observedAt: string) {
  const r = await fetch(BOOKMAKER_CSV, {
    headers: { accept: "text/csv,*/*" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`BookMaker CSV returned ${r.status}`);
  const text = await r.text();
  const lines = text.split(/\r?\n/).filter(Boolean).slice(1);
  const rows: Record<string, unknown>[] = [];

  for (const line of lines) {
    const c = csvRow(line);
    if (c.length < 8) continue;
    const dateTime = cleanText(c[0]);
    const away = cleanText(c[1]);
    const awaySpread = parseLine(c[2]);
    const awayMl = parseOdds(c[3]);
    const home = cleanText(c[4]);
    const homeSpread = parseLine(c[5]);
    const homeMl = parseOdds(c[6]);
    const total = parseLine(c[7]);
    if (!away || !home) continue;

    const eventDate = eventDateFromBookmakerDate(dateTime);
    rows.push(...quoteRowsForGame({
      observedAt,
      sport: "MLB",
      sourceBook: "bookmaker",
      provider: "bookmaker_direct_csv",
      sourceKind: "direct",
      sourceUrl: BOOKMAKER_CSV,
      sourceEventKey: sourceEventKey(eventDate, away, home),
      eventDate,
      away,
      home,
      awayMl,
      homeMl,
      awaySpread,
      homeSpread,
      total,
      raw: {
        providerDateTime: dateTime,
        directOfficialBookPage: true,
      },
    }));
  }
  return rows;
}

function parseVsinRows(html: string, observedAt: string) {
  const trRe = /<tr\s+class=["']sp-row([^"']*)["'][^>]*>([\s\S]*?)<\/tr>/gi;
  const parsed: any[] = [];
  let m;
  while ((m = trRe.exec(html))) {
    const classes = String(m[1] || "");
    if (/sp-game-final/i.test(classes)) continue;
    const body = m[2];
    const gc = body.match(/data-gamecode=["']([^"']+)["']/i)?.[1] || null;
    const team = cleanText(
      body.match(/class=["']sp-team-link["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || "",
    );
    if (!gc || !team) continue;
    const vals = [...body.matchAll(/class=["']sp-badge\s+sp-badge-line["'][^>]*>([\s\S]*?)<\/span>/gi)]
      .map((x) => cleanText(x[1]));
    parsed.push({
      gamecode: gc,
      team,
      spread: parseLine(vals[0]),
      total: parseLine(vals[1]),
      moneyline: parseOdds(vals[2]),
      sourceUrl: null,
    });
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i + 1 < parsed.length; i++) {
    const away = parsed[i];
    const home = parsed[i + 1];
    if (away.gamecode !== home.gamecode) continue;
    const eventDate = eventDateFromGameCode(away.gamecode);
    rows.push(...quoteRowsForGame({
      observedAt,
      sport: "MLB",
      sourceBook: "circa",
      provider: "vsin_public_circa",
      sourceKind: "secondary",
      sourceUrl: String((away as any).sourceUrl || VSIN_CIRCA_BASE),
      sourceEventKey: sourceEventKey(eventDate, away.team, home.team),
      eventDate,
      away: away.team,
      home: home.team,
      awayMl: away.moneyline,
      homeMl: home.moneyline,
      awaySpread: away.spread,
      homeSpread: home.spread,
      total: away.total ?? home.total,
      raw: {
        gamecode: away.gamecode,
        coverage: "public_page_partial",
        sourceUrl: (away as any).sourceUrl || VSIN_CIRCA_BASE,
        sourceAttribution: "VSiN page states betting split data is based on Circa Sports action",
      },
    }));
    i++;
  }
  return rows;
}

async function captureVsinCirca(observedAt: string) {
  const pages = await Promise.allSettled(
    VSIN_CIRCA_URLS.map(async (url) => {
      const r = await fetch(url, {
        headers: { accept: "text/html,*/*" },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`VSiN Circa page returned ${r.status}`);
      const html = await r.text();
      const rows = parseVsinRows(html, observedAt);
      return rows.map((row: any) => ({
        ...row,
        source_url: url,
        raw: { ...(row.raw || {}), sourceUrl: url },
      }));
    }),
  );

  const merged: Record<string, unknown>[] = [];
  const errors: string[] = [];
  for (const p of pages) {
    if (p.status === "fulfilled") merged.push(...p.value);
    else errors.push(p.reason instanceof Error ? p.reason.message : String(p.reason));
  }
  if (!merged.length && errors.length === pages.length) {
    throw new Error(errors.join(" | "));
  }

  const seen = new Set<string>();
  return merged.filter((row: any) => {
    const key = [
      row.source_book, row.source_event_key, row.market_type,
      row.market_side, row.line ?? "", row.odds ?? "",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function localDate(value: unknown, timeZone: string) {
  const t = new Date(String(value || ""));
  if (!Number.isFinite(t.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function lineMatches(a: unknown, b: unknown) {
  if (a === null || a === undefined || b === null || b === undefined) {
    return a == null && b == null;
  }
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 0.001;
}

function quoteFor(
  quotes: any[],
  sourceBook: string,
  candidate: any,
) {
  const utcDate = String(candidate.starts_at || "").slice(0, 10);
  const laDate = localDate(candidate.starts_at, "America/Los_Angeles");
  const chicagoDate = localDate(candidate.starts_at, "America/Chicago");
  const acceptableDates = new Set([utcDate, laDate, chicagoDate].filter(Boolean));
  const away = normTeam(candidate.away_team);
  const home = normTeam(candidate.home_team);
  return quotes.find((q) =>
    q.source_book === sourceBook &&
    acceptableDates.has(q.event_date) &&
    normTeam(q.away_team) === away &&
    normTeam(q.home_team) === home &&
    q.market_type === candidate.market_type &&
    q.market_side === candidate.market_side &&
    lineMatches(q.line, candidate.line)
  ) || null;
}

function sourcePayload(q: any, label: string) {
  if (!q) {
    return { status: "unavailable" };
  }
  const provider = String(q.provider || "");
  let status = "captured sharp quote";
  if (provider === "bookmaker_direct_csv") {
    status = "direct official public odds board";
  } else if (provider === "vsin_public_circa") {
    status = "secondary public Circa observation via VSiN";
  } else if (provider === "manual_screenshot_verified") {
    status = "verified manual screenshot";
  } else if (provider.includes("official_api")) {
    status = "authorized official API quote";
  }
  return {
    status,
    candidateOdds: q.odds,
    opponentOdds: q.opponent_odds,
    line: q.line,
    updatedAt: q.source_updated_at || q.observed_at,
    provider: q.provider,
    label,
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

    const observedAt = new Date().toISOString();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const sourceResults = await Promise.allSettled([
      captureBookmaker(observedAt),
      captureVsinCirca(observedAt),
    ]);

    const sourceErrors: string[] = [];
    const captured: Record<string, unknown>[] = [];
    if (sourceResults[0].status === "fulfilled") {
      captured.push(...sourceResults[0].value);
    } else {
      sourceErrors.push(
        "BookMaker: " +
          (sourceResults[0].reason instanceof Error
            ? sourceResults[0].reason.message
            : String(sourceResults[0].reason)),
      );
    }
    if (sourceResults[1].status === "fulfilled") {
      captured.push(...sourceResults[1].value);
    } else {
      sourceErrors.push(
        "Circa/VSiN: " +
          (sourceResults[1].reason instanceof Error
            ? sourceResults[1].reason.message
            : String(sourceResults[1].reason)),
      );
    }

    if (captured.length) {
      const { error } = await supabase
        .from("sharp_source_quotes")
        .insert(captured);
      if (error) throw error;
    }

    const cutoff = new Date(Date.now() - 90 * 60_000).toISOString();
    const [quotesResult, candidatesResult] = await Promise.all([
      supabase
        .from("sharp_source_quote_latest")
        .select("*")
        .eq("sport", "MLB")
        .gte("observed_at", cutoff)
        .order("observed_at", { ascending: false })
        .limit(500),
      supabase
        .from("market_grade_latest")
        .select("*")
        .eq("sport", "MLB")
        .eq("non_sharp_status", "READY_FOR_SHARP_CHECK")
        .gte("starts_at", new Date(Date.now() - 20 * 60_000).toISOString())
        .lte("starts_at", new Date(Date.now() + 36 * 3600_000).toISOString())
        .order("starts_at", { ascending: true })
        .limit(100),
    ]);

    if (quotesResult.error) throw quotesResult.error;
    if (candidatesResult.error) throw candidatesResult.error;

    const quotes = quotesResult.data ?? [];
    const candidates = candidatesResult.data ?? [];
    const evaluations: any[] = [];

    await Promise.all(
      candidates.map(async (c: any) => {
        const bookmaker = quoteFor(quotes, "bookmaker", c);
        const circa = quoteFor(quotes, "circa", c);
        const payload = {
          candidate: {
            sport: c.sport,
            eventId: c.event_id,
            gamePk: c.game_pk,
            startsAt: c.starts_at,
            awayTeam: c.away_team,
            homeTeam: c.home_team,
            sideKey: c.market_side,
            sideName: c.market_label,
            marketType: c.market_type,
            marketSide: c.market_side,
            marketLine: c.line,
            modelProbability: c.model_probability,
            mainstreamBook: c.best_book,
            mainstreamOdds: c.best_odds,
            playableThreshold: c.playable_threshold,
            verificationStatus: c.non_sharp_status,
          },
          sources: {
            pinnacle: {
              status: "official API not connected; automated scraping intentionally disabled",
            },
            circa: sourcePayload(circa, "Circa"),
            bookmaker: sourcePayload(bookmaker, "BookMaker"),
          },
        };

        const { data, error } = await supabase.functions.invoke(
          "evaluate-sharp-gate",
          { body: payload },
        );
        evaluations.push({
          eventId: c.event_id,
          market: c.market_label,
          ok: !error && Boolean(data?.ok),
          result: data?.result ?? null,
          error: error?.message ?? data?.error ?? null,
          sources: {
            bookmaker: Boolean(bookmaker),
            circa: Boolean(circa),
            pinnacle: false,
          },
        });
      }),
    );

    return new Response(
      JSON.stringify({
        ok: true,
        observedAt,
        capturedRows: captured.length,
        sourceErrors,
        candidateCount: candidates.length,
        evaluationCount: evaluations.length,
        evaluations,
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