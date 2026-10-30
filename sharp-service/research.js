import {filterResearch,refreshResearchRow} from './research-data.js';
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
function current(row){return refreshResearchRow(row);}
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
  const card=add(target,'article',undefined,'card');const head=add(card,'div',undefined,'card-head');add(head,'h3',row.player);add(head,'span','NOT CLEARED','badge');add(card,'p',`${row.away||'Away unavailable'} @ ${row.home||'Home unavailable'} · ${date(row.startsAt)}`,'match');add(card,'small',label(row.marketType).toUpperCase());add(card,'p',`${row.side} ${row.line??'Line unavailable'}`,'selection');add(card,'p',`${row.book} · ${odds(row.odds)}`,'quote');
  const compare=add(card,'div',undefined,'comparison');for(const [name,value] of [['Model chance*',pct(row.model)],['Book chance',pct(row.market)],['Gap (points)',difference(row).replace(' pp','')]]){const cell=add(compare,'div');add(cell,'small',name);add(cell,'strong',value);}
  add(card,'p',`${row.freshness} timestamp · ${date(row.updatedAt)}`,'freshness '+(row.freshness==='CURRENT'?'current':''));
  add(card,'p',row.status==='SHADOW'?'Research only. The model chance is experimental; it is not a betting recommendation.':'Research only. We have odds, but no validated player prediction yet.','match');
  const actions=add(card,'div',undefined,'actions');button(actions,'Why isn’t this cleared?',()=>openDetail(row));button(actions,saved.has(row.id)?'Remove saved':'Shortlist +',()=>{if(saved.has(row.id))saved.delete(row.id);else saved.set(row.id,structuredClone(row));render();});
 }
 $('more').textContent=`Show more · ${Math.min(shown,rows.length)} of ${rows.length}`;
}
function openDetail(row){selected=row;drawDetail();$('detail').showModal();}
function drawDetail(){
 if(!selected)return;
 const expanded=$('detail-body').querySelector('details')?.open||false;
 const row=current(selected),context=row.context,body=$('detail-body');
 $('detail-title').textContent=row.player;body.replaceChildren();
 const section=(heading,copy,className='detail-section')=>{const block=add(body,'section',undefined,className);add(block,'h3',heading);if(copy)add(block,'p',copy);return block;};
 const number=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(1):null;
 const unit=label(row.marketType).replace('receiving receptions','receptions');
 add(body,'p',(row.side==='OVER'?'More than':'Less than')+' '+(row.line??'?')+' '+unit,'selection');
 add(body,'p',row.book+' · '+odds(row.odds)+' · '+date(row.startsAt),'muted');
 section('NOT CLEARED — research only',row.model===null?'We have sportsbook odds, but no validated prediction for this player yet.':'The model is still being tested. Its estimated chance has not earned approval for live plays.','decision-summary');
 section('What the percentages mean','Model chance: '+pct(row.model)+'. Book chance: '+pct(row.market)+'. The book chance comes from both sides of the same bet, with the bookmaker margin removed. A gap between them does not prove an advantage.');
 if(row.freshness!=='CURRENT')section('Odds need refreshing',row.freshness==='STALE'?'These odds are over 10 minutes old. The market comparison is hidden until fresh prices arrive.':'We cannot verify when these odds were updated. The market comparison is hidden.');
 const evidence=[];
 const fact=(title,value,explanation,feature)=>{
  const block=add(body,'section',undefined,'context-fact');
  add(block,'h3',title);add(block,'strong',value??'Not enough data');
  add(block,'p',value===null?'We do not have enough verified history for this measure.':explanation);
  if(feature){const games=feature.gameCount??feature.sampleCount;add(block,'small','Based on '+(games??0)+' '+(feature.gameCount!=null?'games':context?.features&&title==='Opponent vs this position'?'player appearances':'games'));evidence.push({title,feature});}
 };
 if(context?.features){
  const f=context.features;
  fact('Recent player average',number(f.recentPlayerAverage?.value)===null?null:number(f.recentPlayerAverage.value)+' '+unit,'Average over the most recent available games, up to 5. This is history, not a prediction.',f.recentPlayerAverage);
  fact('Usual playing time',number(f.expectedMinutes?.value)===null?null:number(f.expectedMinutes.value)+' minutes','Average minutes played in the available sample, up to 10 games. Minutes for the next game are not confirmed.',f.expectedMinutes);
  fact('History-based estimate',number(context.baselineProjection)===null?null:number(context.baselineProjection)+' '+unit,'Uses past minutes and production per minute. It does not yet account for confirmed injuries or a validated matchup adjustment.');
  fact('Team recent results',number(f.winRate?.value)===null?null:Math.round(f.winRate.value*100)+'% wins','Win percentage in the available team sample. This is not the chance of winning the next game.',f.winRate);
  fact('Team scoring',number(f.offensiveRating?.value)===null?null:number(f.offensiveRating.value)+' points','Points scored per 100 estimated possessions. A possession is one team’s chance to score.',f.offensiveRating);
  fact('Team defense',number(f.defensiveRating?.value)===null?null:number(f.defensiveRating.value)+' points allowed','Points allowed per 100 estimated possessions. Lower means fewer points conceded in this sample; no league rank is verified.',f.defensiveRating);
  fact('Opponent vs this position',number(f.defenseVsPosition?.value)===null?null:number(f.defenseVsPosition.value)+' '+unit,'Average allowed per opposing player appearance at this historical position. Playing time varies, so this is not a prediction for this player.',f.defenseVsPosition);
 }else if(context?.teamForm){
  fact('Team recent results',number(context.teamForm.value)===null?null:Math.round(context.teamForm.value*100)+'% result rate','Last available games, up to 5. A win counts as 1 and a tie as half. This is not next game’s win probability.',context.teamForm);
  const efficiency=(title,f,defense)=>fact(title,number(f?.value)===null?null:(f.value>0?'+':'')+f.value.toFixed(2)+' scoring value per play',defense?'Estimates how much opponents gained from passes and runs. Lower is better for this defense. This measure excludes sacks and some other plays.':'Estimates how much the offense gained from passes and runs. Higher is better for this offense. This measure excludes sacks and some other plays.',f);
  efficiency('Team offense',context.offense,false);
  efficiency('Team defense',context.defense,true);
  efficiency('Opponent defense',context.opponentDefense,true);
  const allowance=context.opponentAllowanceByPosition?.[row.position]?.[row.marketType];
  const position={QB:'quarterbacks',RB:'running backs',WR:'wide receivers',TE:'tight ends'}[row.position]||'this position';
  fact('Opponent vs '+position,number(allowance?.value)===null?null:number(allowance.value)+' '+unit+' per game','Combined total allowed to all opposing '+position+' in each observed game. This is not an individual player projection.',allowance);
 }else section('Player and matchup history','Not available for this quote yet.');
 section('What is still missing','Confirmed injury and playing-time information, complete league rankings, and proof that these matchup adjustments improve predictions on new games. These context numbers do not change PLAY decisions yet.');
 const details=add(body,'details',undefined,'source-details');details.open=expanded;
 add(details,'summary','Sources, timestamps & calculation notes');
 add(details,'p','Odds: '+(row.provider||'Unknown source')+'. Updated '+date(row.updatedAt)+'. Response '+date(row.generatedAt)+'.');
 add(details,'p',row.identityStatus==='ROSTER_MATCHED'?'Player matched to current ESPN roster: '+row.verifiedTeam+'. Participation is not confirmed.':'Current roster identity has not been independently verified.');
 add(details,'p','Model status: '+row.status+'. '+row.reason);
 for(const {title,feature:f} of evidence){add(details,'h4',title);add(details,'p','Source: '+(f.source||'Unknown')+'. Observed: '+date(f.observedAt)+'. Data cutoff: '+date(f.cutoff)+'. '+(f.method||f.coverageReason||f.missingReason||'Exploratory sample')+'.');}
 add(details,'p','EPA means expected points added: estimated scoring value created by a play. Historical publication times are not verified. Context influence remains zero.');
 section('Saving this prop','Shortlist saves it only while this page stays open. It does not place a bet or record a model prediction.');
}
for(const tab of document.querySelectorAll('[data-sport]'))tab.onclick=()=>{shown=40;$('query').value='';$('book').value='';$('market').value='';loader.load(tab.dataset.sport);};
for(const id of ['query','book','market','freshness'])$(id).addEventListener(id==='query'?'input':'change',()=>{shown=40;render();});
$('refresh').onclick=()=>loader.load(loader.state.sport);$('more').onclick=()=>{shown+=40;render();};$('shortlist-toggle').onclick=()=>{shortlist=!shortlist;shown=40;populate();render();};$('close-detail').onclick=()=>{$('detail').close();selected=null;};$('detail').addEventListener('close',()=>{selected=null;});
setInterval(()=>{render();if($('detail').open)drawDetail();},60000);loader.load('NBA');
