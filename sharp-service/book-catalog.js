// Explicit SGO identifiers, reviewed against the official catalog on 2026-11-14:
// https://sportsgameodds.com/docs/data-types/bookmakers
// Catalog membership is not evidence of account entitlement or local user access.
const sportsbooks = '1xbet 888sport ballybet barstool betvictor bet365 betanysports betclic betfairsportsbook betfred betmgm betonline betparx betrsportsbook betrivers betsafe betsson betus betway bluebet bodog bookmakereu boombet bovada boylesports caesars casumo circa coolbet coral draftkings espnbet everygame fanatics fanduel fliff fourwinds foxbet grosvenor gtbets hardrockbet ladbrokes leovegas livescorebet lowvig marathonbet mrgreen mybookie neds nordicbet northstarbets paddypower pinnacle playup pointsbet primesports si skybet sportsbet sportsbetting_ag stake sugarhouse superbook suprabets tab tabtouch thescorebet tipico topsport unibet virginbet williamhill windcreek wynnbet'.split(' ');
const dfs = ['hotstreak','parlayplay','prizepicks','sleeper','underdog'];
// Treat Prophet conservatively as an exchange: execution and fee checks are required.
const exchanges = ['betfairexchange','kalshi','matchbook','novig','polymarket','sporttrade','prophetexchange'];
const types = new Map([...sportsbooks.map(id=>[id,'sportsbook']),...dfs.map(id=>[id,'dfs']),...exchanges.map(id=>[id,'exchange'])]);
export const canonicalBookmaker = book => {
 const id=typeof book==='string'?book.trim().toLowerCase():'';
 return ['bookmaker','bookmaker.eu'].includes(id)?'bookmakereu':id;
};
export const platformType = book => types.get(canonicalBookmaker(book))||'unknown';
export const bookLabel = id => ({bookmakereu:'BookMaker.eu',draftkings:'DraftKings',fanduel:'FanDuel',betmgm:'BetMGM',prizepicks:'PrizePicks',betfairexchange:'Betfair Exchange',betfairsportsbook:'Betfair Sportsbook',sportsbetting_ag:'SportsBetting.ag',espnbet:'ESPN BET'}[canonicalBookmaker(id)]||String(id).replace(/^./,c=>c.toUpperCase()));
