// Navigation points only to existing production pages and supported sections.
const items=[['Overview','/dashboard'],['Games','/research.html?kind=games&sport=NBA'],['Player Props','/nba.html'],['Reviewed picks','/nba.html#reviewed-picks'],['NFL reviewed picks','/nfl.html#reviewed-picks'],['Research & Alt Lines','/research.html'],['Parlays','/dashboard#plays'],['Performance','/dashboard#results'],['System Health','/dashboard#system']];
const menuItems=[['NBA player props','/nba.html'],['Reviewed picks','/nba.html#reviewed-picks'],['NFL reviewed picks','/nfl.html#reviewed-picks'],['NFL models','/nfl.html'],['Game research','/research.html?kind=games&sport=NBA'],['Research & alt lines','/research.html'],['MLB dashboard','/dashboard'],['MLB player grades','/dashboard#props'],['Parlays','/dashboard#plays'],['Market analysis','/dashboard#market'],['Sharp gate','/dashboard#sharp'],['Performance','/dashboard#results'],['Calibration','/dashboard#calibration'],['System health','/dashboard#system'],['Probability Lab','/edge-vnext']];
const path=value=>value.replace(/\.html$/,'').replace(/\/$/,'')||'/';
// Only the parameters that select a board change the active navigation item.
// Tracking/share parameters must not remove the current-page pill.
const query=value=>{const parameters=new URLSearchParams(value),route=new URLSearchParams();for(const key of ['kind','sport'])if(parameters.has(key))route.set(key,parameters.get(key));route.sort();return route.toString();};
const isCurrent=href=>{const url=new URL(href,location.href);return url.origin===location.origin&&path(url.pathname)===path(location.pathname)&&url.hash===location.hash&&query(url.search)===query(location.search);};
function appendLinks(parent,entries){for(const [label,href] of entries){const link=document.createElement('a');link.textContent=label;link.href=href;parent.append(link);}}

const shell=document.querySelector('[data-edge-shell]');
if(shell){
 const toggle=shell.querySelector('[data-edge-menu-toggle]'),menu=shell.querySelector('#edge-shell-menu'),links=shell.querySelector('[data-edge-menu-links]');
 if(links&&!links.children.length)appendLinks(links,menuItems);
 const update=()=>{
  for(const link of shell.querySelectorAll('.edge-menu-links a,.edge-view-nav a')){if(isCurrent(link.href))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  for(const link of shell.querySelectorAll('[data-edge-sport-link]')){if(link.dataset.edgeSportLink===shell.dataset.edgeSport)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
 };
 if(toggle&&menu){
  const close=(restoreFocus=false)=>{menu.hidden=true;shell.dataset.menuOpen='false';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open menu');if(restoreFocus)toggle.focus();};
  toggle.addEventListener('click',()=>{if(!menu.hidden){close();return;}menu.hidden=false;shell.dataset.menuOpen='true';toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','Close menu');});
  menu.addEventListener('click',event=>{if(event.target.closest('a,[data-tab]'))close(true);});
  shell.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){event.preventDefault();close(true);}});
  document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!shell.contains(event.target))close();});
  window.addEventListener('hashchange',()=>{close();update();});
 }
 update();
}else{
 const main=document.querySelector('main')||document.querySelector('.app');
 if(main&&!document.querySelector('.edge-nav')){
 const nav=document.createElement('nav');nav.className='edge-nav';nav.setAttribute('aria-label','Edge Lab navigation');
 const toggle=document.createElement('button');toggle.type='button';toggle.className='edge-nav-toggle';toggle.setAttribute('aria-controls','edge-navigation-links');toggle.setAttribute('aria-expanded','false');nav.append(toggle);
 const links=document.createElement('div');links.className='edge-nav-links';links.id='edge-navigation-links';nav.append(links);
 appendLinks(links,items);
 const close=()=>{nav.dataset.open='false';toggle.setAttribute('aria-expanded','false');};
 toggle.addEventListener('click',()=>{const open=nav.dataset.open!=='true';nav.dataset.open=String(open);toggle.setAttribute('aria-expanded',String(open));});
 links.addEventListener('click',event=>{if(event.target.closest('a'))close();});
 nav.addEventListener('keydown',event=>{if(event.key==='Escape'){close();toggle.focus();}});
 const update=()=>{let current='Edge Lab';for(const link of nav.querySelectorAll('a')){if(isCurrent(link.href)){link.setAttribute('aria-current','page');current=link.textContent;}else link.removeAttribute('aria-current');}toggle.textContent='Menu · '+current;};
 main.prepend(nav);update();window.addEventListener('hashchange',update);
 }
}
