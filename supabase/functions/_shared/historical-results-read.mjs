const SPORTS=['MLB','NFL','NBA','CFB','NHL','TENNIS','SOCCER'];
export function parseHistoricalFilters(input={}){
 const sport=String(input.sport||'MLB').toUpperCase(),limit=Number(input.limit??50);
 if(!SPORTS.includes(sport)||!Number.isSafeInteger(limit)||limit<1)throw Error('INVALID_HISTORY_FILTERS');
 return {sport,limit:Math.max(10,Math.min(200,limit))};
}
export const historicalResultsQuery=`select jsonb_build_object(
 'grades',coalesce((select jsonb_agg(g order by starts_at desc,id desc) from (
 select id,captured_at,sport,model_version,event_id,game_pk,starts_at,away_team,home_team,side_key,side_name,model_decision,verification_status,best_book,best_odds,final_probability,edge_pct_points,result,won,closing_odds,closing_fair_probability,clv_implied_pp,model_vs_close_pp,graded_at
 from public.model_calibration_latest where sport=$1 order by starts_at desc,id desc limit $2)g),'[]'::jsonb),
 'results',coalesce((select jsonb_agg(g order by starts_at desc,event_id) from (
 select event_id,sport,game_pk,starts_at,away_team,home_team,away_score,home_score,total_runs,winner_side,final_status,graded_at
 from public.game_results where sport=$1 order by starts_at desc,event_id limit $2)g),'[]'::jsonb),
 'summary',jsonb_build_object(
 'auditRows',(select count(*) from public.model_audit_observations where sport=$1),
 'gameResults',(select count(*) from public.game_results where sport=$1),
 'grades',(select count(*) from public.candidate_grades g join public.model_audit_observations a on a.id=g.audit_id where a.sport=$1),
 'marketSnapshots',(select count(*) from public.market_snapshots where league=$1),
 'latestAuditAt',(select max(captured_at) from public.model_audit_observations where sport=$1),
 'latestSnapshotAt',(select max(captured_at) from public.market_snapshots where league=$1)
 )) as data`;
export async function readHistoricalResults(sql,input={},now=new Date()){
 const {sport,limit}=parseHistoricalFilters(input);
 const rows=await sql.begin('read only',async tx=>{
  await tx.unsafe('set local role service_role');
  await tx.unsafe("set local statement_timeout = '8s'");
  return tx.unsafe(historicalResultsQuery,[sport,limit]);
 });
 if(!rows[0]?.data)throw Error('HISTORY_READ_UNAVAILABLE');
 return {...rows[0].data,sport,fetchedAt:now.toISOString(),historyKind:'LEGACY_DIAGNOSTIC',warnings:['Historical model observations; these are not execution records or newly qualified PLAYs.']};
}
