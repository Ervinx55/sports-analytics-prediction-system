import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROPS_URL = "https://sports-analytics-prediction-system-tau.vercel.app/api/props";
const BOOKS = ["draftkings","fanduel","betmgm","caesars"];

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function iso(v: unknown): string | null {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function implied(odds: unknown): number | null {
  const o = num(odds);
  if (o === null || o === 0) return null;
  return o > 0 ? 100/(o+100) : Math.abs(o)/(Math.abs(o)+100);
}
function fair(candidateOdds: unknown, opponentOdds: unknown): number | null {
  const a = implied(candidateOdds), b = implied(opponentOdds);
  if (a === null || b === null || a+b <= 0) return null;
  return a/(a+b);
}
function median(xs:number[]):number|null{
  if(!xs.length) return null;
  const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function eqLine(a:unknown,b:unknown){
  const x=num(a),y=num(b);
  return x!==null&&y!==null&&Math.abs(x-y)<0.001;
}
function bestAmerican(xs:number[]):number|null{
  if(!xs.length) return null;
  return Math.max(...xs);
}
async function fetchJson(url:string){
  const r=await fetch(url,{headers:{accept:"application/json"},cache:"no-store"});
  const text=await r.text();
  let body:any;
  try{body=JSON.parse(text)}catch{body={error:text.slice(0,500)}}
  if(!r.ok) throw new Error(`${r.status} ${url}: ${JSON.stringify(body).slice(0,500)}`);
  return body;
}
function latestAt(quotes:any[],cutoffMs:number){
  const map=new Map<string,any>();
  for(const q of quotes){
    const t=Date.parse(q.observed_at||"");
    if(!Number.isFinite(t)||t>cutoffMs) continue;
    const k=`${q.book}|${q.side}`;
    const cur=map.get(k);
    if(!cur||Date.parse(cur.observed_at)<t) map.set(k,q);
  }
  return [...map.values()];
}
function openingRefs(quotes:any[]){
  const map=new Map<string,any>();
  const sorted=[...quotes].sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at));
  for(const q of sorted){
    const k=`${q.book}|${q.side}`;
    if(map.has(k)) continue;
    map.set(k,{
      ...q,
      line:q.provider_open_line ?? q.line,
      odds:q.provider_open_odds ?? q.odds
    });
  }
  return [...map.values()];
}
function marketMetrics(rows:any[],decisionLine:number,selectedSide:string,decisionBook:string|null){
  const sideRows=rows.filter(q=>q.side===selectedSide&&q.available!==false&&num(q.line)!==null&&num(q.odds)!==null);
  const lines=sideRows.map(q=>Number(q.line));
  const consensusLine=median(lines);
  const exact=sideRows.filter(q=>eqLine(q.line,decisionLine));
  const bestOdds=bestAmerican(exact.map(q=>Number(q.odds)));
  const sameBook=decisionBook
    ? exact.find(q=>String(q.book).toLowerCase()===String(decisionBook).toLowerCase())
    : null;

  const byBook=new Map<string,{over?:any;under?:any}>();
  for(const q of rows){
    if(q.available===false||num(q.line)===null||num(q.odds)===null) continue;
    const book=String(q.book).toLowerCase();
    if(!byBook.has(book)) byBook.set(book,{});
    byBook.get(book)![q.side as "over"|"under"]=q;
  }
  const fairs:number[]=[];
  let paired=0;
  for(const pair of byBook.values()){
    const o=pair.over,u=pair.under;
    if(!o||!u||!eqLine(o.line,decisionLine)||!eqLine(u.line,decisionLine)) continue;
    const f=selectedSide==="over"?fair(o.odds,u.odds):fair(u.odds,o.odds);
    if(f!==null){fairs.push(f);paired++;}
  }
  const marketFair=fairs.length?fairs.reduce((a,b)=>a+b,0)/fairs.length:null;
  const quoteAt=sideRows.length
    ? new Date(Math.max(...sideRows.map(q=>Date.parse(q.observed_at)).filter(Number.isFinite))).toISOString()
    : null;

  return {
    consensusLine,
    bestOdds,
    sameBookOdds:sameBook?num(sameBook.odds):null,
    marketFair,
    quoteAt,
    bookCount:new Set(sideRows.map(q=>String(q.book).toLowerCase())).size,
    pairedBooks:paired
  };
}
function clvClass(finalized:boolean,close:any,lineClv:number|null,fairClv:number|null,sameClv:number|null,age:number|null){
  if(!finalized) return "TRACKING";
  if(!close||close.bookCount===0) return "NO_CLOSE";
  if(age!==null&&age>15) return "STALE_CLOSE";
  if(lineClv!==null&&lineClv>=0.49) return "POSITIVE_LINE_CLV";
  if(lineClv!==null&&lineClv<=-0.49) return "NEGATIVE_LINE_CLV";
  if(fairClv!==null&&fairClv>=0.5) return "POSITIVE_PRICE_CLV";
  if(fairClv!==null&&fairClv<=-0.5) return "NEGATIVE_PRICE_CLV";
  if(sameClv!==null&&sameClv>=0.5) return "POSITIVE_PRICE_CLV";
  if(sameClv!==null&&sameClv<=-0.5) return "NEGATIVE_PRICE_CLV";
  return "NEUTRAL_CLV";
}

Deno.serve(async(req)=>{
  try{
    if(req.method!=="POST"){
      return new Response(JSON.stringify({error:"POST only"}),{status:405,headers:{"content-type":"application/json"}});
    }
    const body=await req.json().catch(()=>({}));
    const windowMinutes=Math.max(60,Math.min(720,Number(body.windowMinutes||360)));
    const now=new Date();
    const startsAfter=now.toISOString();
    const startsBefore=new Date(now.getTime()+windowMinutes*60000).toISOString();

    const params=new URLSearchParams({
      books:BOOKS.join(","),
      limit:"100",
      startsAfter,
      startsBefore
    });
    const board=await fetchJson(`${PROPS_URL}?${params.toString()}`);
    const observedAt=new Date().toISOString();

    const quoteRows:any[]=[];
    for(const event of board?.events??[]){
      for(const prop of event?.props??[]){
        for(const side of ["over","under"]){
          const sideObj=prop?.[side];
          if(!sideObj) continue;
          for(const [book,q] of Object.entries(sideObj.books??{})){
            if(!BOOKS.includes(String(book).toLowerCase())) continue;
            const x:any=q;
            quoteRows.push({
              observed_at:observedAt,
              sport:"MLB",
              source:"SportsGameOdds v2",
              event_id:event.eventID,
              starts_at:event.startsAt??null,
              away_team:event?.matchup?.away?.name??null,
              home_team:event?.matchup?.home?.name??null,
              player_id:prop.playerID??null,
              player_name:prop.playerName,
              stat_id:prop.statID,
              market_name:prop.marketName??null,
              odd_id:sideObj.oddID??null,
              book:String(book).toLowerCase(),
              side,
              line:num(x.line),
              odds:num(x.odds),
              provider_open_line:num(x.openLine),
              provider_open_odds:num(x.openOdds),
              available:x.available??null,
              source_updated_at:iso(x.updatedAt),
              raw:{consensus:sideObj.consensus??null}
            });
          }
        }
      }
    }

    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if(quoteRows.length){
      const {error}=await supabase.from("player_prop_market_quotes").insert(quoteRows);
      if(error) throw new Error("quote insert: "+JSON.stringify(error));
    }

    const obsSince=new Date(now.getTime()-12*3600_000).toISOString();
    const obsUntil=new Date(now.getTime()+12*3600_000).toISOString();
    const {data:observations,error:oe}=await supabase
      .from("player_prop_latest")
      .select("*")
      .eq("sport","MLB")
      .gte("starts_at",obsSince)
      .lte("starts_at",obsUntil)
      .order("starts_at",{ascending:true})
      .limit(5000);
    if(oe) throw new Error("observation query: "+JSON.stringify(oe));

    const eventIds=[...new Set((observations??[]).map((o:any)=>String(o.event_id)).filter(Boolean))];
    const quoteHistory:any[]=[];
    if(eventIds.length){
      const historySince=new Date(now.getTime()-24*3600_000).toISOString();
      for(let offset=0;offset<50000;offset+=1000){
        const {data:page,error:qe}=await supabase
          .from("player_prop_market_quotes")
          .select("*")
          .in("event_id",eventIds)
          .gte("observed_at",historySince)
          .order("observed_at",{ascending:true})
          .range(offset,offset+999);
        if(qe) throw new Error("quote history: "+JSON.stringify(qe));
        quoteHistory.push(...(page??[]));
        if((page??[]).length<1000) break;
      }
    }

    const upserts:any[]=[];
    for(const o of observations??[]){
      const decisionLine=num(o.line);
      if(decisionLine===null||!o.starts_at||!o.player_name||!o.stat_id||!o.side) continue;
      const startsMs=Date.parse(o.starts_at);
      if(!Number.isFinite(startsMs)) continue;

      const marketQuotes=quoteHistory.filter((q:any)=>
        q.event_id===o.event_id &&
        String(q.player_id??"")===String(o.player_id??"") &&
        q.stat_id===o.stat_id
      );
      if(now.getTime()>=startsMs && marketQuotes.length===0) continue;
      const openRows=openingRefs(marketQuotes);
      const open=marketMetrics(openRows,decisionLine,o.side,o.best_book??null);

      const cutoffMs=Math.min(now.getTime(),startsMs);
      const currentRows=latestAt(marketQuotes,cutoffMs);
      const current=marketMetrics(currentRows,decisionLine,o.side,o.best_book??null);
      const finalized=now.getTime()>=startsMs;
      const close=finalized?current:null;

      const decisionImp=implied(o.best_odds);
      const closeAt=close?.quoteAt?Date.parse(close.quoteAt):NaN;
      const closeAge=finalized&&Number.isFinite(closeAt)
        ? Math.max(0,(startsMs-closeAt)/60000)
        : null;

      const lineMoveOpenCurrent=
        open.consensusLine!==null&&current.consensusLine!==null
          ? Number((current.consensusLine-open.consensusLine).toFixed(3))
          : null;
      const lineMoveOpenClose=
        finalized&&open.consensusLine!==null&&close?.consensusLine!==null
          ? Number((close.consensusLine-open.consensusLine).toFixed(3))
          : null;

      let lineClv:number|null=null;
      if(finalized&&close?.consensusLine!==null){
        lineClv=o.side==="over"
          ? close.consensusLine-decisionLine
          : decisionLine-close.consensusLine;
        lineClv=Number(lineClv.toFixed(3));
      }

      const fairClv=
        finalized&&close?.marketFair!==null&&num(o.market_fair_probability)!==null
          ? Number(((close.marketFair-Number(o.market_fair_probability))*100).toFixed(3))
          : null;
      const sameCloseImp=finalized?implied(close?.sameBookOdds):null;
      const sameBookClv=
        decisionImp!==null&&sameCloseImp!==null
          ? Number(((sameCloseImp-decisionImp)*100).toFixed(3))
          : null;
      const bestCloseImp=finalized?implied(close?.bestOdds):null;
      const bestClv=
        decisionImp!==null&&bestCloseImp!==null
          ? Number(((bestCloseImp-decisionImp)*100).toFixed(3))
          : null;

      upserts.push({
        observation_id:Number(o.id),
        refreshed_at:new Date().toISOString(),
        finalized_at:finalized?new Date().toISOString():null,
        finalized,
        event_id:o.event_id,
        game_pk:o.game_pk??null,
        starts_at:o.starts_at,
        player_id:o.player_id??null,
        player_name:o.player_name,
        stat_id:o.stat_id,
        label:o.label??null,
        side:o.side,
        decision_line:decisionLine,
        decision_book:o.best_book??null,
        decision_odds:o.best_odds??null,
        decision_implied_probability:decisionImp,
        decision_market_fair_probability:num(o.market_fair_probability),

        opening_consensus_line:open.consensusLine,
        opening_best_odds_at_decision_line:open.bestOdds,
        opening_market_fair_probability:open.marketFair,

        current_consensus_line:current.consensusLine,
        current_best_odds_at_decision_line:current.bestOdds,
        current_same_book_odds:current.sameBookOdds,
        current_market_fair_probability:current.marketFair,
        current_quote_at:current.quoteAt,

        closing_consensus_line:finalized?close?.consensusLine:null,
        closing_best_odds_at_decision_line:finalized?close?.bestOdds:null,
        closing_same_book_odds:finalized?close?.sameBookOdds:null,
        closing_market_fair_probability:finalized?close?.marketFair:null,
        close_quote_at:finalized?close?.quoteAt:null,
        close_quote_age_minutes:closeAge,
        close_book_count:finalized?(close?.bookCount??0):0,
        close_paired_books:finalized?(close?.pairedBooks??0):0,

        line_move_open_to_current:lineMoveOpenCurrent,
        line_move_open_to_close:lineMoveOpenClose,
        line_clv_units:lineClv,
        fair_probability_clv_pp:fairClv,
        same_book_price_clv_pp:sameBookClv,
        best_market_price_clv_pp:bestClv,

        clv_classification:clvClass(finalized,close,lineClv,fairClv,sameBookClv,closeAge),
        raw:{
          evaluatorVersion:"player-prop-clv-v1",
          source:"own pregame snapshots only",
          books:BOOKS,
          openingBookCount:open.bookCount,
          openingPairedBooks:open.pairedBooks,
          currentBookCount:current.bookCount,
          currentPairedBooks:current.pairedBooks
        }
      });
    }

    if(upserts.length){
      for(let i=0;i<upserts.length;i+=500){
        const {error}=await supabase.from("player_prop_clv")
          .upsert(upserts.slice(i,i+500),{onConflict:"observation_id"});
        if(error) throw new Error("clv upsert: "+JSON.stringify(error));
      }
    }

    return new Response(JSON.stringify({
      ok:true,
      version:"player-prop-clv-v1",
      observedAt,
      windowMinutes,
      capturedQuotes:quoteRows.length,
      trackedObservations:upserts.length,
      finalized:upserts.filter(x=>x.finalized).length,
      classifications:upserts.reduce((a:any,x:any)=>{
        a[x.clv_classification]=(a[x.clv_classification]||0)+1;return a;
      },{})
    }),{headers:{"content-type":"application/json"}});
  }catch(error){
    return new Response(JSON.stringify({
      ok:false,
      error:error instanceof Error?error.message:JSON.stringify(error)
    }),{status:500,headers:{"content-type":"application/json"}});
  }
});