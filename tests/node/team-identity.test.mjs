import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getTeamIdentity, appendTeamIdentity, getMatchupTeams } from '../../sharp-service/team-identity.js';

test('NBA names, abbreviations and namespaced provider IDs share the verified logo', () => {
  const full = getTeamIdentity('NBA', {name:'Denver Nuggets', id:'DENVER_NUGGETS_NBA'});
  assert.equal(full.name, 'Denver Nuggets');
  assert.equal(full.abbreviation, 'DEN');
  assert.equal(full.logoSrc, '/assets/team-logos/nba/den.png');
  assert.equal(getTeamIdentity('NBA', 'DEN').name, 'Denver Nuggets');
  assert.equal(getTeamIdentity('NBA', {id:'DENVER_NUGGETS_NBA'}).logoSrc, full.logoSrc);
  assert.equal(getTeamIdentity('NBA', {name:'Los Angeles Clippers',id:'LOS_ANGELES_CLIPPERS_NBA'}).source, 'espn');
  for (const [nba,espn,file] of [['UTA','UTAH','utah'],['GSW','GS','gs'],['NYK','NY','ny'],['SAS','SA','sa'],['NOP','NO','no'],['WAS','WSH','wsh']]) {
    assert.equal(getTeamIdentity('NBA',nba).logoSrc, `/assets/team-logos/nba/${file}.png`);
    assert.equal(getTeamIdentity('NBA',nba).canonicalName, getTeamIdentity('NBA',espn).canonicalName);
  }
});

test('sport namespaces keep identically named teams distinct', () => {
  const baseball = getTeamIdentity('MLB', 'Cardinals');
  const football = getTeamIdentity('NFL', 'Cardinals');
  assert.equal(baseball.canonicalName, 'St. Louis Cardinals');
  assert.equal(football.canonicalName, 'Arizona Cardinals');
  assert.notEqual(baseball.logoSrc, football.logoSrc);
  assert.equal(getTeamIdentity('NHL', 'Boston Bruins').source, 'espn');
  assert.equal(getTeamIdentity('CFB', 'Wisconsin Badgers').source, 'espn');
});

test('ambiguous or unknown identities never borrow another team logo', () => {
  for (const [sport,team] of [['NBA','Los Angeles'],['NCAAF','Bulldogs'],['NBA','Denver Nuggests'],['NBA',{id:'7'}],['NBA',{id:'DENVER_NUGGETS_NFL'}],['OTHER','Boston Celtics']]) {
    assert.equal(getTeamIdentity(sport,team).logoSrc, null, JSON.stringify([sport,team]));
  }
  assert.equal(getTeamIdentity('NCAAF','Unlisted University').name, 'Unlisted University');
});

test('conflicting known name and ID fail closed, preserving the readable name', () => {
  const result = getTeamIdentity('NBA', {name:'Boston Celtics',id:'DENVER_NUGGETS_NBA'});
  assert.equal(result.source, 'fallback');
  assert.equal(result.name, 'Boston Celtics');
  assert.equal(result.logoSrc, null);
});

test('supplied URLs are ignored and returned data cannot alter later lookups', () => {
  const result = getTeamIdentity('NBA', {name:'Boston Celtics',logo:'javascript:alert(1)',logoSrc:'https://example.com/team.png'});
  assert.equal(result.logoSrc, '/assets/team-logos/nba/bos.png');
  result.name = 'Wrong team'; result.logoSrc = 'https://example.com/team.png';
  assert.equal(getTeamIdentity('NBA','BOS').name, 'Boston Celtics');
  assert.equal(getTeamIdentity('NBA','BOS').logoSrc, '/assets/team-logos/nba/bos.png');
});

function element(tagName, document) {
  return {tagName:tagName.toUpperCase(), ownerDocument:document, children:[], dataset:{}, attributes:{}, hidden:false,
    append(...children) { for (const child of children) { this.children.push(child); child.parentElement=this; } },
    setAttribute(key,value) { this.attributes[key]=String(value); },
    set textContent(value) { this.text=String(value); this.children=[]; },
    get textContent() { return this.text||this.children.map(child=>child.textContent||'').join(''); },
  };
}
function parent() {
  const document = {createElement(tag) { return element(tag,this); }};
  return element('h3',document);
}

test('team identity is valid inline content with an accessible full name and decorative logo', () => {
  const mount=parent(), node=appendTeamIdentity(mount,'NBA',{name:'Denver Nuggets',id:'DENVER_NUGGETS_NBA'});
  assert.equal(node.tagName,'SPAN'); assert.equal(node.className,'team-identity');
  assert.equal(mount.children[0],node);
  const [badge,name]=node.children, [image,fallback]=badge.children;
  assert.equal(badge.attributes['aria-hidden'],'true');
  assert.equal(image.alt,''); assert.equal(image.loading,'lazy');
  assert.equal(image.src,'/assets/team-logos/nba/den.png');
  assert.equal(name.textContent,'Denver Nuggets');
  assert.equal(fallback.hidden,true);
});

test('failed logo loads reveal initials without retry loops or changing the team name', () => {
  const node=appendTeamIdentity(parent(),'NBA','Boston Celtics');
  const [badge,name]=node.children, [image,fallback]=badge.children;
  image.onerror();
  assert.equal(image.hidden,true); assert.equal(image.onerror,null);
  assert.equal(fallback.hidden,false); assert.equal(fallback.textContent,'BOS');
  assert.equal(name.textContent,'Boston Celtics');
});

test('unknown names are literal text with a visible initials fallback and no image request', () => {
  const hostile='<img src=x onerror=alert(1)>', node=appendTeamIdentity(parent(),'NBA',hostile);
  const [badge,name]=node.children;
  assert.equal(name.textContent,hostile);
  assert.equal(badge.children.some(child=>child.tagName==='IMG'),false);
  assert.equal(badge.children[0].hidden,false);
});

test('matchup parsing preserves source order and the versus distinction', () => {
  for (const separator of [' @ ',' at ']) assert.deepEqual(getMatchupTeams('Denver Nuggets'+separator+'Utah Jazz'), {away:{name:'Denver Nuggets'},home:{name:'Utah Jazz'},separator:'at'});
  assert.deepEqual(getMatchupTeams('BOS vs ATL'),{away:{name:'BOS'},home:{name:'ATL'},separator:'vs'});
  assert.deepEqual(getMatchupTeams({away:{name:'Boston Celtics',id:'BOSTON_CELTICS_NBA'},home:'Atlanta Hawks'}),{away:{name:'Boston Celtics',id:'BOSTON_CELTICS_NBA'},home:{name:'Atlanta Hawks'},separator:'at'});
  for (const value of ['',null,'Boston Celtics','A @ B @ C','A vs ',' @ B']) assert.equal(getMatchupTeams(value),null);
});

test('all 30 NBA team assets agree with their verified source and checksum', async () => {
  const sources=JSON.parse(await readFile(new URL('../../sharp-service/assets/team-logos/SOURCES.json',import.meta.url),'utf8'));
  const nba=sources.teams.filter(team=>team.sport==='NBA');
  assert.equal(nba.length,30);
  for (const team of nba) {
    const identity=getTeamIdentity('NBA',team.name);
    assert.equal(identity.logoSrc,team.bundledPath);
    assert.match(team.logoSource,/^https:\/\/a\.espncdn\.com\/i\/teamlogos\/nba\//);
    const data=await readFile(new URL('../../sharp-service'+team.bundledPath,import.meta.url));
    assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(createHash('sha256').update(data).digest('hex'),team.sha256);
  }
});
