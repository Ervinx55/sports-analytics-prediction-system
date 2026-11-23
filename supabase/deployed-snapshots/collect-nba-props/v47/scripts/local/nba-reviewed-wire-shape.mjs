import {sourceFingerprint} from './nba-verified-bdl.mjs';
import zeroRows from '../../docs/evaluations/nba-wire-compat-2026-11-12/zero-rows.json' with {type:'json'};
/** Restore only redundant wire representation, then require the ORIGINAL full
 * fingerprint. No new statistics, identities, games, or correction rules pass.
 * Removed zero rows are pinned original evidence, never participation evidence.
 */
export function reviewedWireShape(source,expectedFingerprint){
 const originalFingerprint=sourceFingerprint(source);
 if(originalFingerprint===expectedFingerprint)return {source,evidence:null};
 const copy=structuredClone(source),removedPlayed=[],restoredZeroRows=[];
 for(const [id,row] of Object.entries(copy.results?.game??{})){
  if(!Object.hasOwn(row,'played'))continue;
  if(!id.endsWith('_NBA')||!Number.isInteger(row.secondsPlayed)||row.secondsPlayed<0||row.played!==(row.secondsPlayed>0?1:0))throw Error('BILATERAL_PLAYED_CONFLICT');
  removedPlayed.push({playerID:id,played:row.played});delete row.played;
 }
 for(const [id,row] of Object.entries(zeroRows[source.eventID]??{})){
  if(Object.hasOwn(copy.results.game,id))continue;
  if(!copy.players?.[id]||!Object.values(row).every(v=>typeof v==='number'&&v===0))throw Error('BILATERAL_ZERO_ROW_UNVERIFIED');
  copy.results.game[id]=structuredClone(row);restoredZeroRows.push(id);
 }
 if(sourceFingerprint(copy)!==expectedFingerprint)throw Error('BILATERAL_SOURCE_CHANGED');
 return {source:copy,evidence:{contract:'nba-reviewed-wire-shape-v1',originalFingerprint,reviewedFingerprint:expectedFingerprint,removedPlayed,restoredZeroRows,modelFactsChanged:false}};
}
