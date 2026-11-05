import {MLB_TABLES} from './performance-mlb-adapter.mjs';
/** Narrow database adapter: no arbitrary tables, SQL, or ledger methods from HTTP input. */
export function performanceCaptureDatabase(sql){
 const run=(mode,query,args)=>sql.begin(mode,async tx=>{
  await tx.unsafe('set local role service_role');
  await tx.unsafe("set local statement_timeout = '8s'");
  return tx.unsafe(query,args);
 });
 return {
  async rpc(name,{payload}){
   if(!['ingest_prediction_v1','ingest_sport_prediction_v1'].includes(name))throw Error('Unsupported capture function');
   const rows=await run('read write',`select public.${name}($1::jsonb) as data`,[JSON.stringify(payload)]);
   return {data:rows[0]?.data??null,error:null};
  },
  from(table){
   if(!MLB_TABLES.includes(table))throw Error('Unsupported observation table');
   let cursor=null;
   return {select(fields){if(fields!=='*')throw Error('Invalid fields');return this;},
    gt(field,value){if(field!=='id'||!Number.isSafeInteger(value)||value<0)throw Error('Invalid cursor');cursor=value;return this;},
    order(field,options){if(field!=='id'||options?.ascending!==true)throw Error('Invalid order');return this;},
    async limit(value){
     if(value!==500||cursor===null)throw Error('Invalid page');
     const rows=await run('read only',`select to_jsonb(o) as row from public.${table} o where sport='MLB' and id > $1::bigint order by id asc limit 500`,[cursor]);
     return {data:rows.map(x=>x.row),error:null};
    }
   };
  }
 };
}
