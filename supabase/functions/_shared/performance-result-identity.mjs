const id=v=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v)&&Number.isSafeInteger(Number(v));
/** Trusted capture input must carry an exact, point-in-time crosswalk receipt.
 * This validates its shape/bindings, not the external authority: rollout must approve that supplier.
 */
export function validatedResultIdentity(mapping,{oddsProvider,oddsEvent,oddsPlayer=null,forecastAt}={}) {
 if(!mapping||mapping.provider!=='espn'||!id(mapping.event)||(oddsPlayer!==null&&!id(mapping.player))||mapping.ambiguous===true) return null;
 if(mapping.oddsProvider!==oddsProvider||mapping.oddsEvent!==oddsEvent||(mapping.oddsPlayer??null)!==oddsPlayer) return null;
 const v=mapping.validation;
 if(v?.status!=='VALIDATED'||typeof v.reference!=='string'||!v.reference.trim()||typeof v.validatedAt!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(v.validatedAt)||!Number.isFinite(Date.parse(v.validatedAt))||!Number.isFinite(Date.parse(forecastAt))||Date.parse(v.validatedAt)>Date.parse(forecastAt)) return null;
 return structuredClone(mapping);
}
