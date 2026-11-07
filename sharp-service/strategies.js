import {expectedValue,arbitrage,matchedBet,americanToDecimal} from './lib/strategies/calculations.js';
import {summarizeSpecialties} from './lib/strategies/specialties.js';
import {createAccountsClient,dollarsToCents} from './lib/accounts/client.js';
const root=document.getElementById('workspace');
const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const percent=v=>v===null?'Not available':(v*100).toFixed(2)+'%';
const add=(parent,tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;};
let panel='value',privateState={ready:false,signedIn:false,snapshot:null},accountReady=false,accountError='';
const client=createAccountsClient({onChange:state=>{privateState=state;if(panel==='specialties')specialties();}});
function field(parent,name,title,{type='number',hint='',value='',options=null,required=true}={}){
 const label=add(parent,'label',title),input=add(label,options?'select':type==='textarea'?'textarea':'input');
 input.name=name;input.id='strategy-'+name;if(options){for(const [v,t] of options){const o=add(input,'option',t);o.value=v;}}else{input.type=type;if(type==='number')input.step='any';}
 input.required=required;input.value=value;if(hint)add(label,'small',hint);return input;
}
function check(parent,name,text){const label=add(parent,'label',undefined,'check'),n=add(label,'input');n.type='checkbox';n.name=name;n.required=true;add(label,'span',text);return n;}
function header(title,copy){root.replaceChildren();add(root,'h2',title);add(root,'p',copy);}
function layout(title,copy){header(title,copy);const wrap=add(root,'div',undefined,'strategy-layout');const form=add(wrap,'form',undefined,'strategy-form');const result=add(wrap,'section',undefined,'strategy-result');result.setAttribute('aria-live','polite');add(result,'h2','Your calculation');add(result,'p','Enter the inputs to see a hypothetical result. No example odds are loaded.');return {form,result};}
function num(v,k){if(v[k]===undefined||String(v[k]).trim()==='')throw Error('Complete every required number.');const n=Number(v[k]);if(!Number.isFinite(n))throw Error('Use finite numbers.');return n;}
function amount(v,k){return dollarsToCents(String(v[k]));}
function odds(v,k){return americanToDecimal(num(v,k));}
function metric(result,label,value,copy){const block=add(result,'div',undefined,'result-row');add(block,'h3',label);add(block,'strong',value);if(copy)add(block,'p',copy);}
function begin(result){result.replaceChildren();add(result,'h2','Hypothetical calculation');add(result,'p','Based only on the inputs you supplied. Prices and availability are not independently verified.');}
function finish(result){const ref=crypto.randomUUID();add(result,'small','Calculation reference: '+ref);add(result,'p','To track a real wager, record it in Accounts & Profit and use this reference. This page has not saved it.');const a=add(result,'a','Open private account ledger');a.href='/accounts.html';}
function bind(form,result,calculate){const submit=add(form,'button','Calculate');submit.type='submit';form.addEventListener('input',()=>{result.replaceChildren();add(result,'p','Inputs changed. Calculate again to refresh the result.');});form.onsubmit=e=>{e.preventDefault();try{const v=Object.fromEntries(new FormData(form));begin(result);calculate(v);finish(result);}catch(error){result.replaceChildren();add(result,'h3','Check the inputs');add(result,'p',error.message,'error');}};}
function valueTab(){
 const {form,result}=layout('Value (+EV)','Is the offered payout worth the risk under your probability estimate? A positive result is only as reliable as that estimate.');
 field(form,'source','Probability source',{type:'text',hint:'Name the independent reference or label your own assumption. Removing vig does not reveal the true probability.'});
 field(form,'price','Offered American odds',{hint:'For example, -110 or +150. Enter the price you can actually obtain.'});
 field(form,'win','Estimated win chance (%)',{hint:'Unconditional chance of winning. Use an independent estimate, not this book’s own odds.'});
 field(form,'push','Estimated push chance (%)',{hint:'Enter 0 only when a push cannot occur. Win plus push cannot exceed 100%.'});
 field(form,'stake','Cash stake (USD)',{hint:'Money risked on this bet.'});
 field(form,'fee','Additional fixed fees (USD)',{hint:'Enter 0 if none. Fees are charged in every outcome in this calculator.'});
 check(form,'assumed','I understand this probability is an assumption, not a validated play.');
 bind(form,result,v=>{const r=expectedValue({decimalOdds:odds(v,'price'),winProbability:num(v,'win')/100,pushProbability:num(v,'push')/100,stakeCents:amount(v,'stake'),feeCents:amount(v,'fee')});add(result,'p','Reference: '+v.source);metric(result,'Estimated average profit',money(r.expectedProfitCents),'A long-run average under your assumptions, not the payout or promised profit on this bet.');metric(result,'Estimated return on stake',percent(r.expectedRoi));metric(result,'Break-even win chance',percent(r.breakEvenProbability),'Given your push probability and fixed fees.');metric(result,'Cash required',money(r.requiredCashCents));});
}
function arbitrageTab(){
 const {form,result}=layout('Arbitrage','Compare prices covering every outcome of one market. A mathematical price gap is not a guaranteed executed profit.');
 field(form,'market','Exact event / market / line / period',{type:'text',hint:'All selections must use the same rules. Different lines or periods cannot be combined here.'});
 const count=field(form,'count','Number of possible outcomes',{options:[['2','Two outcomes'],['3','Three outcomes (includes a draw)']],value:'2'});
 field(form,'total','Total stake across all outcomes (USD)');
 field(form,'push','Can all stakes be refunded by a push?',{options:[['','Choose'],['false','No — outcomes cannot push'],['true','Yes — include an all-stakes-refunded scenario']]});
 const legs=add(form,'div');
 function drawLegs(){legs.replaceChildren();for(let i=0;i<Number(count.value);i++){const group=add(legs,'fieldset');add(group,'legend','Outcome '+(i+1));field(group,'label'+i,'Outcome and bookmaker',{type:'text'});field(group,'price'+i,'American odds');field(group,'fee'+i,'Fixed fees for this leg (USD)',{hint:'Enter 0 if none; each leg’s fee is paid regardless of the winner.'});field(group,'limit'+i,'Maximum accepted stake (USD, optional)',{required:false,hint:'Blank means the stake limit is unverified.'});}}
 drawLegs();count.onchange=drawLegs;
 check(form,'complete','I included every mutually exclusive outcome (including the draw where relevant).');
 check(form,'rules','I checked the event, line, period and settlement rules match across all selections.');
 bind(form,result,v=>{if(!v.complete||!v.rules)throw Error('Confirm full outcome coverage and matching rules.');const outcomes=Array.from({length:num(v,'count')},(_,i)=>({label:v['label'+i],decimalOdds:odds(v,'price'+i),feeCents:amount(v,'fee'+i),...(v['limit'+i]!==''?{maxStakeCents:amount(v,'limit'+i)}:{})}));const r=arbitrage({outcomes,totalStakeCents:amount(v,'total'),rulesConfirmed:true,outcomeSetConfirmed:true,possiblePush:v.push==='true'});add(result,'p',v.market);metric(result,'Lowest modeled net result',money(r.worstCaseProfitCents),'After stake rounding and supplied fees, across the listed scenarios. Rejected bets, partial fills or differing void rules are not covered.');metric(result,'Cash required',money(r.requiredCashCents));add(result,'h3','Stake split');for(const a of r.allocations)add(result,'p',a.label+': '+money(a.stakeCents));add(result,'h3','If each outcome happens');for(const scenario of r.scenarios)add(result,'p',scenario.label+': '+money(scenario.profitCents)+' net');add(result,'p',r.limitsVerified?'Supplied stake limits checked; actual acceptance still needs confirmation.':'Stake limits are unverified. This may not be executable.');});
}
function promotionsTab(){
 const {form,result}=layout('Promotions & matched betting','Work out both sides of a hedge, or record terms for a more complex offer. A bonus balance is not the same as withdrawable cash.');
 const kind=field(form,'kind','Offer type',{options:[['cash','Cash back/lay hedge'],['bonus','Bonus bet — stake not returned'],['worksheet','Other offer — terms worksheet']],value:'cash'});
 field(form,'provider','Promotion provider / offer name',{type:'text'});
 field(form,'expiry','Offer expiry',{type:'datetime-local'});
 field(form,'terms','Eligibility, minimum odds, payout cap and wagering restrictions',{type:'textarea',hint:'Enter the actual offer terms. No promotion feed or account eligibility is verified.'});
 const inputs=add(form,'div');
 function drawInputs(){inputs.replaceChildren();if(kind.value==='worksheet'){add(inputs,'p','Deposit matches, rollover offers, multi-leg boosts and conditional refunds require their full payout rules. This worksheet will not invent a cash conversion.');return;}
 field(inputs,'back','Back bet American odds');field(inputs,'lay','Lay odds (decimal)',{hint:'The exchange price to bet against the same selection. Must be greater than 1.'});
 field(inputs,'stake','Cash stake or bonus face value (USD)');field(inputs,'commission','Exchange commission (%)',{hint:'Applied to winnings on this isolated exchange market. Existing exchange positions are not modeled.'});
 field(inputs,'cost','Other qualifying cost already incurred (USD)',{hint:'Net loss or fee outside this hedge. Enter 0 if none. Do not count this same stake twice.'});
 field(inputs,'limit','Available lay stake (USD, optional)',{required:false,hint:'Blank means liquidity is unverified.'});
 field(inputs,'cap','Payout cap in USD (leave blank only if uncapped)',{required:false,hint:'Capped offers require the terms worksheet; this calculator cannot value them.'});
 field(inputs,'possiblePush','Can this bet push or have a partial/dead-heat settlement?',{options:[['','Choose'],['false','No — only win or loss'],['true','Yes / unsure — use worksheet']]});
 check(inputs,'simpleTerms','I verified eligibility and minimum odds. No payout cap, rollover, boost, or other condition changes these cash payouts.');
 check(inputs,'rules','The back and lay sides have matching outcomes and settlement rules; no other exchange positions are included.');}
 drawInputs();kind.onchange=drawInputs;
 bind(form,result,v=>{add(result,'p','User-supplied terms are not independently verified. Use the worksheet for capped or conditional payouts.');add(result,'p','Offer: '+v.provider+' · expires '+v.expiry);add(result,'p','Your terms: '+v.terms);if(v.kind==='worksheet'){add(result,'h3','Terms recorded for this session');add(result,'p','No conversion value calculated. This offer needs a supported payout model and verified eligibility.');return;}if(!v.rules)throw Error('Confirm matching back/lay settlement rules.');const r=matchedBet({termsConfirmed:!!v.simpleTerms,possiblePush:v.possiblePush!=='false',payoutCapCents:v.cap===''?null:amount(v,'cap'),kind:v.kind,backOdds:odds(v,'back'),layOdds:num(v,'lay'),backStakeCents:amount(v,'stake'),commission:num(v,'commission')/100,qualifyingCostCents:amount(v,'cost'),...(v.limit!==''?{maxLayStakeCents:amount(v,'limit')}:{})});metric(result,'Lay stake',money(r.layStakeCents),'The opposing backer’s stake; your potential liability is shown separately.');metric(result,'Lay liability',money(r.liabilityCents),'Cash you could lose on the exchange if the back bet wins.');metric(result,'Cash required',money(r.requiredCashCents),'Includes the calculated hedge funding and supplied qualifying costs; bonus face value is not cash.');metric(result,'Net if the selection wins',money(r.backWinProfitCents));metric(result,'Net if the selection loses',money(r.backLoseProfitCents));add(result,'p',r.limitsVerified?'Supplied lay liquidity checked, but actual matching is unverified.':'Exchange liquidity is unverified. An unmatched hedge does not protect the bet.');});
}
async function initializeAccounts(){if(accountReady)return;accountReady=true;try{await client.init();}catch{accountError='Private account service unavailable. No results loaded.';if(panel==='specialties')specialties();}}
function specialties(){
 header('My specialties','Find where your actual results are strongest. Cash bets and promotional results stay separate; small samples do not prove an edge.');
 const notice=add(root,'p',accountError||'Only your private recorded wagers are included. Model predictions and calculator scenarios are excluded.','strategy-note');
 if(!privateState.ready){notice.textContent=accountError||'Private account setup is required before actual results can load. Missing history is not zero profit.';const a=add(root,'a','Open Accounts & Profit setup');a.href='/accounts.html';initializeAccounts();return;}
 if(!privateState.signedIn){const form=add(root,'form',undefined,'strategy-form');field(form,'email','Your Edge Lab email',{type:'email'});field(form,'code','Email sign-in code',{type:'text',required:false});const send=add(form,'button','Send sign-in code');send.type='button';send.onclick=async()=>{try{send.disabled=true;await client.sendCode(form.elements.email.value);notice.textContent='Code sent. Enter it below to view your results.';}catch{notice.textContent='Unable to send code. Check account setup or try again later.';}finally{send.disabled=false;}};const sign=add(form,'button','Sign in');sign.type='submit';form.onsubmit=async e=>{e.preventDefault();try{await client.verifyCode(form.elements.email.value,form.elements.code.value);await client.refresh();}catch{accountError='Sign-in failed or private results unavailable.';specialties();}};return;}
 const logout=add(root,'button','Sign out');logout.onclick=()=>client.logout();
 if(!privateState.snapshot){add(root,'p','No private snapshot loaded.');const retry=add(root,'button','Load results');retry.onclick=async()=>{try{await client.refresh();}catch{accountError='Could not load private history.';specialties();}};return;}
 const group=field(root,'group','Group results by',{options:[['sport','Sport'],['league','League'],['market','Market'],['provider','Book / provider'],['strategy','Strategy']],value:'sport'});
 const output=add(root,'div');
 function draw(){output.replaceChildren();try{const report=summarizeSpecialties(privateState.snapshot,{groupBy:group.value});add(output,'p',report.coverage.complete?'Recorded history marked complete.':'History is incomplete. These figures cover recorded entries only.');add(output,'p','Closing-line comparison unavailable unless verified historical prices are linked.');const grid=add(output,'div',undefined,'specialty-grid');if(!report.rows.length)add(grid,'p','No settled entries in this view yet.');for(const r of report.rows){const card=add(grid,'article',undefined,'specialty-row');add(card,'h3',r.key+' · '+r.kind);add(card,'p',r.sample+' settled entries · '+r.wins+' wins / '+r.losses+' losses');add(card,'p','Net profit: '+money(r.profitCents));add(card,'p','Cash ROI: '+percent(r.roi));add(card,'small','Descriptive results only. Outcomes may include pushes, voids and partial settlements.');}}catch{add(output,'p','History could not be summarized safely. Review account records.');}}
 group.onchange=draw;draw();
}
function render(){if(panel==='value')valueTab();else if(panel==='arbitrage')arbitrageTab();else if(panel==='promotions')promotionsTab();else specialties();}
for(const button of document.querySelectorAll('[data-panel]'))button.onclick=()=>{panel=button.dataset.panel;for(const b of document.querySelectorAll('[data-panel]'))b.setAttribute('aria-pressed',String(b===button));render();};
render();
