// Explanation only: this module never evaluates or changes model decisions.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>typeof v==='number'&&Number.isFinite(v);
const pct=v=>number(v)&&v>=0&&v<=1?(v*100).toFixed(1)+'%':'Unavailable';
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:'Not recorded';
export function selectionKey(r={},scope='') {return JSON.stringify([scope,r.sport,r.eventID??r.event_id,r.startsAt??r.starts_at,r.playerID??r.player_id??r.player??r.playerName??r.player_name,r.marketType??r.market_type??r.statID??r.stat_id??r.market,r.side??r.market_side??r.side_key,r.line,r.book??r.best_book,r.id,r.modelHash,r.validationProtocol]);}
function fact(f,unit){
 if(!f||!number(f.value))return 'Unavailable — '+(f?.missingReason||'verified evidence was not supplied for this selection.')+(number(f?.gameCount)?` Eligible sample: ${f.gameCount} games. ${f.method||''}`:'');
 return `${f.value} ${unit}. Research context only. Source: ${f.source||'Not recorded'}. Sample: ${f.gameCount??f.sampleCount??'Not recorded'} ${f.gameCount!=null?'games':'observations'}${number(f.gameCount)&&number(f.sampleCount)?`, ${f.sampleCount} observations`:''}. Cutoff: ${stamp(f.cutoff)}. Observed: ${stamp(f.observedAt)}. ${f.method||''}`;
}
export function recordedDecisionPresentation(row={}) {
 const status=row.status||row.verification_status||row.model_decision||'UNKNOWN';
 const issued=row.tracking?.tracked===true?Date.parse(row.tracking.issuedAt):NaN;
 const recorded=Number.isFinite(issued)&&issued<=Date.now();
 return {title:(status==='PLAY'||status==='FINAL_PLAY')&&recorded?'PLAY — recorded decision':status==='PASS'?'PASS — do not play':'NOT CLEARED — do not play'};
}
export function buildDeepDive(row={},options={}) {
 const p=options.presentation||{},c=row.context||{},f=c.features||{},nba=!!c.features;
 const title=p.title||(row.status==='PASS'?'PASS — do not play':'NOT CLEARED — do not play');
 const recorded=options.reason??row.reason;
 const reason=[p.reason,recorded?'Recorded explanation: '+recorded:null].filter(Boolean).join(' ')||'No verified production clearance was supplied for this selection.';
 const live=row.contract==='nba-reviewed-live-v1',av=live?row.evidence?.availability:null,minutes=live?row.evidence?.projectedMinutes:null;
 const defense=nba?f.opponentDefensiveRating:c.opponentDefense;
 const dvp=nba?f.defenseVsPosition:c.opponentAllowanceByPosition?.[row.position]?.[row.marketType??row.statID??row.stat_id];
 return {title,reason,sections:[
 {title:'Decision and value',text:`${title}. ${reason} Selection: ${row.side??row.market_side??row.side_key??'Not recorded'} ${row.line??''} ${row.marketType??row.market_type??row.statID??row.stat_id??(typeof row.market==='string'?row.market:'')}. Book: ${row.book??row.bestBook??row.best_book??row.mainstream_book??'Not recorded'}. Odds: ${row.odds??row.bestOdds??row.best_odds??row.mainstream_odds??'Not recorded'}. Model: ${pct(Object.hasOwn(row,'model')?row.model:row.modelProbability??row.model_probability??row.final_probability)}. Market: ${pct(row.marketProbability??row.marketFairProbability??row.market_fair_probability??row.bookmaker_candidate_fair_probability??(typeof row.market==='number'?row.market:null))}. Recorded edge: ${number(row.edge)?(row.edge*100).toFixed(2)+' percentage points':number(row.edge_pct_points)?row.edge_pct_points.toFixed(2)+' percentage points':'Unavailable'}. Recorded expected return: ${number(row.ev)?(row.ev*100).toFixed(2)+'% per unit staked':number(row.ev_pct)?row.ev_pct.toFixed(2)+'% per unit staked':'Unavailable'}. A high win probability alone does not establish value at the offered price.`},
 {title:'Defensive matchup',text:fact(defense,nba?'points allowed per 100 estimated possessions':'scoring value allowed per play')+' Lower means less conceded in this sample. League rank and individual defender assignments are not verified.'},
 {title:'Defense vs position',text:fact(dvp,nba?'allowed per opposing player appearance':'allowed to the combined position group per game')+' This is historical context, not an individual player projection.'},
 {title:'Expected usage and minutes',text:(number(minutes)?`${minutes} projected minutes recorded in the decision evidence. Forecast: ${stamp(row.forecastAt)}. This is an estimate, not guaranteed playing time. `:fact(f.expectedMinutes,'historical average minutes'))+' Historical minutes are not confirmed playing time. '+(f.historicalUsage?fact(f.historicalUsage,'% historical usage; not projected usage'):'Usage share is unavailable unless explicitly verified.')+' Team form: '+fact(f.winRate||c.teamForm,'win/result rate')},
 {title:'Playstyle',text:'Unavailable — verified shot profile, touches, routes and defensive scheme were not supplied. Position or team reputation alone does not establish playstyle.'},
 {title:'Readiness and evidence',text:`Model version: ${row.validationProtocol||row.modelHash||'Not supplied'}. Approval record: ${row.approvalId||'Not supplied'}. Recorded check failures: ${Array.isArray(row.reasons)&&row.reasons.length?row.reasons.join('; '):'None supplied; this alone is not proof of clearance'}. Decision recorded: ${stamp(row.issuedAt??row.decisionAt??row.issued_at??(row.tracking?.tracked===true?row.tracking.issuedAt:null))}. Forecast: ${stamp(row.forecastAt??row.forecast_at)}. Price observed: ${stamp(row.quoteAt??row.updatedAt??row.updated_at)}. Opposite price observed: ${stamp(row.oppositeQuoteAt??row.oppositeUpdatedAt)}. Availability evidence: ${av?.status||'Not supplied'}. Availability source: ${av?.sourceUrl||'Not recorded'}. Published: ${stamp(av?.publishedAt)}. Provider: ${row.provider||'Not recorded'}. ${p.stale?'STALE forecast. ':''}Context shown here does not change either frozen model or authorize a bet.`},
 {title:'What could change this decision',text:'A fresh decision must confirm approved model use, verified player availability and playing time, and current matching prices on both sides. Missing evidence must be collected; a favorable matchup alone cannot clear a play.'}
 ]};
}
const expanded=new Set();
export function deepDiveHtml(row,options={}) {
 const d=buildDeepDive(row,options),key=selectionKey(row,options.scope);
 return `<details class="el-deep-dive" data-deep-dive="${esc(key)}"${expanded.has(key)?' open':''}><summary>Why ${d.title.startsWith('PLAY')?'PLAY':d.title.startsWith('PASS')?'PASS':'not cleared'}? · Matchup &amp; deep dive</summary><div>${d.sections.map(s=>`<section><h4>${esc(s.title)}</h4><p>${esc(s.text)}</p></section>`).join('')}</div></details>`;
}
export function appendDeepDive(parent,row,options={}) {const template=document.createElement('template');template.innerHTML=deepDiveHtml(row,options);parent.append(template.content);}
// Snapshot synchronously before replacement; toggle events can be delayed by the browser.
export function preserveDeepDives(root){
 for(const el of root.querySelectorAll('[data-deep-dive]')){if(el.open)expanded.add(el.dataset.deepDive);else expanded.delete(el.dataset.deepDive);}
 const active=document.activeElement,key=root.contains(active)?active?.closest('[data-deep-dive]')?.dataset.deepDive:null;
 if(key)queueMicrotask(()=>{for(const el of root.querySelectorAll('[data-deep-dive]'))if(el.dataset.deepDive===key){el.querySelector('summary')?.focus({preventScroll:true});break;}});
}
if(typeof document!=='undefined'){
 const style=document.createElement('style');style.textContent='.el-deep-dive{margin:16px 0;border:1px solid #625078;border-radius:12px;background:#1b1922;color:#eee8f7;overflow-wrap:anywhere}.el-deep-dive summary{padding:14px;cursor:pointer;font-weight:700;color:#d3baff;min-height:44px}.el-deep-dive summary:focus-visible{outline:3px solid #b78aff;outline-offset:2px}.el-deep-dive>div{padding:0 14px 14px}.el-deep-dive section+section{border-top:1px solid #393240}.el-deep-dive h4{margin:14px 0 6px}.el-deep-dive p{line-height:1.6;font-size:14px;margin:6px 0 14px}';document.head.append(style);
}

