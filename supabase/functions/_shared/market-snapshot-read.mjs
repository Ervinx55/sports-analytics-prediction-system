export async function readMarketSnapshots(sql,league,since){
 if(typeof league!=='string'||!/^[A-Z0-9_-]{1,30}$/.test(league)||!Number.isFinite(Date.parse(since)))throw Error('INVALID_MARKET_FILTERS');
 const rows=await sql.begin('read only',async tx=>{
  await tx.unsafe('set local role service_role');await tx.unsafe("set local statement_timeout = '8s'");
  return tx.unsafe('select to_jsonb(s) as row from (select captured_at,snapshot_label,league,event_id,starts_at,away_team,home_team,book,market,side,line,odds,available from public.market_snapshots where league=$1 and captured_at >= $2::timestamptz order by captured_at asc,id asc limit 12001) s',[league,since]);
 });
 if(rows.length>12000)throw Error('MARKET_READ_LIMIT_EXCEEDED');
 return rows.map(x=>x.row);
}
