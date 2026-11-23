// Fixed read-only RPC adapter. Credentials remain in the Edge runtime.
export function performanceDatabaseClient(sql) {
 return {async rpc(name,args) {
  if(name!=='read_performance_v1')throw Error('Unsupported performance read');
  const rows=await sql.begin('read only',async tx=>{
   await tx.unsafe('set local role service_role');
   await tx.unsafe("set local statement_timeout = '8s'");
   return tx.unsafe('select public.read_performance_v1($1::timestamptz,$2::timestamptz,$3::text) as data',[args.p_from,args.p_to,args.p_sport]);
  });
  return {data:rows[0]?.data??null,error:null};
 }};
}
