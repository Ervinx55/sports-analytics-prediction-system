import {filterResearch,quoteFreshness} from './research-data.js';
import {createResearchLoader} from './research-loader.js';
const $=id=>document.getElementById(id);
const add=(parent,tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;parent.append(node);return node;};
const label=value=>String(value??'').replaceAll('_',' ');
const pct=value=>value===null?'Unavailable':`${(value*100).toFixed(1)}%`;
const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Unavailable';
const odds=value=>value===null?'Odds unavailable':`${value>0?'+':''}${value}`;
const difference=row=>row.model===null||row.market===null?'Unavailable':`${((row.model-row.market)*100).toFixed(1)} pp`;
const saved=new Map();let shortlist=false,shown=40,selected=null;
const loader=createResearchLoader({onChange:state=>{if(state.status==='loading'){$('detail').close();selected=null;}populate();render();}});
function button(parent,text,handler){const node=add(parent,'button',text);node.type='button';node.onclick=handler;return node;}
function current(row){return {...row,freshness:quoteFreshness(row.updatedAt,row.generatedAt)};}
function sourceRows(){return (shortlist?[...saved.values()].filter(r=>r.sport===loader.state.sport):loader.state.rows).map(current).filter(r=>Date.parse(r.startsAt)>Date.now());}
function populate(){for(const [id,key,title] of [['book','book','All books'],['market','marketType','All markets']]){const select=$(id),previous=select.value;select.replaceChildren();const first=add(select,'option',title);first.value='';for(const value of [...new Set(sourceRows().map(r=>r[key]))].sort()){const opt=add(select,'option',label(value));opt.value=value;}if([...select.options].some(o=>o.value===previous))select.value=previous;}}
function render(){
 const state=loader.state,all=sourceRows();const rows=filterResearch(all,{query:$('query').value,book:$('book').value,market:$('market').value,freshness:$('freshness').value});
 $('refresh').disabled=state.status==='loading';$('count').textContent=state.status==='ready'?state.rows.length:'—';$('modeled').textContent=state.status==='ready'?state.rows.filter(r=>r.model!==null).length:'—';$('fresh').textContent=state.status==='ready'?state.rows.filter(r=>current(r).freshness==='CURRENT').length:'—';$('saved-count').textContent=saved.size;
 $('shortlist-toggle').textContent=shortlist?'Back to board':'View shortlist';$('shortlist-toggle').setAttribute('aria-pressed',String(shortlist));
 for(const tab of document.querySelectorAll('[data-sport]'))tab.setAttribute('aria-pressed',String(tab.dataset.sport===state.sport));
 $('status').textContent=(state.message?`${state.message} `:'')+(state.status==='ready'||shortlist?`${rows.length} matching ${shortlist?'shortlisted':'research'} quotes · ${state.sport} · ${state.provider||'Provider unavailable'} · response ${date(state.generatedAt)}`:'');
 const target=$('cards');target.replaceChildren();$('more').hidden=rows.length<=shown;
 if(!rows.length){add(target,'div',state.status==='loading'&&!shortlist?'Fetching quotes and research estimates…':state.status==='error'&&!shortlist?'Quotes could not be loaded. This does not mean every market is PASS.':shortlist?'No upcoming shortlisted quotes match these filters. Shortlists are kept only for this page session.':all.length?'No quotes match these filters.':'No upcoming prop quotes were returned. Coverage may be unavailable or outside the provider window.','empty');return;}
 for(const row of rows.slice(0,shown)){
  const card=add(target,'article',undefined,'card');const head=add(card,'div',undefined,'card-head');add(head,'h3',row.player);add(head,'span',row.status,'badge');add(card,'p',`${row.away||'Away unavailable'} @ ${row.home||'Home unavailable'} · ${date(row.startsAt)}`,'match');add(card,'small',label(row.marketType).toUpperCase());add(card,'p',`${row.side} ${row.line??'Line unavailable'}`,'selection');add(card,'p',`${row.book} · ${odds(row.odds)}`,'quote');
  const compare=add(card,'div',undefined,'comparison');for(const [name,value] of [['Model estimate',pct(row.model)],['Market no-vig',pct(row.market)],['Difference',difference(row)]]){const cell=add(compare,'div');add(cell,'small',name);add(cell,'strong',value);}
  add(card,'p',`${row.freshness} timestamp · ${date(row.updatedAt)}`,'freshness '+(row.freshness==='CURRENT'?'current':''));
  add(card,'p',row.status==='SHADOW'?'Not cleared: this experimental estimate has not passed the production validation gate.':'Not cleared: this is a provider quote without a validated player prediction.','match');
  const actions=add(card,'div',undefined,'actions');button(actions,'View research',()=>openDetail(row));button(actions,saved.has(row.id)?'Remove saved':'Shortlist +',()=>{if(saved.has(row.id))saved.delete(row.id);else saved.set(row.id,structuredClone(row));render();});
 }
 $('more').textContent=`Show more · ${Math.min(shown,rows.length)} of ${rows.length}`;
}
function openDetail(row){selected=row;drawDetail();$('detail').showModal();}
function drawDetail(){if(!selected)return;const row=current(selected);$('detail-title').textContent=row.player;const body=$('detail-body');body.replaceChildren();add(body,'p',`${label(row.marketType)} · ${row.side} ${row.line??'Unavailable'} · ${row.book} ${odds(row.odds)}`,'selection');
 const section=(heading,copy)=>{const block=add(body,'section',undefined,'detail-section');add(block,'h3',heading);add(block,'p',copy);};
 section('Research status',`${row.status}. ${row.reason}`);
 section('Probability comparison',`Model estimate: ${pct(row.model)}. Market no-vig: ${pct(row.market)}. Difference: ${difference(row)}. These estimates do not authorize a play.`);
 section('Source and freshness',`${row.provider||'Provider unavailable'} · ${row.freshness}. Quote observed ${date(row.updatedAt)}; response generated ${date(row.generatedAt)}. Quote quality: ${label(row.quoteState)||'Unavailable'}. Current timestamps do not establish a validated model or player identity.`);
 section('Player history and matchup context','Game-log hit rates, injury verification, projected minutes and opponent splits are not connected to this view yet. No historical chart or context score is inferred from a price.');
 section('Tracking','Use the session shortlist to compare quotes. It is not a persisted model prediction or a placed wager. Model results and your actual account profit are tracked separately.');
}
for(const tab of document.querySelectorAll('[data-sport]'))tab.onclick=()=>{shown=40;$('query').value='';$('book').value='';$('market').value='';loader.load(tab.dataset.sport);};
for(const id of ['query','book','market','freshness'])$(id).addEventListener(id==='query'?'input':'change',()=>{shown=40;render();});
$('refresh').onclick=()=>loader.load(loader.state.sport);$('more').onclick=()=>{shown+=40;render();};$('shortlist-toggle').onclick=()=>{shortlist=!shortlist;shown=40;populate();render();};$('close-detail').onclick=()=>{$('detail').close();selected=null;};$('detail').addEventListener('close',()=>{selected=null;});
setInterval(()=>{render();if($('detail').open)drawDetail();},60000);loader.load('NBA');
