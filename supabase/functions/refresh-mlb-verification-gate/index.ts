import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MLB = "https://statsapi.mlb.com";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  const d = new Date(String(v || ""));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function finalWindow(startsAt: string | null, minutes = 20) {
  const t = Date.parse(startsAt || "");
  return Number.isFinite(t) && t - Date.now() <= minutes * 60_000;
}

function pendingOrPass(startsAt: string | null) {
  return finalWindow(startsAt) ? "PASS" : "PENDING";
}

function sideOther(side: string) {
  return side === "away" ? "home" : "away";
}

async function fetchJson(url: string) {
  const r = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 400) }; }
  if (!r.ok) throw new Error(`${r.status} ${url}: ${JSON.stringify(body).slice(0,400)}`);
  return body;
}

function playerFromFeed(feed: any, id: number | null) {
  if (!id) return null;
  return feed?.gameData?.players?.[`ID${id}`] ?? null;
}

function starterSummary(feed: any, side: "away" | "home") {
  const p = feed?.gameData?.probablePitchers?.[side] ?? null;
  const id = num(p?.id);
  const details = playerFromFeed(feed, id);
  return {
    id,
    name: p?.fullName ?? details?.fullName ?? null,
    hand: details?.pitchHand?.code ?? null,
  };
}

function lineupSummary(feed: any, side: "away" | "home") {
  const teamBox = feed?.liveData?.boxscore?.teams?.[side] ?? {};
  const players = teamBox?.players ?? {};
  const gamePlayers = feed?.gameData?.players ?? {};
  const order = Array.isArray(teamBox?.battingOrder) ? teamBox.battingOrder.map(Number) : [];
  const orderSet = new Set(order);

  const lineup = order.map((id: number, i: number) => {
    const box = players[`ID${id}`] ?? {};
    const person = gamePlayers[`ID${id}`] ?? {};
    return {
      spot: i + 1,
      id,
      name: person?.fullName ?? box?.person?.fullName ?? String(id),
      position: box?.position?.abbreviation ?? null,
      plateAppearances: num(box?.seasonStats?.batting?.plateAppearances),
      ops: num(box?.seasonStats?.batting?.ops),
    };
  });

  const catcher = lineup.find((p: any) => p.position === "C") ?? null;

  const regulars: any[] = [];
  for (const value of Object.values(players) as any[]) {
    const id = num(value?.person?.id);
    if (!id || orderSet.has(id)) continue;
    const pos = value?.position?.abbreviation ?? null;
    if (pos === "P") continue;
    const pa = num(value?.seasonStats?.batting?.plateAppearances) ?? 0;
    const ops = num(value?.seasonStats?.batting?.ops);
    if (pa < 200) continue;
    regulars.push({
      id,
      name: value?.person?.fullName ?? String(id),
      position: pos,
      plateAppearances: pa,
      ops,
      isOnBench: Boolean(value?.gameStatus?.isOnBench),
    });
  }
  regulars.sort((a,b) => (b.plateAppearances-a.plateAppearances) || ((b.ops??0)-(a.ops??0)));

  return {
    confirmed: order.length >= 9,
    count: order.length,
    fingerprint: order.length ? order.join("-") : null,
    lineup,
    catcher: catcher ? { id: catcher.id, name: catcher.name } : null,
    notableAbsences: regulars.slice(0,4),
    playerIds: order,
  };
}

function relieverUsage(box: any, side: "away" | "home") {
  const teamBox = box?.teams?.[side] ?? {};
  const pitchers = Array.isArray(teamBox?.pitchers) ? teamBox.pitchers.map(Number) : [];
  const players = teamBox?.players ?? {};
  const relievers = pitchers.slice(1).map((id: number) => {
    const p = players[`ID${id}`] ?? {};
    return {
      id,
      name: p?.person?.fullName ?? String(id),
      pitches: Number(p?.stats?.pitching?.numberOfPitches || 0),
    };
  });
  return {
    relievers,
    reliefPitches: relievers.reduce((s:number,p:any)=>s+Number(p.pitches||0),0),
  };
}

function ymd(value: string | Date) {
  return new Date(value).toISOString().slice(0,10);
}

async function bullpenStatus(teamId: number, targetTime: string) {
  const target = new Date(targetTime);
  const start = new Date(target);
  start.setUTCDate(start.getUTCDate()-4);
  const schedule = await fetchJson(
    `${MLB}/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${ymd(start)}&endDate=${ymd(target)}`
  );
  const games = (schedule?.dates ?? [])
    .flatMap((d:any)=>d?.games ?? [])
    .filter((g:any)=>
      g?.status?.abstractGameState === "Final" &&
      Date.parse(g?.gameDate || "") < target.getTime()
    )
    .sort((a:any,b:any)=>Date.parse(b.gameDate)-Date.parse(a.gameDate))
    .slice(0,2);

  const details = await Promise.all(games.map(async (g:any) => {
    const box = await fetchJson(`${MLB}/api/v1/game/${g.gamePk}/boxscore`);
    const side: "away"|"home" =
      Number(g?.teams?.home?.team?.id) === Number(teamId) ? "home" : "away";
    const use = relieverUsage(box, side);
    return {
      gamePk: g.gamePk,
      gameDate: g.gameDate,
      hoursBeforeTarget: Number(((target.getTime()-Date.parse(g.gameDate))/3600000).toFixed(1)),
      reliefPitches: use.reliefPitches,
      relievers: use.relievers,
    };
  }));

  const first = details[0] ?? null;
  const second = details[1] ?? null;
  const firstIds = new Set((first?.relievers ?? []).map((p:any)=>Number(p.id)));
  const secondIds = new Set((second?.relievers ?? []).map((p:any)=>Number(p.id)));
  const b2b = [...firstIds].filter((id:any)=>secondIds.has(id));
  const twenty = (first?.relievers ?? []).filter((p:any)=>Number(p.pitches)>=20);

  let score = 0;
  if (first && first.hoursBeforeTarget <= 36) {
    if (first.reliefPitches >= 75) score += 2;
    else if (first.reliefPitches >= 50) score += 1;
    if (twenty.length >= 2) score += 1;
  }
  if (second && second.hoursBeforeTarget <= 60) {
    const total = Number(first?.reliefPitches||0)+Number(second?.reliefPitches||0);
    if (total >= 130) score += 2;
    else if (total >= 90) score += 1;
    if (b2b.length >= 3) score += 2;
    else if (b2b.length >= 1) score += 1;
  }

  return {
    checkedAt: new Date().toISOString(),
    level: score >= 4 ? "DEPLETED" : score >= 2 ? "WATCH" : "CLEAR",
    score,
    recentGames: details,
    backToBackRelieverIds: b2b,
    relievers20PlusLastGame: twenty,
  };
}

function freshBullpen(obj: any, minutes = 30) {
  const t = Date.parse(obj?.checkedAt || "");
  return Number.isFinite(t) && Date.now()-t <= minutes*60_000;
}

function firstNonNull(history:any[], field:string) {
  for (const x of history) {
    if (x?.[field] !== null && x?.[field] !== undefined && x?.[field] !== "") return x[field];
  }
  return null;
}

function firstConfirmedFingerprint(history:any[], side:"away"|"home") {
  const cfield = `${side}_lineup_confirmed`;
  const ffield = `${side}_lineup_fingerprint`;
  for (const x of history) {
    if (x?.[cfield] && x?.[ffield]) return x[ffield];
  }
  return null;
}

function firstConfirmedCatcher(history:any[], side:"away"|"home") {
  const cfield = `${side}_lineup_confirmed`;
  const idfield = `${side}_catcher_id`;
  for (const x of history) {
    if (x?.[cfield] && x?.[idfield]) return x[idfield];
  }
  return null;
}

function existingChangeAt(history:any[], field:string) {
  for (const x of history) {
    if (x?.[field]) return iso(x[field]);
  }
  return null;
}

function minIso(a:string|null,b:string|null) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a)<=Date.parse(b)?a:b;
}

function gameSnapshotState(args:any) {
  const {statusClear,awayStarter,homeStarter,awayLineup,homeLineup,awayBullpen,homeBullpen,startsAt} = args;
  const reasons:string[] = [];
  const warnings:string[] = [];
  let state = "READY";

  if (!statusClear) {
    state = "PASS";
    reasons.push("Official MLB game status is not clear for pregame wagering.");
  } else {
    if (!awayStarter?.id || !homeStarter?.id) reasons.push("Both probable starters are not confirmed.");
    if (!awayLineup?.confirmed || !homeLineup?.confirmed) reasons.push("Both starting lineups are not confirmed.");
    if (!awayLineup?.catcher?.id || !homeLineup?.catcher?.id) reasons.push("Starting catcher is not confirmed for both teams.");
    if (!awayBullpen?.level || !homeBullpen?.level) reasons.push("Bullpen availability is incomplete.");

    if (reasons.length) state = pendingOrPass(startsAt);
  }

  if (awayBullpen?.level === "WATCH" || homeBullpen?.level === "WATCH") {
    warnings.push("At least one bullpen is on workload WATCH.");
  }
  if (awayBullpen?.level === "DEPLETED" || homeBullpen?.level === "DEPLETED") {
    warnings.push("At least one bullpen is graded DEPLETED.");
  }
  if ((awayLineup?.notableAbsences?.length||0) > 0 || (homeLineup?.notableAbsences?.length||0) > 0) {
    warnings.push("Confirmed lineup has one or more notable regular-player absences.");
  }

  const components = [
    statusClear ? 1 : 0,
    awayStarter?.id && homeStarter?.id ? 1 : 0,
    awayLineup?.confirmed && homeLineup?.confirmed ? 1 : 0,
    awayLineup?.catcher?.id && homeLineup?.catcher?.id ? 1 : 0,
    awayBullpen?.level && homeBullpen?.level ? 1 : 0,
  ];
  const quality = components.reduce((s,n)=>s+n,0)/components.length;
  return {state,reasons,warnings,dataQuality:Number(quality.toFixed(3))};
}

function changeAfter(changeAt:string|null, observationAt:string|null) {
  const c=Date.parse(changeAt||"");
  const o=Date.parse(observationAt||"");
  return Number.isFinite(c)&&Number.isFinite(o)&&c>o;
}

function teamGate(snapshot:any, obs:any) {
  const reasons:string[]=[];
  const warnings:string[]=[];
  if (!snapshot.status_clear) {
    return {state:"PASS",reasonCode:"GAME_STATUS_BLOCK",reasons:["Official game status is not clear."],warnings};
  }
  if (!snapshot.away_starter_id || !snapshot.home_starter_id) reasons.push("Both probable starters are required.");
  if (!snapshot.away_lineup_confirmed || !snapshot.home_lineup_confirmed) reasons.push("Both starting lineups are required.");
  const awayBp=snapshot.away_bullpen||{}, homeBp=snapshot.home_bullpen||{};
  if (!awayBp.level || !homeBp.level) reasons.push("Bullpen availability is required.");

  if (reasons.length) {
    const state=pendingOrPass(obs.starts_at);
    return {state,reasonCode:state==="PASS"?"CONTEXT_MISSING_AT_DEADLINE":"CONTEXT_PENDING",reasons,warnings};
  }

  const starterChange =
    changeAfter(snapshot.away_starter_change_at,obs.captured_at) ||
    changeAfter(snapshot.home_starter_change_at,obs.captured_at);
  const handednessChange =
    changeAfter(snapshot.away_starter_hand_change_at,obs.captured_at) ||
    changeAfter(snapshot.home_starter_hand_change_at,obs.captured_at);
  const lineupChange =
    changeAfter(snapshot.away_lineup_change_at,obs.captured_at) ||
    changeAfter(snapshot.home_lineup_change_at,obs.captured_at);
  const catcherChange =
    changeAfter(snapshot.away_catcher_change_at,obs.captured_at) ||
    changeAfter(snapshot.home_catcher_change_at,obs.captured_at);

  if (starterChange) reasons.push("Probable starter changed after this model observation.");
  if (handednessChange) reasons.push("Starting-pitcher handedness changed after this model observation.");
  if (lineupChange) reasons.push("Confirmed batting order changed after this model observation.");
  if (catcherChange) warnings.push("Starting catcher changed after this model observation.");

  if (awayBp.level==="DEPLETED" || homeBp.level==="DEPLETED") {
    warnings.push("Current bullpen workload includes a DEPLETED grade.");
  } else if (awayBp.level==="WATCH" || homeBp.level==="WATCH") {
    warnings.push("Current bullpen workload includes a WATCH grade.");
  }

  if ((snapshot.away_notable_absences?.length||0)>0 || (snapshot.home_notable_absences?.length||0)>0) {
    warnings.push("Current lineup omits one or more high-PA regulars.");
  }

  const state = starterChange || handednessChange || lineupChange ? "REMODEL" : "READY";
  return {
    state,
    reasonCode: state==="REMODEL" ? (starterChange?"STARTER_CHANGED_AFTER_MODEL":"LINEUP_CHANGED_AFTER_MODEL") : "VERIFICATION_READY",
    reasons,
    warnings,
    starterChange,
    handednessChange,
    lineupChange,
    catcherChange,
  };
}

function playerSide(snapshot:any, playerId:number|null) {
  if (!playerId) return null;
  if (Number(snapshot.away_starter_id)===playerId) return "away";
  if (Number(snapshot.home_starter_id)===playerId) return "home";
  if ((snapshot.away_lineup||[]).some((p:any)=>Number(p.id)===playerId)) return "away";
  if ((snapshot.home_lineup||[]).some((p:any)=>Number(p.id)===playerId)) return "home";
  const awayPlayers = snapshot.raw?.awayRosterPlayerIds || [];
  const homePlayers = snapshot.raw?.homeRosterPlayerIds || [];
  if (awayPlayers.map(Number).includes(playerId)) return "away";
  if (homePlayers.map(Number).includes(playerId)) return "home";
  return null;
}

function propGate(snapshot:any, obs:any) {
  const role=String(obs.stat_id||"").startsWith("pitching_")?"PITCHER":"HITTER";
  const playerId=num(obs.mlb_player_id);
  const side=playerSide(snapshot,playerId);
  const reasons:string[]=[];
  const warnings:string[]=[];

  if (!snapshot.status_clear) {
    return {role,side,state:"PASS",reasonCode:"GAME_STATUS_BLOCK",reasons:["Official game status is not clear."],warnings};
  }

  if (!side) {
    const state=pendingOrPass(obs.starts_at);
    return {role,side,state,reasonCode:state==="PASS"?"PLAYER_TEAM_UNRESOLVED_AT_DEADLINE":"PLAYER_TEAM_UNRESOLVED",reasons:["Player could not be mapped to either game roster."],warnings};
  }

  const opp=sideOther(side);
  const lineup=snapshot[`${side}_lineup`]||[];
  const oppConfirmed=Boolean(snapshot[`${opp}_lineup_confirmed`]);
  const ownConfirmed=Boolean(snapshot[`${side}_lineup_confirmed`]);
  const inLineup=lineup.some((p:any)=>Number(p.id)===playerId);
  const spot=(lineup.find((p:any)=>Number(p.id)===playerId)?.spot) ?? null;

  if (role==="HITTER") {
    if (!ownConfirmed) {
      const state=pendingOrPass(obs.starts_at);
      return {role,side,state,reasonCode:state==="PASS"?"LINEUP_MISSING_AT_DEADLINE":"LINEUP_PENDING",reasons:["Player team lineup is not confirmed."],warnings,inLineup:null,spot:null};
    }
    if (!inLineup) {
      return {role,side,state:"PASS",reasonCode:"PLAYER_NOT_STARTING",reasons:["Hitter is not in the confirmed starting lineup."],warnings,inLineup:false,spot:null};
    }
    if (!snapshot[`${opp}_starter_id`]) {
      const state=pendingOrPass(obs.starts_at);
      return {role,side,state,reasonCode:state==="PASS"?"OPPOSING_STARTER_MISSING_AT_DEADLINE":"OPPOSING_STARTER_PENDING",reasons:["Opposing starter is not confirmed."],warnings,inLineup:true,spot};
    }

    const oppStarterChange=changeAfter(snapshot[`${opp}_starter_change_at`],obs.captured_at);
    const oppHandednessChange=changeAfter(snapshot[`${opp}_starter_hand_change_at`],obs.captured_at);
    const ownLineupChange=changeAfter(snapshot[`${side}_lineup_change_at`],obs.captured_at);
    if (oppStarterChange) reasons.push("Opposing starter changed after this hitter-prop model observation.");
    if (oppHandednessChange) reasons.push("Opposing starter handedness changed after this hitter-prop model observation.");
    if (ownLineupChange) reasons.push("Player team batting order changed after this hitter-prop model observation.");
    const state=oppStarterChange||oppHandednessChange||ownLineupChange?"REMODEL":"READY";
    return {
      role,side,state,
      reasonCode:state==="REMODEL"?(oppStarterChange?"OPPOSING_STARTER_CHANGED_AFTER_MODEL":"LINEUP_CHANGED_AFTER_MODEL"):"VERIFICATION_READY",
      reasons,warnings,inLineup:true,spot,
      opposingStarterChange:oppStarterChange,
      opposingHandednessChange:oppHandednessChange,
    };
  }

  const isStarter=Number(snapshot[`${side}_starter_id`])===playerId;
  if (!isStarter) {
    return {role,side,state:"PASS",reasonCode:"PITCHER_NOT_CONFIRMED_STARTER",reasons:["Pitcher is not the current official probable starter."],warnings,isStarter:false};
  }
  if (!oppConfirmed) {
    const state=pendingOrPass(obs.starts_at);
    return {role,side,state,reasonCode:state==="PASS"?"OPPONENT_LINEUP_MISSING_AT_DEADLINE":"OPPONENT_LINEUP_PENDING",reasons:["Opponent starting lineup is not confirmed."],warnings,isStarter:true};
  }
  const catcherId=num(snapshot[`${side}_catcher_id`]);
  if (!catcherId) {
    const state=pendingOrPass(obs.starts_at);
    return {role,side,state,reasonCode:state==="PASS"?"CATCHER_MISSING_AT_DEADLINE":"CATCHER_PENDING",reasons:["Starting catcher is not confirmed."],warnings,isStarter:true};
  }

  const catcherChange=changeAfter(snapshot[`${side}_catcher_change_at`],obs.captured_at);
  const oppLineupChange=changeAfter(snapshot[`${opp}_lineup_change_at`],obs.captured_at);
  const starterChange=changeAfter(snapshot[`${side}_starter_change_at`],obs.captured_at);
  if (starterChange) reasons.push("Probable starter assignment changed after this pitcher-prop observation.");
  if (catcherChange) reasons.push("Starting catcher changed after this pitcher-prop observation.");
  if (oppLineupChange) reasons.push("Opponent batting order changed after this pitcher-prop observation.");

  const bp=snapshot[`${side}_bullpen`]||{};
  if (bp.level==="DEPLETED") warnings.push("Team bullpen is DEPLETED; starter leash may differ from baseline.");
  else if (bp.level==="WATCH") warnings.push("Team bullpen is on WATCH; starter leash may differ from baseline.");

  const remod=starterChange||catcherChange||oppLineupChange;
  const state=remod?"REMODEL":(bp.level==="DEPLETED"?"WATCH":"READY");
  return {
    role,side,state,
    reasonCode: remod
      ? (catcherChange?"CATCHER_CHANGED_AFTER_MODEL":starterChange?"STARTER_CHANGED_AFTER_MODEL":"OPPONENT_LINEUP_CHANGED_AFTER_MODEL")
      : state==="WATCH"?"BULLPEN_LEASH_WATCH":"VERIFICATION_READY",
    reasons,warnings,isStarter:true,
    catcherId,
    catcherName:snapshot[`${side}_catcher_name`]||null,
    catcherChange,
    opposingStarterChange:false,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({error:"POST only"}),{status:405,headers:{"content-type":"application/json"}});
    }
    const body=await req.json().catch(()=>({}));
    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const requested=Array.isArray(body.gamePks)?body.gamePks.map(Number).filter(Number.isFinite):[];
    const since=new Date(Date.now()-(requested.length?12*3600_000:30*60_000)).toISOString();
    const until=new Date(Date.now()+(requested.length?36*3600_000:180*60_000)).toISOString();

    const [marketRes,propRes]=await Promise.all([
      supabase.from("market_grade_latest").select("*")
        .gte("starts_at",since).lte("starts_at",until).not("game_pk","is",null),
      supabase.from("player_prop_latest").select("*")
        .gte("starts_at",since).lte("starts_at",until).not("game_pk","is",null),
    ]);
    if (marketRes.error) throw new Error("market query: "+JSON.stringify(marketRes.error));
    if (propRes.error) throw new Error("prop query: "+JSON.stringify(propRes.error));

    const allMarketRows=marketRes.data??[];
    const allPropRows=propRes.data??[];
    const marketRows=requested.length
      ? allMarketRows.filter((r:any)=>requested.includes(Number(r.game_pk)))
      : allMarketRows;
    const propRows=requested.length
      ? allPropRows.filter((r:any)=>requested.includes(Number(r.game_pk)))
      : allPropRows;
    const gameMap=new Map<number,any>();
    for (const r of [...marketRows,...propRows]) {
      const gp=Number(r.game_pk);
      if (!Number.isFinite(gp)) continue;
      if (!gameMap.has(gp)) gameMap.set(gp,{
        gamePk:gp,eventId:r.event_id??null,startsAt:r.starts_at??null,
        awayTeam:r.away_team??null,homeTeam:r.home_team??null
      });
    }
    for (const gp of requested) if(!gameMap.has(gp)) gameMap.set(gp,{gamePk:gp,eventId:null,startsAt:null});

    const snapshots:any[]=[];
    for (const game of gameMap.values()) {
      const feed=await fetchJson(`${MLB}/api/v1.1/game/${game.gamePk}/feed/live`);
      const startsAt=iso(game.startsAt??feed?.gameData?.datetime?.dateTime);
      const status=feed?.gameData?.status??{};
      const statusClear=
        status?.abstractGameState==="Preview" &&
        !/postponed|cancelled|suspended/i.test(String(status?.detailedState||""));

      const awayStarter=starterSummary(feed,"away");
      const homeStarter=starterSummary(feed,"home");
      const awayLineup=lineupSummary(feed,"away");
      const homeLineup=lineupSummary(feed,"home");
      const awayTeamId=Number(feed?.gameData?.teams?.away?.id);
      const homeTeamId=Number(feed?.gameData?.teams?.home?.id);

      const {data:history,error:histErr}=await supabase
        .from("mlb_verification_snapshots")
        .select("*").eq("game_pk",game.gamePk)
        .order("checked_at",{ascending:true}).limit(200);
      if(histErr) throw new Error("history query: "+JSON.stringify(histErr));
      const hist=history??[];
      const latest=hist.length?hist[hist.length-1]:null;

      let awayBullpen=latest?.away_bullpen??{};
      let homeBullpen=latest?.home_bullpen??{};
      const [awayComputed,homeComputed]=await Promise.all([
        freshBullpen(awayBullpen)
          ? Promise.resolve(awayBullpen)
          : bullpenStatus(awayTeamId,startsAt!),
        freshBullpen(homeBullpen)
          ? Promise.resolve(homeBullpen)
          : bullpenStatus(homeTeamId,startsAt!),
      ]);
      awayBullpen=awayComputed;
      homeBullpen=homeComputed;

      const baseAwayStarter=firstNonNull(hist,"away_starter_id")??awayStarter.id;
      const baseHomeStarter=firstNonNull(hist,"home_starter_id")??homeStarter.id;
      const baseAwayStarterHand=firstNonNull(hist,"away_starter_hand")??awayStarter.hand;
      const baseHomeStarterHand=firstNonNull(hist,"home_starter_hand")??homeStarter.hand;
      const baseAwayLineup=firstConfirmedFingerprint(hist,"away")??awayLineup.fingerprint;
      const baseHomeLineup=firstConfirmedFingerprint(hist,"home")??homeLineup.fingerprint;
      const baseAwayCatcher=firstConfirmedCatcher(hist,"away")??awayLineup.catcher?.id??null;
      const baseHomeCatcher=firstConfirmedCatcher(hist,"home")??homeLineup.catcher?.id??null;

      const nowIso=new Date().toISOString();
      const awayStarterChanged=Boolean(baseAwayStarter&&awayStarter.id&&Number(baseAwayStarter)!==Number(awayStarter.id));
      const homeStarterChanged=Boolean(baseHomeStarter&&homeStarter.id&&Number(baseHomeStarter)!==Number(homeStarter.id));
      const awayStarterHandChanged=Boolean(baseAwayStarterHand&&awayStarter.hand&&String(baseAwayStarterHand)!==String(awayStarter.hand));
      const homeStarterHandChanged=Boolean(baseHomeStarterHand&&homeStarter.hand&&String(baseHomeStarterHand)!==String(homeStarter.hand));
      const awayLineupChanged=Boolean(baseAwayLineup&&awayLineup.fingerprint&&baseAwayLineup!==awayLineup.fingerprint);
      const homeLineupChanged=Boolean(baseHomeLineup&&homeLineup.fingerprint&&baseHomeLineup!==homeLineup.fingerprint);
      const awayCatcherChanged=Boolean(baseAwayCatcher&&awayLineup.catcher?.id&&Number(baseAwayCatcher)!==Number(awayLineup.catcher.id));
      const homeCatcherChanged=Boolean(baseHomeCatcher&&homeLineup.catcher?.id&&Number(baseHomeCatcher)!==Number(homeLineup.catcher.id));

      const awayStarterChangeAt=existingChangeAt(hist,"away_starter_change_at") ?? (awayStarterChanged?nowIso:null);
      const homeStarterChangeAt=existingChangeAt(hist,"home_starter_change_at") ?? (homeStarterChanged?nowIso:null);
      const awayStarterHandChangeAt=existingChangeAt(hist,"away_starter_hand_change_at") ?? (awayStarterHandChanged?nowIso:null);
      const homeStarterHandChangeAt=existingChangeAt(hist,"home_starter_hand_change_at") ?? (homeStarterHandChanged?nowIso:null);
      const awayLineupChangeAt=existingChangeAt(hist,"away_lineup_change_at") ?? (awayLineupChanged?nowIso:null);
      const homeLineupChangeAt=existingChangeAt(hist,"home_lineup_change_at") ?? (homeLineupChanged?nowIso:null);
      const awayCatcherChangeAt=existingChangeAt(hist,"away_catcher_change_at") ?? (awayCatcherChanged?nowIso:null);
      const homeCatcherChangeAt=existingChangeAt(hist,"home_catcher_change_at") ?? (homeCatcherChanged?nowIso:null);

      const state=gameSnapshotState({
        statusClear,awayStarter,homeStarter,awayLineup,homeLineup,awayBullpen,homeBullpen,startsAt
      });

      const awayRosterIds=Object.values(feed?.liveData?.boxscore?.teams?.away?.players??{}).map((p:any)=>Number(p?.person?.id)).filter(Number.isFinite);
      const homeRosterIds=Object.values(feed?.liveData?.boxscore?.teams?.home?.players??{}).map((p:any)=>Number(p?.person?.id)).filter(Number.isFinite);

      const row:any={
        checked_at:nowIso,event_id:game.eventId,game_pk:game.gamePk,starts_at:startsAt,
        status_state:status?.abstractGameState??null,status_detail:status?.detailedState??null,status_clear:statusClear,
        away_team_id:awayTeamId,away_team:feed?.gameData?.teams?.away?.name??game.awayTeam??null,
        home_team_id:homeTeamId,home_team:feed?.gameData?.teams?.home?.name??game.homeTeam??null,
        away_starter_id:awayStarter.id,away_starter_name:awayStarter.name,away_starter_hand:awayStarter.hand,
        home_starter_id:homeStarter.id,home_starter_name:homeStarter.name,home_starter_hand:homeStarter.hand,
        away_lineup_confirmed:awayLineup.confirmed,away_lineup_count:awayLineup.count,away_lineup_fingerprint:awayLineup.fingerprint,
        away_lineup:awayLineup.lineup,away_catcher_id:awayLineup.catcher?.id??null,away_catcher_name:awayLineup.catcher?.name??null,
        away_notable_absences:awayLineup.notableAbsences,
        home_lineup_confirmed:homeLineup.confirmed,home_lineup_count:homeLineup.count,home_lineup_fingerprint:homeLineup.fingerprint,
        home_lineup:homeLineup.lineup,home_catcher_id:homeLineup.catcher?.id??null,home_catcher_name:homeLineup.catcher?.name??null,
        home_notable_absences:homeLineup.notableAbsences,
        away_bullpen:awayBullpen,home_bullpen:homeBullpen,
        away_starter_change_at:awayStarterChangeAt,home_starter_change_at:homeStarterChangeAt,
        away_starter_hand_change_at:awayStarterHandChangeAt,home_starter_hand_change_at:homeStarterHandChangeAt,
        away_lineup_change_at:awayLineupChangeAt,home_lineup_change_at:homeLineupChangeAt,
        away_catcher_change_at:awayCatcherChangeAt,home_catcher_change_at:homeCatcherChangeAt,
        starter_changed:awayStarterChanged||homeStarterChanged,
        handedness_changed:awayStarterHandChanged||homeStarterHandChanged,
        lineup_changed:awayLineupChanged||homeLineupChanged,
        catcher_changed:awayCatcherChanged||homeCatcherChanged,
        data_quality:state.dataQuality,snapshot_state:state.state,
        reasons:state.reasons,warnings:state.warnings,
        raw:{
          source:"MLB Stats live feed",
          awayRosterPlayerIds:awayRosterIds,
          homeRosterPlayerIds:homeRosterIds,
          baseline:{
            awayStarterId:baseAwayStarter,homeStarterId:baseHomeStarter,
            awayStarterHand:baseAwayStarterHand,homeStarterHand:baseHomeStarterHand,
            awayLineupFingerprint:baseAwayLineup,homeLineupFingerprint:baseHomeLineup,
            awayCatcherId:baseAwayCatcher,homeCatcherId:baseHomeCatcher
          }
        }
      };

      const {data:inserted,error:insErr}=await supabase.from("mlb_verification_snapshots").insert(row).select("*").single();
      if(insErr) throw new Error("snapshot insert: "+JSON.stringify(insErr));
      snapshots.push(inserted);

      const teamObs=marketRows.filter((x:any)=>Number(x.game_pk)===game.gamePk);
      for(const obs of teamObs){
        const g=teamGate(inserted,obs);
        const bpLevels=[inserted.away_bullpen?.level,inserted.home_bullpen?.level].filter(Boolean);
        const bp=bpLevels.includes("DEPLETED")?"DEPLETED":bpLevels.includes("WATCH")?"WATCH":"CLEAR";
        const payload={
          observation_id:Number(obs.id),evaluated_at:new Date().toISOString(),snapshot_id:inserted.id,
          state:g.state,reason_code:g.reasonCode,reasons:g.reasons,warnings:g.warnings,
          starter_change_after_model:Boolean(g.starterChange),
          handedness_change_after_model:Boolean(g.handednessChange),
          lineup_change_after_model:Boolean(g.lineupChange),
          catcher_change_after_model:Boolean(g.catcherChange),
          bullpen_status:bp,data_quality:inserted.data_quality,
          raw:{upstreamStatus:obs.non_sharp_status,marketType:obs.market_type,marketLabel:obs.market_label}
        };
        const {error}=await supabase.from("team_market_verification_shadow").upsert(payload,{onConflict:"observation_id"});
        if(error) throw new Error("team gate upsert: "+JSON.stringify(error));
      }

      const propObs=propRows.filter((x:any)=>Number(x.game_pk)===game.gamePk);
      for(const obs of propObs){
        const g:any=propGate(inserted,obs);
        const side=g.side;
        const payload={
          observation_id:Number(obs.id),evaluated_at:new Date().toISOString(),snapshot_id:inserted.id,
          player_role:g.role,player_team_side:side,state:g.state,reason_code:g.reasonCode,
          reasons:g.reasons,warnings:g.warnings,
          in_starting_lineup:g.inLineup??null,batting_order_spot:g.spot??null,
          is_confirmed_starter:g.isStarter??null,
          catcher_id:g.catcherId??(side?inserted[`${side}_catcher_id`]:null),
          catcher_name:g.catcherName??(side?inserted[`${side}_catcher_name`]:null),
          catcher_change_after_model:Boolean(g.catcherChange),
          opposing_starter_change_after_model:Boolean(g.opposingStarterChange),
          opposing_handedness_change_after_model:Boolean(g.opposingHandednessChange),
          data_quality:inserted.data_quality,
          raw:{upstreamStatus:obs.status,statId:obs.stat_id,label:obs.label}
        };
        const {error}=await supabase.from("player_prop_verification_shadow").upsert(payload,{onConflict:"observation_id"});
        if(error) throw new Error("prop gate upsert: "+JSON.stringify(error));
      }
    }

    return new Response(JSON.stringify({
      ok:true,
      version:"mlb-verification-gate-v1",
      shadowOnly:true,
      affectsDecision:false,
      capturedGames:snapshots.length,
      snapshots:snapshots.map((s:any)=>({
        id:s.id,gamePk:s.game_pk,eventId:s.event_id,state:s.snapshot_state,
        status:s.status_detail,
        starters:{
          away:{id:s.away_starter_id,name:s.away_starter_name,hand:s.away_starter_hand},
          home:{id:s.home_starter_id,name:s.home_starter_name,hand:s.home_starter_hand},
        },
        lineups:{
          away:{confirmed:s.away_lineup_confirmed,catcher:s.away_catcher_name,notableAbsences:s.away_notable_absences},
          home:{confirmed:s.home_lineup_confirmed,catcher:s.home_catcher_name,notableAbsences:s.home_notable_absences},
        },
        bullpen:{away:s.away_bullpen?.level,home:s.home_bullpen?.level},
        changes:{starter:s.starter_changed,handedness:s.handedness_changed,lineup:s.lineup_changed,catcher:s.catcher_changed},
        dataQuality:s.data_quality
      }))
    }),{headers:{"content-type":"application/json"}});
  } catch(error){
    return new Response(JSON.stringify({
      ok:false,error:error instanceof Error?error.message:JSON.stringify(error)
    }),{status:500,headers:{"content-type":"application/json"}});
  }
});