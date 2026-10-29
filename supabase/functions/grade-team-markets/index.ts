import { gradeMarket } from '../_shared/team-market-grading.mjs';
import postgres from 'npm:postgres@3.4.9';
import {gradingRepository} from '../_shared/grading-database.mjs';

async function fetchJson(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 500) }; }
  if (!r.ok) throw new Error(`${r.status} ${url}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

function sameLine(a: unknown, b: unknown) {
  if (a === null || a === undefined || b === null || b === undefined) {
    return a == null && b == null;
  }
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-9;
}

function resolveDecision(obs: any, sharpRows: any[]) {
  if (obs.non_sharp_status === "PLAY") return { status: "PLAY", sharp: null };
  if (obs.non_sharp_status !== "READY_FOR_SHARP_CHECK") {
    return { status: "PASS", sharp: null };
  }

  const startMs = Date.parse(obs.starts_at || "");
  const matching = sharpRows
    .filter((s) => {
      const marketType = s.market_type || "moneyline";
      const marketSide = s.market_side || s.side_key;
      const checkedMs = Date.parse(s.checked_at || "");
      return (
        s.event_id === obs.event_id &&
        marketType === obs.market_type &&
        marketSide === obs.market_side &&
        sameLine(s.market_line, obs.line) &&
        (!Number.isFinite(startMs) || !Number.isFinite(checkedMs) || checkedMs <= startMs)
      );
    })
    .sort((a, b) => Date.parse(b.checked_at || "") - Date.parse(a.checked_at || ""));

  const sharp = matching[0] || null;
  return {
    status: sharp?.final_status === "FINAL_PLAY" ? "PLAY" : "PASS",
    sharp,
  };
}

Deno.serve(async (req) => {
  let sql;
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const url=Deno.env.get('SUPABASE_DB_URL');
    if(!url)throw Error('GRADING_DATABASE_UNAVAILABLE');
    sql=postgres(url,{max:1,prepare:false,connect_timeout:3,idle_timeout:1});
    const repository=gradingRepository(sql);
    if(!await repository.authorized(req.headers.get('authorization')))return new Response(JSON.stringify({error:'Pipeline authentication required'}),{status:401,headers:{'content-type':'application/json'}});

    const floor = new Date(Date.now() - 7 * 86400_000).toISOString();
    const cutoff = new Date().toISOString();

    const observations=await repository.observations('team',floor,cutoff);

    const ids = (observations ?? []).map((x: any) => x.id);
    const already = new Set<number>();
    for (let i = 0; i < ids.length; i += 500) {
      const data=await repository.existing('team',ids.slice(i,i+500));
      for (const row of data ?? []) already.add(Number(row.observation_id));
    }

    const ungraded = (observations ?? []).filter(
      (x: any) => !already.has(Number(x.id)),
    );

    const eventIds = [...new Set(ungraded.map((x: any) => x.event_id).filter(Boolean))];
    let sharpRows: any[] = [];
    for (let i = 0; i < eventIds.length; i += 100) {
      const data=await repository.sharp(eventIds.slice(i,i+100));
      sharpRows.push(...(data ?? []));
    }

    const byGame = new Map<number, any[]>();
    for (const row of ungraded) {
      const gamePk = Number(row.game_pk);
      if (!Number.isFinite(gamePk)) continue;
      if (!byGame.has(gamePk)) byGame.set(gamePk, []);
      byGame.get(gamePk)!.push(row);
    }

    let gamesFinal = 0;
    let rowsGraded = 0;

    for (const [gamePk, rows] of byGame.entries()) {
      let feed: any;
      try {
        feed = await fetchJson(
          `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
        );
      } catch {
        continue;
      }

      if (feed?.gameData?.status?.abstractGameState !== "Final") continue;

      const awayScore = feed?.liveData?.linescore?.teams?.away?.runs;
      const homeScore = feed?.liveData?.linescore?.teams?.home?.runs;
      if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) continue;

      const inserts: any[] = [];

      for (const obs of rows) {
        const grade = gradeMarket(obs, awayScore, homeScore);
        if (!grade) continue;

        const decision = resolveDecision(obs, sharpRows);
        let passEvaluation: string | null = null;
        if (decision.status === "PASS") {
          passEvaluation =
            grade.outcome === "W"
              ? "MISSED_WIN"
              : grade.outcome === "L"
              ? "GOOD_PASS"
              : "PUSHED_PASS";
        }

        inserts.push({
          observation_id: obs.id,
          event_id: obs.event_id,
          game_pk: obs.game_pk,
          market_type: obs.market_type,
          market_side: obs.market_side,
          market_label: obs.market_label,
          line: obs.line,
          decision_status: decision.status,
          actual_value: grade.actualValue,
          away_score: awayScore,
          home_score: homeScore,
          outcome: grade.outcome,
          won: grade.won,
          pushed: grade.pushed,
          pass_evaluation: passEvaluation,
          graded_at: new Date().toISOString(),
          raw: {
            nonSharpStatus: obs.non_sharp_status,
            sharpGateStatus: decision.sharp?.final_status ?? null,
            sharpCheckedAt: decision.sharp?.checked_at ?? null,
            finalDetailedState: feed?.gameData?.status?.detailedState ?? "Final",
          },
        });
      }

      if (inserts.length) {
        rowsGraded += await repository.save('team',inserts);
      }

      gamesFinal++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        checkedRows: ungraded.length,
        gamesFinal,
        rowsGraded,
        monitorMode: "from scheduled start until MLB marks Final",
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (error) {
    console.error('GRADING_FAILED',{code:typeof error?.code==='string'&&/^[A-Z0-9_]{1,30}$/.test(error.code)?error.code:'UNKNOWN'});
    return new Response(
      JSON.stringify({
        ok: false,
        error: "GRADING_FAILED",
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  } finally {if(sql)await sql.end({timeout:1}).catch(()=>{});}
});
