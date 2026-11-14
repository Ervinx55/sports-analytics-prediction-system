import {checkDfsPayout,bookLabel} from './prop-price-checks.js';
// Session-only arithmetic. Nothing is submitted, stored, or sent to a model.
export function appendDfsWorksheet(parent,row){
 const add=(p,tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;p.append(node);return node;};
 const panel=add(parent,'details');panel.className='payout-worksheet';
 add(panel,'summary',bookLabel(row.book)+' entry payout worksheet');
 add(panel,'p','Copy the actual cash-return multipliers displayed for your complete entry. A multiplier includes your original stake. This does not verify the platform payout or predict the entry outcome.');
 const form=add(panel,'form');form.className='payout-form';
 const field=(label,type,value)=>{const wrap=add(form,'label',label);const input=add(wrap,'input');input.type=type;input.value=value;return input;};
 const stake=field('Entry amount ($)','number','');stake.min='0.01';stake.step='0.01';stake.max='1000000';
 const picks=field('Number of picks (2–8)','number','2');picks.min='2';picks.max='8';picks.step='1';
 const modeLabel=add(form,'label','Entry type');const mode=add(modeLabel,'select');
 for(const [value,title] of [['all_or_nothing','Power / Standard · all picks correct'],['flex','Flex · partial-hit payouts']]){const option=add(mode,'option',title);option.value=value;}
 const schedule=add(form,'fieldset');add(schedule,'legend','Actual total return by outcome');
 let inputs=[];
 const rebuild=()=>{
  schedule.replaceChildren();add(schedule,'legend','Actual total return by outcome');inputs=[];
  const n=Number(picks.value);if(!Number.isInteger(n)||n<2||n>8)return;
  for(let hits=0;hits<=n;hits++){const label=add(schedule,'label',`${hits} of ${n} correct · return multiplier`);const input=add(label,'input');input.type='number';input.min='0';input.max='1000000';input.step='any';input.placeholder='Enter actual multiplier';input.value=mode.value==='all_or_nothing'&&hits<n?'0':'';inputs.push(input);}
 };
 const reviewLabel=add(form,'label');reviewLabel.className='worksheet-confirmation';const reviewed=add(reviewLabel,'input');reviewed.type='checkbox';
 reviewLabel.append(document.createTextNode('I checked the exact cash entry terms, promotions and pick adjustments. Every pick settles win/loss; these payouts apply to every combination with that number correct. No ties, DNPs, reboots, voids, bonus funds or variable prize pools are included.'));
 const submit=add(form,'button','Check entered payout');submit.type='submit';
 const result=add(panel,'div');result.setAttribute('role','status');result.setAttribute('aria-live','polite');result.className='worksheet-result';
 const clear=()=>{reviewed.checked=false;result.replaceChildren();};
 picks.oninput=()=>{rebuild();clear();};mode.onchange=()=>{rebuild();clear();};form.addEventListener('input',event=>{if(event.target!==reviewed)clear();});
 form.onsubmit=event=>{
  event.preventDefault();result.replaceChildren();
  const parse=input=>input.value.trim()===''?null:Number(input.value);
  const check=checkDfsPayout({book:row.book,mode:mode.value,stake:parse(stake),picks:parse(picks),multipliers:inputs.map(parse),termsReviewed:reviewed.checked});
  add(result,'p',check.summary);if(check.status==='INCOMPLETE')return;
  add(result,'strong','USER-ENTERED TERMS · NOT A CLEARED PLAY');
  const list=add(result,'ul');check.netReturns.forEach((net,hits)=>add(list,'li',`${hits} correct: ${net<0?'−':'+'}$${Math.abs(net).toFixed(2)} net ${net<0?'loss':'return'}`));
  if(check.allHitBreakEven!==null)add(result,'p',`Joint all-picks-win break-even: ${(100*check.allHitBreakEven).toFixed(2)}%. This is the chance the entire entry must win, not a per-player probability.`);
  else add(result,'p','Flex expected profit is unavailable without probabilities for all joint outcomes. Individual hit rates cannot be multiplied to assume independence.');
 };
 rebuild();
}
