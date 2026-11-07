import { parseImportCsv } from './csv.js';
export function dollarsToCents(value, signed = false) {
 if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value) || (!signed && value.startsWith('-'))) throw Error('Enter dollars with at most two decimal places.');
 const [whole,fraction=''] = value.replace('-','').split('.');
 const amount = (BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))) * (value.startsWith('-')?-1n:1n);
 if (amount>BigInt(Number.MAX_SAFE_INTEGER)||amount<BigInt(Number.MIN_SAFE_INTEGER)) throw Error('Amount exceeds supported range.');
 return Number(amount);
}
export function createAccountsClient({fetchImpl=fetch,onChange=()=>{},now=Date.now}={}) {
 let config=null, token=null, expires=0, epoch=0, timer, snapshot=null, reviewed=null;
 const state=()=>({ready:config?.ready===true,signedIn:!!token,snapshot});
 const notify=()=>onChange(state());
 function clear(){epoch++;token=null;expires=0;snapshot=null;reviewed=null;clearTimeout(timer);notify();}
 async function request(url,options={}) {
  const response=await fetchImpl(url,{...options,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  let data;try{data=await response.json();}catch{if(response.ok)throw Error('Invalid response.');data={};}
  if(!response.ok){const e=Error(['LEDGER_CAPACITY_EXCEEDED','WRITE_REJECTED','SETUP_NEEDED'].includes(data?.error)?data.error:'Request unavailable. Try again.');e.status=response.status;throw e;}
  return data;
 }
 function authOptions(body,bearer){return {method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json',...(bearer?{Authorization:`Bearer ${bearer}`}:{})},...(body?{body:JSON.stringify(body)}:{})};}
 function requireSession(){if(!token||now()>=expires){clear();throw Error('Sign in to continue.');}}
 async function privateRequest(url,body){
  requireSession();const generation=epoch;
  try {const data=await request(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return generation===epoch?data:null;}
  catch(e){if(generation===epoch){if([401,403].includes(e.status))clear();else {if(!body)snapshot=null;notify();}}throw e;}
 }
 const client={
  get state(){if(token&&now()>=expires)clear();return state();},
  async init(){config=(await request('/api/accounts?view=config')).data;notify();return state();},
  async sendCode(email){if(!config?.ready)throw Error('Private login needs setup.');await request(`${config.supabaseUrl}/auth/v1/otp`,authOptions({email,create_user:false}));},
  async verifyCode(email,code){
   if(!config?.ready)throw Error('Private login needs setup.');const generation=++epoch;
   const data=await request(`${config.supabaseUrl}/auth/v1/verify`,authOptions({email,token:code,type:'email'}));
   if(generation!==epoch)return;
   if(typeof data.access_token!=='string'||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw Error('Invalid login response.');
   token=data.access_token;expires=now()+Math.min(data.expires_in,86400)*1000;
   clearTimeout(timer);timer=setTimeout(clear,expires-now());timer.unref?.();notify();
  },
  async refresh(){const data=await privateRequest('/api/accounts?view=snapshot');if(data){snapshot=data.data;notify();}return snapshot;},
  prepareWrite(body){requireSession();return Object.freeze({...structuredClone(body),requestId:crypto.randomUUID()});},
  async save(prepared){return privateRequest('/api/accounts',prepared);},
  prepareImport(csv){reviewed=null;const parsed=parseImportCsv(csv);if(parsed.errors.length||!parsed.rows.length)throw Error(parsed.errors.map(e=>`Row ${e.row}: ${e.message}`).join('\n')||'No entries.');reviewed=client.prepareWrite({action:'import',csv});return parsed;},
  async saveImport(){if(!reviewed)throw Error('Review a valid CSV before saving.');const result=await client.save(reviewed);if(result)reviewed=null;return result;},
  clearImport(){reviewed=null;},
  async logout(){const previous=token;clear();if(previous&&config?.ready){try{await request(`${config.supabaseUrl}/auth/v1/logout?scope=local`,authOptions(null,previous));}catch{ /* Local private state is already cleared. */ }}}
 };
 return client;
}

export function centsToDollars(value){
 if(!Number.isSafeInteger(value))throw Error('Invalid cents');
 const amount=BigInt(value),absolute=amount<0n?-amount:amount;
 return `${amount<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;
}
export function historyPage(entries,page=0){
 const replaced=new Set(entries.map(e=>e.supersedes).filter(Boolean));
 const live=entries.filter(e=>!replaced.has(e.id)).sort((a,b)=>b.placedAt.localeCompare(a.placedAt)||a.id.localeCompare(b.id));
 const pages=Math.max(1,Math.ceil(live.length/200));const current=Math.max(0,Math.min(pages-1,page));
 return {rows:live.slice(current*200,(current+1)*200),page:current,pages,total:live.length};
}
export function localDateInput(value){const d=value?new Date(value):new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,23);}
export function preserveLegs(text,previous=[]){const original=previous.map(l=>typeof l==='string'?l:JSON.stringify(l)).join('\n');return text===original?structuredClone(previous):text.split('\n').filter(Boolean);}
