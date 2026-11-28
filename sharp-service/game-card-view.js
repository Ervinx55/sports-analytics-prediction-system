import {appendTeamIdentity} from './team-identity.js';

// Presentation only: retain the feed's team order and never infer a wager side.
export function appendGameMatchup(parent,{
 sport,away,home,separator='vs',compact=false,className='player-name',tag='h3'
}={}){
 const doc=parent.ownerDocument||globalThis.document;
 const heading=doc.createElement(tag);
 heading.className=className+' game-matchup'+(compact?' game-matchup-compact':'');
 parent.append(heading);
 appendTeamIdentity(heading,sport,away||'Away unavailable',{compact});
 const join=doc.createElement('span');
 join.className='game-matchup-separator';
 join.textContent=' '+(separator==='at'?'at':'vs')+' ';
 heading.append(join);
 appendTeamIdentity(heading,sport,home||'Home unavailable',{compact});
 return heading;
}
