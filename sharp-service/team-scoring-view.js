// Historical explanation only. This renderer never calculates a forecast or decision.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=value=>typeof value==='string'&&value.trim()?value:'Unavailable';
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:'Unavailable';
const windowFor=(team,key)=>Array.isArray(team?.windows)?team.windows.find(w=>w?.key===key):undefined;
const count=window=>Number.isInteger(window?.gameCount)&&window.gameCount>=0?window.gameCount:null;
const average=(window,field)=>count(window)>0&&typeof window?.[field]==='number'&&Number.isFinite(window[field])&&window[field]>=0?window[field].toFixed(1)+'/game':'Unavailable';
const sample=(window,recent=false)=>count(window)===null?'Sample unavailable':`${count(window)}${recent&&[5,10].includes(window.requestedGames)?' of '+window.requestedGames:''} games`;
const teamName=(team,side)=>text(team?.teamName||team?.teamId||`${side} team`);
function teamLine(team,side,key,recent=false){
 const window=windowFor(team,key);
 return `<p><strong>${esc(teamName(team,side))}</strong>: scores ${average(window,'pointsFor')} · allows ${average(window,'pointsAgainst')} · ${sample(window,recent)}</p>`;
}
export function teamScoringHtml(context){
 const valid=context?.contract==='team-scoring-context-v1'&&context.purpose==='EXPLANATION_ONLY'&&context.adjustmentApplied===false;
 const note='<p class="team-scoring-note">Historical averages, not predicted scores. Context only; no forecast adjustment.</p>';
 if(!valid)return `<div class="team-scoring"><h4>Historical team scoring</h4><p>Unavailable — verified scoring history was not supplied for this game.</p>${note}</div>`;
 const teams=[['away','Away'],['home','Home']];
 const summary=teams.map(([side,name])=>teamLine(context[side],name,'history')).join('');
 const windows=['history','last5','last10'].map(key=>{
  const label=windowFor(context.home,key)?.label||windowFor(context.away,key)?.label||({history:'Available history',last5:'Last 5',last10:'Last 10'})[key];
  return `<section><h5>${esc(label)}</h5>${teams.map(([side,name])=>{
   const window=windowFor(context[side],key);
   return teamLine(context[side],name,key,key!=='history')+`<p class="team-scoring-evidence">${esc(teamName(context[side],name))} latest included game: ${esc(stamp(window?.latestGameAt))}.${window?.missingReason?' '+esc(window.missingReason):''}</p>`;
  }).join('')}</section>`;
 }).join('');
 return `<div class="team-scoring"><h4>Historical team scoring</h4><p class="team-scoring-scope">${esc(text(context.scope))}</p><div class="team-scoring-summary">${summary}</div>${note}<details><summary>Recent windows &amp; sources</summary><div class="team-scoring-windows">${windows}</div><p class="team-scoring-evidence">Source: ${esc(text(context.source))}. Data cutoff: ${esc(stamp(context.cutoffAt))}. Observed: ${esc(stamp(context.observedAt))}.</p></details></div>`;
}
export function appendTeamScoring(parent,context){
 const template=document.createElement('template');template.innerHTML=teamScoringHtml(context);parent.append(template.content);
}
if(typeof document!=='undefined'){
 const style=document.createElement('style');
 style.textContent='.team-scoring{min-width:0;max-width:100%;margin:12px 0;padding:12px;border:1px solid var(--line,var(--border,#393642));border-radius:10px;overflow-wrap:anywhere;white-space:normal;font-size:13px;line-height:1.5;text-align:left}.team-scoring h4{font-size:14px;margin:0 0 6px}.team-scoring h5{font-size:13px;margin:12px 0 4px}.team-scoring p{margin:6px 0}.team-scoring .team-scoring-note,.team-scoring .team-scoring-scope,.team-scoring .team-scoring-evidence{font-size:12px;color:var(--muted,#b2afc2)}.team-scoring summary{cursor:pointer;padding:10px 0;min-height:44px}.team-scoring summary:focus-visible{outline:3px solid var(--accent,#a78bfa);outline-offset:2px}.team-scoring-windows section{border-top:1px solid var(--line,var(--border,#393642));padding-bottom:6px}.team-scoring strong{font-size:inherit}@media(max-width:650px){.team-scoring{padding:10px}}';
 document.head.append(style);
}
