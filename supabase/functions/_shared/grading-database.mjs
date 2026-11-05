const tables={prop:['player_prop_observations','player_prop_results',5000],team:['market_grade_observations','team_market_results',10000]};
const fields={prop:'observation_id,event_id,game_pk,player_id,mlb_player_id,stat_id,line,side,actual_value,outcome,won,pushed,graded_at,raw',team:'observation_id,event_id,game_pk,market_type,market_side,market_label,line,decision_status,actual_value,away_score,home_score,outcome,won,pushed,pass_evaluation,graded_at,raw'};
export function gradingRepository(sql){
 const table=kind=>{if(!Object.hasOwn(tables,kind))throw Error('Unsupported grading kind');return tables[kind];};
 const run=(query,args,write=false)=>sql.begin(write?'read write':'read only',async tx=>{await tx.unsafe('set local role service_role');await tx.unsafe("set local statement_timeout = '8s'");return tx.unsafe(query,args);});
 return {
 async authorized(header){
  if(typeof header!=='string'||!header.startsWith('Bearer ')||header.length<8)return false;
  // Compare in the database; the stored pipeline credential never leaves Vault.
  const rows=await sql.begin('read only',async tx=>{await tx.unsafe("set local statement_timeout = '3s'");return tx.unsafe("select exists(select 1 from vault.decrypted_secrets where name='snapshot_publishable_key' and decrypted_secret=$1) as allowed",[header.slice(7)]);});
  return rows[0]?.allowed===true;
 },
 async observations(kind,floor,cutoff){const [source,,limit]=table(kind);return (await run(`select to_jsonb(o) as row from public.${source} o where sport='MLB' and starts_at >= $1::timestamptz and starts_at <= $2::timestamptz order by starts_at desc,id desc limit ${limit}`,[floor,cutoff])).map(x=>x.row);},
 async existing(kind,ids){const [,target]=table(kind);return run(`select observation_id from public.${target} where observation_id=any($1::bigint[])`,[ids]);},
 async sharp(eventIds){return (await run('select to_jsonb(s) as row from public.sharp_gate_history s where sport=\'MLB\' and event_id=any($1::text[]) order by checked_at desc,id desc',[eventIds])).map(x=>x.row);},
 async save(kind,rows){const [,target]=table(kind);if(!Array.isArray(rows)||rows.length>10000)throw Error('Invalid grading batch');if(!rows.length)return 0;
 const cols=fields[kind];const saved=await run(`insert into public.${target} (${cols}) select ${cols} from jsonb_populate_recordset(null::public.${target},$1::jsonb) on conflict (observation_id) do nothing returning observation_id`,[JSON.stringify(rows)],true);return saved.length;
 }
 };
}
