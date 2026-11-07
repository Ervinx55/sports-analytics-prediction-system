import {summarizeAccounts,validateEntry,cents,iso} from '../accounts/accounting.js';
/** Actual protected-ledger observations only; no model/shadow or hypothetical inputs. */
export function summarizeSpecialties(snapshot,{groupBy='sport'}={}){
 if(!['sport','league','market','provider','strategy'].includes(groupBy))throw Error('Invalid specialty grouping');
 const coverage={complete:false,settledEntries:0,pendingEntries:0,unclassifiedEntries:0,unallocatedEntries:0,clvAvailable:false};
 if(!snapshot)return {available:false,rows:[],coverage};
 const summary=summarizeAccounts(snapshot);coverage.complete=summary.combined.coverage.complete;
 const accounts=new Map(snapshot.accounts.map(a=>[a.id,a]));
 const entries=snapshot.entries.map(validateEntry),superseded=new Set(entries.map(e=>e.supersedes).filter(Boolean)),groups=new Map();
 for(const e of entries){
  if(superseded.has(e.id))continue;
  if(e.status==='pending'){coverage.pendingEntries++;continue;}
  const a=accounts.get(e.accountId);if(e.settledAt<iso(a.openingAt))continue;
  coverage.settledEntries++;
  const m=e.strategyMetadata,unallocated=e.legs.length>1&&m?.assignment!=='entry';
  if(!m||m.strategy==='unclassified')coverage.unclassifiedEntries++;
  if(unallocated)coverage.unallocatedEntries++;
  const key=groupBy==='provider'?a.provider:unallocated?'unallocated':groupBy==='sport'?(e.sport.trim()||'unclassified'):groupBy==='strategy'?(m?.strategy??'unclassified'):(m?.[groupBy]??'unclassified');
  const id=JSON.stringify([key,e.kind]);
  if(!groups.has(id))groups.set(id,{key,kind:e.kind,sample:0,wins:0,losses:0,profitCents:0,stakeCents:0,roi:null,clv:null});
  const row=groups.get(id);row.sample++;if(e.status==='won')row.wins++;if(e.status==='lost')row.losses++;
  row.profitCents=cents(row.profitCents+e.returnCents-e.stakeCents-(e.feeIncluded?0:e.feeCents),true);row.stakeCents=cents(row.stakeCents+e.stakeCents);
 }
 const rows=[...groups.values()].map(r=>({...r,roi:r.kind==='cash'&&r.stakeCents?r.profitCents/r.stakeCents:null})).sort((a,b)=>a.key.localeCompare(b.key)||a.kind.localeCompare(b.kind));
 return {available:rows.length>0,rows,coverage};
}
