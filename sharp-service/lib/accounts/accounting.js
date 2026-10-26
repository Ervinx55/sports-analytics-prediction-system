/** Pure USD accounting. All public monetary values are safe integer cents. */
const enumValue=(value,allowed,label)=>{if(!allowed.includes(value))throw new Error(`Invalid ${label}`);return value;};
export function cents(value,signed=false){if(!Number.isSafeInteger(value)||(!signed&&value<0))throw new Error('Invalid cents');return value;}
export function iso(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Invalid ISO date');const day=value.slice(0,10);if(new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day)throw new Error('Invalid calendar date');return new Date(value).toISOString();}
function identifier(value,label){if(typeof value!=='string'||!value.trim()||value.length>200)throw new Error(`Invalid ${label}`);return value.trim();}
export function validateEntry(input){
 const e={...input};e.id=identifier(e.id,'id');e.accountId=identifier(e.accountId,'accountId');e.source=enumValue(e.source,['manual','import'],'source (Kalshi requires reconciliation)');e.kind=enumValue(e.kind,['cash','promo'],'kind');e.status=enumValue(e.status,['pending','won','lost','push','void','partial'],'status');
 for(const key of ['sport','description']){if(typeof e[key]!=='string'||e[key].length>4000)throw new Error(`Invalid ${key}`);}
 e.placedAt=iso(e.placedAt);e.settledAt=e.settledAt==null?null:iso(e.settledAt);e.stakeCents=cents(e.stakeCents);e.feeCents=cents(e.feeCents);e.returnCents=e.returnCents==null?null:cents(e.returnCents);
 if(typeof e.feeIncluded!=='boolean')throw new Error('Invalid feeIncluded');if(!Array.isArray(e.legs)||e.legs.length>100)throw new Error('Invalid legs');e.legs=JSON.parse(JSON.stringify(e.legs));
 for(const key of ['sourceId','predictionId','supersedes'])e[key]=e[key]==null?null:identifier(e[key],key);
 if(e.status==='pending'){if(e.settledAt!==null||e.returnCents!==null)throw new Error('Pending entry cannot be settled');}else{if(e.settledAt===null||e.returnCents===null||e.settledAt<e.placedAt)throw new Error('Invalid settlement');if(['push','void'].includes(e.status)&&e.returnCents!==e.stakeCents)throw new Error('Refund must return stake');if(e.status==='lost'&&e.returnCents!==0)throw new Error('Loss must return zero');if(e.status==='won'&&e.returnCents<=e.stakeCents)throw new Error('Win must exceed stake before fees');if(e.status==='partial'&&(e.returnCents<=0||e.returnCents>=e.stakeCents))throw new Error('Partial payout must be positive and below stake');}
 return e;
}
function add(a,b){return cents(a+b,true);}
const empty=()=>({profitCents:0,cashStakeCents:0,openExposureCents:0,promoProfitCents:0,wins:0,losses:0,pushes:0,voids:0,partials:0,settledEntries:0});
function ratios(t){t.roi=t.cashStakeCents?t.profitCents/t.cashStakeCents:null;t.winRate=t.wins+t.losses?t.wins/(t.wins+t.losses):null;return t;}
export function summarizeAccounts({accounts=[],entries=[],movements=[],filters={}}={}){
 const ids=new Map();for(const a of accounts){identifier(a.id,'account id');if(ids.has(a.id))throw new Error('Duplicate account');enumValue(a.provider,['prizepicks','kalshi','underdog','bovada'],'provider');cents(a.openingBalanceCents,true);iso(a.openingAt);if(typeof a.historyComplete!=='boolean'||typeof a.archived!=='boolean')throw new Error('Invalid coverage');ids.set(a.id,a);}
 const records=new Map(),successors=new Map();for(const input of entries){const e=validateEntry(input);if(!ids.has(e.accountId))throw new Error('Unknown account');if(records.has(e.id))throw new Error('Duplicate entry');records.set(e.id,e);}
 for(const e of records.values())if(e.supersedes){const previous=records.get(e.supersedes);if(!previous||previous.accountId!==e.accountId||successors.has(previous.id))throw new Error('Invalid correction predecessor or fork');successors.set(previous.id,e.id);}
 for(const e of records.values()){const seen=new Set();let p=e;while(p){if(seen.has(p.id))throw new Error('Correction cycle');seen.add(p.id);p=records.get(p.supersedes);}}
 const live=[...records.values()].filter(e=>!successors.has(e.id));
 const sourceIds=new Set();for(const e of live){if(e.sourceId){const key=JSON.stringify([e.accountId,e.source,e.sourceId]);if(sourceIds.has(key))throw new Error('Duplicate source identity');sourceIds.add(key);}}
 for(const m of movements){if(!ids.has(m.accountId))throw new Error('Unknown movement account');identifier(m.id,'movement id');enumValue(m.type,['deposit','withdrawal','bonus','adjustment'],'movement type');cents(m.amountCents,m.type==='adjustment');if(m.type!=='adjustment'&&m.amountCents===0)throw new Error('Movement must be positive');iso(m.occurredAt);}
 if(new Set(movements.map(m=>m.id)).size!==movements.length)throw new Error('Duplicate movement');
 const from=filters.from==null?null:iso(filters.from),to=filters.to==null?null:iso(filters.to);if(from&&to&&from>to)throw new Error('Invalid date range');
 const match=(value,filter)=>filter==null||(Array.isArray(filter)?filter.includes(value):value===filter);
 const results=[];for(const a of accounts){if(!match(a.provider,filters.provider)||!match(a.id,filters.accountId))continue;const totals=empty();let balance=a.openingBalanceCents;const checkpoint=iso(a.openingAt);let beforeCheckpoint=false;const effectiveFrom=from||checkpoint;const inDate=d=>d>=effectiveFrom&&(!to||d<=to);
 for(const m of movements.filter(m=>m.accountId===a.id)){if(iso(m.occurredAt)>=checkpoint)balance=add(balance,m.type==='withdrawal'?-m.amountCents:m.amountCents);}
 for(const e of live.filter(e=>e.accountId===a.id)){
 const fee=e.feeIncluded?0:e.feeCents;const profit=e.status==='pending'?null:add(add(e.returnCents,-e.stakeCents),-fee);
 if(e.placedAt<checkpoint)beforeCheckpoint=true;
 if(e.kind==='cash'){if(e.placedAt>=checkpoint)balance=add(balance,add(-e.stakeCents,-fee));if(e.settledAt&&e.settledAt>=checkpoint)balance=add(balance,e.returnCents);}
 if(!match(e.sport,filters.sport)||!match(e.source,filters.source))continue;
 if(e.status==='pending'){if(inDate(e.placedAt)&&e.kind==='cash')totals.openExposureCents=add(totals.openExposureCents,e.stakeCents);continue;}
 if(!inDate(e.settledAt))continue;
 if(e.kind==='promo'){totals.promoProfitCents=add(totals.promoProfitCents,profit);continue;}
 totals.profitCents=add(totals.profitCents,profit);totals.cashStakeCents=add(totals.cashStakeCents,e.stakeCents);totals.settledEntries++;const field={won:'wins',lost:'losses',push:'pushes',void:'voids',partial:'partials'}[e.status];totals[field]++;
 }
 const coverage={complete:a.historyComplete&&a.provider!=='kalshi'&&(!from||from>=checkpoint),historyComplete:a.historyComplete,from:from||checkpoint,to,reason:a.provider==='kalshi'?'kalshi_reconciliation_required':!a.historyComplete?'incomplete_history':from&&from<checkpoint?'before_checkpoint':null};
 results.push({accountId:a.id,provider:a.provider,name:a.name,archived:a.archived,...ratios(totals),coverage,reconciliation:{expectedBalanceCents:balance,from:checkpoint,filtered:false,complete:a.historyComplete&&a.provider!=='kalshi',hasEntriesBeforeCheckpoint:beforeCheckpoint}});
 }
 const combined=empty();for(const a of results)for(const k of Object.keys(combined))combined[k]=add(combined[k],a[k]);ratios(combined);combined.coverage={complete:results.length>0&&results.every(a=>a.coverage.complete),accountCount:results.length,incompleteAccountIds:results.filter(a=>!a.coverage.complete).map(a=>a.accountId)};return {accounts:results,combined};
}


