// Shared calendar boundaries for the public, provenance-labelled review feed.
const centralDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});

function dateValue(value){
 if(typeof value==='string'){
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
  if(!match)return null;
  const [,year,month,day,hour,minute,second,zone]=match;
  const y=Number(year),m=Number(month),d=Number(day),leap=y%4===0&&(y%100!==0||y%400===0);
  if(y<1||m<1||m>12||d<1||d>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1]||Number(hour)>23||Number(minute)>59||Number(second)>59)return null;
  if(zone!=='Z'&&(Number(zone.slice(1,3))>23||Number(zone.slice(4))>59))return null;
 }else if(!(value instanceof Date)&&(typeof value!=='number'||!Number.isFinite(value)))return null;
 const date=new Date(value);
 return Number.isFinite(date.getTime())?date:null;
}

/** Return an explicit instant's Chicago calendar date, or null for invalid input. */
export function reviewedDay(value){
 const date=dateValue(value);if(!date)return null;
 const parts=Object.fromEntries(centralDate.formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
 return `${parts.year.padStart(4,'0')}-${parts.month}-${parts.day}`;
}

function shiftCalendarDate(value,days){
 const [year,month,day]=value.split('-').map(Number),date=new Date(0);
 date.setUTCFullYear(year,month-1,day+days);date.setUTCHours(12,0,0,0);
 return date.toISOString().slice(0,10);
}

/** Inclusive dates. Shift calendar dates, never 24-hour offsets from an instant. */
export function reviewedDateWindow(sport,now=Date.now()){
 const date=reviewedDay(now);if(!date)return {fromDate:null,toDate:null};
 const distance=typeof sport==='string'&&sport.toUpperCase()==='NFL'?6:0;
 return {fromDate:shiftCalendarDate(date,-distance),toDate:shiftCalendarDate(date,distance)};
}
