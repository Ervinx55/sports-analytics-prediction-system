const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decimal=value=>Number.isFinite(value)?value.toFixed(1):'—';
const percentage=value=>Number.isFinite(value)?(100*value).toFixed(1)+'%':'—';
const dateLabel=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{
  timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric'}).format(new Date(value)):'unavailable';
export function scenarioPlayerName(target){
  if(typeof target?.playerName==='string'&&target.playerName.trim())return target.playerName;
  return String(target?.playerID??'Player').replace(/_\d+_NBA$/,'').replace(/_NBA$/,'').split('_')
    .map(word=>word.length===1?word+'.':word.slice(0,1)+word.slice(1).toLowerCase()).join(' ');
}
const teamName=value=>String(value??'').replace(/_NBA$/,'').split('_')
  .map(word=>word.slice(0,1)+word.slice(1).toLowerCase()).join(' ');
const lineLabel=line=>line.direction==='at_least'?line.threshold+'+':
  line.direction==='at_most'?'At most '+line.threshold:
  (line.direction==='over'?'Over ':'Under ')+line.threshold;

export function nbaScenarioResultHtml(report){
  if(report?.status!=='AVAILABLE'||!report.historical)return '<p>There are not yet three verified, distinct games for this player on the current team. No rates were calculated.</p>';
  const history=report.historical,scenarios=report.minutesScenarios??[];
  const columns=[{label:'Observed games',data:history,rate:'historicalRate'},
    ...scenarios.map(s=>({label:s.minutes+' minutes assumed',data:s,rate:'scenarioRate'}))];
  const tables=columns.map(({label,data,rate})=>{
    if(data.status==='UNAVAILABLE')return '<section class="scenario-result"><h3>'+escapeHtml(label)+'</h3><p>This assumption produces unsupported outcomes; no rate was calculated.</p></section>';
    return '<section class="scenario-result"><h3>'+escapeHtml(label)+'</h3>'+
      '<p class="small">Mean '+decimal(data.mean)+' · Median '+decimal(data.median)+' · Historical range (10th–90th percentile) '+
      decimal(data.quantiles?.p10)+'–'+decimal(data.quantiles?.p90)+'</p>'+
      '<table><thead><tr><th>Threshold</th><th>Cleared</th><th>Rate</th><th>Push</th></tr></thead><tbody>'+
      (data.thresholds??[]).map(t=>'<tr><td>'+escapeHtml(lineLabel(t))+'</td><td>'+escapeHtml(t.wins)+' / '+escapeHtml(t.observations)+
        '</td><td>'+percentage(t[rate])+'</td><td>'+percentage(t.pushRate)+'</td></tr>').join('')+'</tbody></table></section>';
  }).join('');
  const skipped=(report.coverage?.excludedCount??0)+Object.values(report.sourceValidation?.excludedCounts??{}).reduce((a,b)=>a+b,0);
  return '<p><strong>'+escapeHtml(history.observedGameCount)+' distinct recorded games</strong> · '+
    escapeHtml(skipped)+' source rows excluded or outside the sample.</p>'+
    '<p class="small">Verified appearances: '+escapeHtml(dateLabel(history.sample?.[0]?.startsAt))+'–'+
    escapeHtml(dateLabel(history.sample?.at(-1)?.startsAt))+'. Calculated '+escapeHtml(dateLabel(report.asOf))+'. '+
    'Uses up to 20 available verified appearances; recent games with incomplete source evidence may be absent.</p>'+
    '<div class="scenario-results">'+tables+'</div>'+
    '<p class="small">These are historical proportions and separate workload assumptions. The sample range is not a forecast interval. Current injuries, rotation and matchup effects still require a fitted, validated model.</p>';
}

export function initNbaScenarioPanel(root=document,fetchImpl=fetch){
  const get=id=>root.getElementById(id),form=get('nbaScenarioForm'),load=get('loadScenarioPlayers');
  if(!form||!load)return;
  const player=get('scenarioPlayer'),status=get('scenarioStatus'),output=get('scenarioOutput'),submit=get('calculateNbaScenario');
  let targets=[],catalogRevision=0,analysisRevision=0,catalogLoading=false;
  const request=async params=>{
    const url=new URL('/api/edge-vnext',globalThis.location.origin);
    for(const [key,value] of Object.entries({mode:'nba-prop-scenarios',live:'1',...params}))url.searchParams.set(key,value);
    const response=await fetchImpl(url,{cache:'no-store'}),data=await response.json();
    if(!response.ok)throw new Error(data.error??'Player history is unavailable.');
    return data;
  };
  load.addEventListener('click',async()=>{
    const requestRevision=++catalogRevision;analysisRevision++;catalogLoading=true;targets=[];
    load.disabled=true;submit.disabled=true;player.disabled=true;
    output.textContent='';status.textContent='Loading upcoming players from the saved source snapshot…';
    try{
      const data=await request({});if(requestRevision!==catalogRevision)return;
      targets=data.targets??[];
      player.replaceChildren();
      for(const [index,target] of targets.entries()){
        const option=root.createElement('option');option.value=String(index);
        option.textContent=scenarioPlayerName(target)+' · '+teamName(target.teamId)+' vs '+teamName(target.opponentTeamId);
        player.append(option);
      }
      player.disabled=targets.length===0;submit.disabled=targets.length===0;
      status.textContent=targets.length?targets.length+' upcoming player matchups loaded. Select a player and run the analysis.':'No uniquely matched upcoming player targets are available yet.';
    }catch(error){if(requestRevision===catalogRevision)status.textContent=error.message;}
    finally{if(requestRevision===catalogRevision){catalogLoading=false;load.disabled=false;submit.disabled=targets.length===0;}}
  });
  form.addEventListener('input',()=>{analysisRevision++;output.textContent='';if(!catalogLoading)status.textContent='Inputs changed. Run the analysis to update the results.';submit.disabled=catalogLoading||targets.length===0;});
  form.addEventListener('submit',async event=>{
    event.preventDefault();const target=targets[Number(player.value)];if(catalogLoading||!target)return;
    const requestRevision=++analysisRevision;submit.disabled=true;status.textContent='Checking archived games and calculating exact thresholds…';output.textContent='';
    try{
      const data=await request({eventId:target.eventID,playerId:target.playerID,market:get('scenarioMarket').value,
        thresholds:get('scenarioThresholds').value,direction:get('scenarioDirection').value,minutes:get('scenarioMinutes').value});
      if(requestRevision!==analysisRevision)return;
      output.innerHTML=nbaScenarioResultHtml(data);
      status.textContent=scenarioPlayerName(target)+' · '+(data.status==='AVAILABLE'?'Analysis complete':'Insufficient verified history');
    }catch(error){if(requestRevision===analysisRevision)status.textContent=error.message;}
    finally{if(requestRevision===analysisRevision)submit.disabled=catalogLoading||targets.length===0;}
  });
}

if(typeof document!=='undefined')initNbaScenarioPanel();
