import {appendDeepDive,preserveDeepDives} from './deep-dive.js';
export function isCurrentPlay(row,data,now=Date.now()){
 const stamp=Date.parse(data?.generatedAt),issued=Date.parse(row?.issuedAt),expires=Date.parse(row?.validUntil),start=Date.parse(row?.startsAt);
 return data?.contract==='nba-reviewed-live-v1'&&row?.status==='PLAY'&&row.productionEligible===true&&row.productionWeight===1&&typeof row.approvalId==='string'&&Number.isFinite(stamp)&&stamp<=now&&now-stamp<30000&&issued<=now&&now-issued<600000&&expires>now&&start>now;
}
if(typeof document!=='undefined'){
 const section=document.createElement('section');section.className='notice';section.setAttribute('aria-label','Reviewed NBA prop decisions');
 const title=document.createElement('h2');title.textContent='Reviewed NBA prop decisions';section.append(title);
 const status=document.createElement('p');status.setAttribute('role','status');section.append(status);
 const list=document.createElement('div');list.className='cards';section.append(list);(document.querySelector('main')||document.querySelector('.app')||document.body).prepend(section);
 let data=null,controller=null;
 const percent=x=>typeof x==='number'&&Number.isFinite(x)?(100*x).toFixed(1)+'%':'Unavailable';
 function render(){
  preserveDeepDives(list);list.replaceChildren();const rows=data?.decisions??[];const plays=rows.filter(r=>isCurrentPlay(r,data));
  status.textContent=!data?'Live decision verification unavailable. No plays cleared.':`${plays.length} currently cleared · ${rows.length} decisions checked. Approval, availability and exact prices are required. Rechecked every 15 seconds.`;
  const shown=[...plays,...rows.filter(r=>!isCurrentPlay(r,data))].slice(0,20);
  if(data&&!rows.length)status.textContent='No reviewed live decisions yet. Collection continues; a completed review is required before a model can clear plays.';
  for(const r of shown){
   const card=document.createElement('article');card.className='card';const clear=isCurrentPlay(r,data);
   const h=document.createElement('h3');h.textContent=(clear?'PLAY — cleared: ':'PASS — do not play: ')+(r.playerName||String(r.playerID||'Player').replaceAll('_',' '));card.append(h);
   const details=[`${r.side} ${r.line} ${r.market} · ${r.book} · odds ${r.odds>0?'+':''}${r.odds}`,`Model ${percent(r.modelProbability)} · Market ${percent(r.marketProbability)}`,`Decision: ${new Date(r.issuedAt).toLocaleString()} · Valid until ${new Date(r.validUntil).toLocaleString()}`,clear?'Recheck the exact price before acting.':r.status==='PLAY'?'Live clearance expired; waiting for fresh verification.':r.reason];
   for(const value of details){const p=document.createElement('p');p.textContent=value;card.append(p);}appendDeepDive(card,r,{scope:"nba-live",presentation:{title:clear?"PLAY — cleared":"PASS — do not play",reason:clear?"All live approval checks passed.":r.status==="PLAY"?"Live clearance expired; waiting for fresh verification.":r.reason}});list.append(card);
  }
 }
 async function refresh(){controller?.abort();const current=new AbortController();controller=current;const timer=setTimeout(()=>current.abort(),12000);
  try{const r=await fetch('/api/dashboard?nbaLive=1',{cache:'no-store',signal:current.signal});const b=await r.json();if(!r.ok||b.contract!=='nba-reviewed-live-v1'||!Array.isArray(b.decisions))throw Error('Unavailable');if(controller===current)data=b;}
  catch{if(controller===current)data=null;}finally{clearTimeout(timer);if(controller===current)render();}
 }
 refresh();setInterval(refresh,15000);setInterval(render,1000);
}
