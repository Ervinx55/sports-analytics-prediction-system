import test from "node:test";
import assert from "node:assert/strict";
import {normalizePrizePicks} from "../api/prizepicks.js";
test("extracts PrizePicks points, PRA, and threes without assuming stat IDs", () => {
 const events=[{eventID:"e1",startsAt:"2026-11-21T00:00:00Z",odds:{
  a:{statID:"points",sideID:"over",playerID:"p1",byBookmaker:{prizepicks:{available:true,overUnder:"24.5"}}},
  b:{statID:"points+rebounds+assists",sideID:"under",playerID:"p1",byBookmaker:{prizepicks:{available:true,overUnder:"38.5"}}},
  c:{statID:"threePointersMade",sideID:"over",playerID:"p2",byBookmaker:{prizepicks:{available:true,overUnder:"2.5"}}},
  d:{statID:"assists",sideID:"over",byBookmaker:{prizepicks:{available:false,overUnder:"4.5"}}},
  e:{statID:"rebounds",sideID:"over",byBookmaker:{draftkings:{available:true,overUnder:"9.5"}}}
 }}];
 const result=normalizePrizePicks(events);
 assert.equal(result.quotes.length,3);
 assert.deepEqual(result.statCounts,{points:1,"points+rebounds+assists":1,threePointersMade:1});
 assert.equal(result.quotes[0].line,24.5);
});
test("rejects missing, invalid, or negative lines", () => {
 const odds={};
 for(const [i,value] of [null,"", "bad",-1].entries())
  odds["x"+i]={statID:"points",sideID:"over",byBookmaker:{prizepicks:{available:true,overUnder:value}}};
 assert.equal(normalizePrizePicks([{odds}]).quotes.length,0);
});
