// Navigation points only to existing production pages and supported sections.
const items=[['Overview','/dashboard'],['Games','/research.html?kind=games&sport=NBA'],['Player Props','/nba.html'],['Research & Alt Lines','/research.html'],['Parlays','/dashboard#plays'],['Performance','/dashboard#results'],['System Health','/dashboard#system']];
const main=document.querySelector('main')||document.querySelector('.app');
if(main&&!document.querySelector('.edge-nav')){
 const nav=document.createElement('nav');nav.className='edge-nav';nav.setAttribute('aria-label','Edge Lab navigation');
 const toggle=document.createElement('button');toggle.type='button';toggle.className='edge-nav-toggle';toggle.setAttribute('aria-controls','edge-navigation-links');toggle.setAttribute('aria-expanded','false');nav.append(toggle);
 const links=document.createElement('div');links.className='edge-nav-links';links.id='edge-navigation-links';nav.append(links);
 for(const [label,href] of items){const a=document.createElement('a');a.textContent=label;a.href=href;links.append(a);}
 const close=()=>{nav.dataset.open='false';toggle.setAttribute('aria-expanded','false');};
 toggle.addEventListener('click',()=>{const open=nav.dataset.open!=='true';nav.dataset.open=String(open);toggle.setAttribute('aria-expanded',String(open));});
 links.addEventListener('click',event=>{if(event.target.closest('a'))close();});
 nav.addEventListener('keydown',event=>{if(event.key==='Escape'){close();toggle.focus();}});
 const update=()=>{let current='Edge Lab';for(const link of nav.querySelectorAll('a')){const url=new URL(link.href),here=location.pathname.replace('.html','');const selected=url.pathname.replace('.html','')===here&&url.hash===location.hash&&url.search===location.search;if(selected){link.setAttribute('aria-current','page');current=link.textContent;}else link.removeAttribute('aria-current');}toggle.textContent='Menu · '+current;};
 main.prepend(nav);update();window.addEventListener('hashchange',update);
}
